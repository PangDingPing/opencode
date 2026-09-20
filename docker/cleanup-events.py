"""
opencode event 事件表清理脚本（多用户性能优化 A2）。

背景：event 事件表只在删除会话时随聚合清理，正常使用只增不减；每条持久事件
     同步写一行 event_sequence，两表同步膨胀，拖慢 WAL checkpoint 与读路径。
     本脚本按保留天数清理旧事件，并同步清理孤儿 event_sequence 行（对照
     EventV2.remove 的双表删除语义，packages/core/src/event.ts:518-527）。

影响范围：
  - 只删 event / event_sequence（审计与回放数据），页面上的会话与消息
    （session/message 投影表）不受影响；
  - 会影响事件回放（replay）与审计追溯，保留窗口按业务需要设定（默认 30 天）。

时间判定原理：事件表无时间列。事件 ID（evt_ + 26 位）的前 12 位 hex 由
     packages/core/src/util/identifier.ts 生成，编码 (毫秒时间戳 << 12 | 计数器)
     的低 48 位——时间戳高位被截断，约每 792 天回绕一次（最近一次回绕点为
     2026-08-14）。因此 ID 字典序不等于时间序，不能在 SQL 里直接比较，
     本脚本在 Python 侧逐条还原真实时间戳后再决定删除。
     （注意：本数据集恰好跨过 2026-08-14 回绕点，跨点的字典序比较会删错数据。）

用法（宿主机，容器运行中）：
  docker cp docker/cleanup-events.py yejian-v0.1.6:/tmp/cleanup-events.py
  docker exec yejian-v0.1.6 python3 /tmp/cleanup-events.py             # 默认保留 30 天
  docker exec yejian-v0.1.6 python3 /tmp/cleanup-events.py --days 60  # 保留 60 天
  docker exec yejian-v0.1.6 python3 /tmp/cleanup-events.py --dry-run  # 只看会删多少，不删

建议低峰期执行；如需彻底回收磁盘空间，可在停服维护窗口加 --vacuum。
"""
import argparse
import datetime
import os
import sqlite3
import sys
import time

WRAP_MS = 1 << 48  # ID 时间位 48 bit 回绕周期（约 792 天）
DATE_WINDOW_MS = 790 * 86400 * 1000  # 可定日期窗口：近 790 天（小于一个回绕周期，保证候选唯一）
SLACK_MS = 2 * 86400 * 1000  # 容许 2 天时钟偏移


def decode_event_ts(eid, k_now, now_ms):
    # 还原事件真实毫秒时间戳：候选 k 只可能是 k_now（回绕后）或 k_now-1（回绕前）
    try:
        prefix = int(eid[4:16], 16)
    except ValueError:
        return None
    for k in (k_now, k_now - 1):
        cand = (prefix + k * WRAP_MS) >> 12
        if now_ms - DATE_WINDOW_MS <= cand <= now_ms + SLACK_MS:
            return cand
    return None


def main():
    parser = argparse.ArgumentParser(description="opencode event 事件表清理（A2）")
    parser.add_argument("--days", type=int, default=30, help="保留最近 N 天事件（默认 30）")
    parser.add_argument("--db", default="/root/.local/share/opencode/opencode.db", help="opencode.db 路径")
    parser.add_argument("--dry-run", action="store_true", help="只统计将删除的行数，不实际删除")
    parser.add_argument("--vacuum", action="store_true", help="清理后 VACUUM 回收磁盘空间（需无并发写入，建议停服窗口）")
    args = parser.parse_args()

    if not os.path.exists(args.db):
        print(f"ERROR: database not found: {args.db}")
        return 1

    now_ms = int(time.time() * 1000)
    cutoff_ms = int((time.time() - args.days * 86400) * 1000)
    k_now = (now_ms << 12) // WRAP_MS
    print(f"保留窗口: {args.days} 天（截止 {datetime.datetime.fromtimestamp(cutoff_ms / 1000)}）")

    conn = sqlite3.connect(args.db)
    conn.execute("PRAGMA busy_timeout = 5000")
    cur = conn.cursor()

    total_events = cur.execute("SELECT count(*) FROM event").fetchone()[0]
    total_seq = cur.execute("SELECT count(*) FROM event_sequence").fetchone()[0]

    # 逐条解码事件时间，筛出窗口外的待删 ID
    expired_ids = []
    undatable = 0
    for (eid,) in cur.execute("SELECT id FROM event"):
        ts = decode_event_ts(eid, k_now, now_ms)
        if ts is None:
            undatable += 1
            continue
        if ts < cutoff_ms:
            expired_ids.append(eid)

    # 统计"所有事件都在窗口外"的聚合数 → 这些聚合的 event_sequence 行将一并清理
    expired_set = set(expired_ids)
    keep_aggregates = {aid for eid, aid in cur.execute("SELECT id, aggregate_id FROM event") if eid not in expired_set}
    all_aggregates = {aid for (aid,) in cur.execute("SELECT DISTINCT aggregate_id FROM event")}
    doomed_seq = len(all_aggregates - keep_aggregates)
    print(f"event: {total_events} 行（待删 {len(expired_ids)}），event_sequence: {total_seq} 行（待删 {doomed_seq}）")
    if undatable:
        print(f"警告: {undatable} 条事件无法还原时间（ID 格式异常或超出 790 天窗口），已跳过保留")

    if args.dry_run:
        print("dry-run：未执行任何删除。")
        conn.close()
        return 0

    cur.executemany("DELETE FROM event WHERE id = ?", [(eid,) for eid in expired_ids])
    deleted_events = cur.rowcount
    # 同步清理没有任何剩余事件的聚合的序列号行（防止 event_sequence 照常膨胀，评审 R7）
    cur.execute(
        "DELETE FROM event_sequence WHERE aggregate_id NOT IN (SELECT DISTINCT aggregate_id FROM event)"
    )
    deleted_seq = cur.rowcount
    conn.commit()
    print(f"已删除 event: {deleted_events} 行，event_sequence: {deleted_seq} 行")

    # 收敛 WAL，避免清理产生的 -wal 文件继续占空间
    print("wal_checkpoint:", cur.execute("PRAGMA wal_checkpoint(TRUNCATE)").fetchall())

    if args.vacuum:
        print("VACUUM 执行中（大库可能较慢）...")
        cur.execute("VACUUM")
        print("VACUUM 完成")

    print(
        f"剩余 event: {cur.execute('SELECT count(*) FROM event').fetchone()[0]} 行，"
        f"event_sequence: {cur.execute('SELECT count(*) FROM event_sequence').fetchone()[0]} 行"
    )
    conn.close()
    return 0


if __name__ == "__main__":
    sys.exit(main())
