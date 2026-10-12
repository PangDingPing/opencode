// 自引用命名空间导出必须放在文件最顶部，避免模块体执行时 AuthAudit binding 处于 TDZ
// （binary 编译模式与源码直跑模式都兼容，参照 auth-token/index.ts 模式）
export * as AuthAudit from "./index"

import { and, count, desc, eq, like, lt } from "drizzle-orm"
import { Context, Effect, Layer } from "effect"
import path from "path"
import fs from "fs/promises"
import { randomUUID } from "crypto"
import { Database } from "../database/database"
import { AuthAuditTable } from "./sql"
import { Path } from "../global"
import { LayerNode } from "../effect/layer-node"

// 审计事件类型：登录成功 / 登出 / 登录失败 / 管理员踢下线 / 管理员禁用
export type AuditAction = "login" | "logout" | "login_failed" | "kicked" | "disabled"

// 审计记录（管理端查询返回）
export type AuthAuditEntry = {
  id: string
  user_id: string | null
  username: string
  action: AuditAction
  ip: string | null
  user_agent: string | null
  operator: string | null
  time_created: number
}

// 记录入参（userId 可空：登录失败且用户不存在时无关联）
export interface RecordInput {
  userId?: string
  username: string
  action: AuditAction
  ip?: string
  userAgent?: string
  operator?: string
}

interface AuthAuditServiceIface {
  // 记录一条审计事件：DB insert + 追加 JSONL 日志文件 + console（全部 best-effort，失败不影响主流程）
  record: (entry: RecordInput) => Effect.Effect<void, never>
  // 管理端查询（username 模糊 / action 精确 / limit≤200 / offset，返回 total 供分页）
  list: (query: { limit?: number; offset?: number; username?: string; action?: string }) => Effect.Effect<
    { data: AuthAuditEntry[]; total: number },
    never
  >
}

export class Service extends Context.Service<Service, AuthAuditServiceIface>()("@opencode/AuthAuditService") {}

// 本地时区偏移的 ISO 时间戳（JSONL 日志用，形如 2026-10-12T17:30:00.000+08:00）
function localISOString(date: Date): string {
  const pad = (n: number, width = 2) => String(n).padStart(width, "0")
  const offset = -date.getTimezoneOffset()
  const sign = offset >= 0 ? "+" : "-"
  const abs = Math.abs(offset)
  return (
    `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}` +
    `T${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}.${pad(date.getMilliseconds(), 3)}` +
    `${sign}${pad(Math.floor(abs / 60))}:${pad(abs % 60)}`
  )
}

// 控制台时间戳（本地时区，形如 2026-10-12 17:30:00）
function consoleTimestamp(date: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0")
  return (
    `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}` +
    ` ${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`
  )
}

// 按天日志文件名（本地日期）：auth-YYYYMMDD.log
function logFileName(date: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0")
  return `auth-${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(date.getDate())}.log`
}

const RETENTION_MS = 180 * 24 * 60 * 60 * 1000 // 审计数据保留 180 天
const CLEANUP_INTERVAL_MS = 24 * 60 * 60 * 1000 // 清理节流：每 24 小时至多一次

// 上游 session/store.ts 模式：Layer.effect 在构建时捕获 db，各方法 R=never（类型与实现一致）
export const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const { db } = yield* Database.Service
    let lastCleanupAt = 0 // 上次清理时间戳（内存节流，进程重启后首次 record 会清理一次）

    return Service.of({
      // 记录一条审计事件（best-effort：DB/文件/console 任一失败都不影响主流程）
      record: Effect.fn("AuthAudit.record")(function* (entry: RecordInput) {
        const now = new Date()
        const row = {
          id: randomUUID(),
          user_id: entry.userId ?? null,
          username: entry.username,
          action: entry.action,
          ip: entry.ip ?? null,
          user_agent: entry.userAgent ?? null,
          operator: entry.operator ?? null,
          time_created: now.getTime(),
          time_updated: now.getTime(),
        }

        // 1. DB insert（失败仅告警，不阻断登录等主流程）
        yield* db
          .insert(AuthAuditTable)
          .values(row)
          .run()
          .pipe(Effect.catch((e) => Effect.sync(() => console.error("[auth-audit] DB insert 失败:", e))))

        // 2. 追加 JSONL 日志文件（Path.log 数据卷持久化，失败仅告警）
        const line =
          JSON.stringify({
            time: localISOString(now),
            action: row.action,
            username: row.username,
            user_id: row.user_id,
            ip: row.ip,
            user_agent: row.user_agent,
            operator: row.operator,
          }) + "\n"
        yield* Effect.promise(() => fs.appendFile(path.join(Path.log, logFileName(now)), line, "utf8")).pipe(
          Effect.catch((e) => Effect.sync(() => console.error("[auth-audit] 日志文件追加失败:", e))),
        )

        // 3. 容器控制台输出（运维可见，带本地日期时间）
        console.log(`[auth-audit] ${consoleTimestamp(now)} ${row.action} user=${row.username} ip=${row.ip ?? "unknown"}`)

        // 4. 惰性清理：距上次清理超 24h 时删除 180 天前记录（失败静默，不阻塞主流程）
        if (now.getTime() - lastCleanupAt < CLEANUP_INTERVAL_MS) return
        lastCleanupAt = now.getTime()
        yield* db
          .delete(AuthAuditTable)
          .where(lt(AuthAuditTable.time_created, now.getTime() - RETENTION_MS))
          .run()
          .pipe(Effect.catch(() => Effect.void))
      }),

      // 管理端查询：按时间倒序分页，username 模糊匹配，action 精确过滤
      list: Effect.fn("AuthAudit.list")(function* (query: {
        limit?: number
        offset?: number
        username?: string
        action?: string
      }) {
        const limit = Math.min(Math.max(1, query.limit ?? 50), 200)
        const offset = Math.max(0, query.offset ?? 0)
        const conditions = []
        if (query.username) conditions.push(like(AuthAuditTable.username, `%${query.username}%`))
        if (query.action) conditions.push(eq(AuthAuditTable.action, query.action as AuditAction))
        const where = conditions.length > 0 ? and(...conditions) : undefined

        const totalRow = yield* db
          .select({ value: count() })
          .from(AuthAuditTable)
          .where(where)
          .get()
          .pipe(Effect.catch((e) => Effect.sync(() => console.error("[auth-audit] 查询 total 失败:", e))))
        const rows = yield* db
          .select()
          .from(AuthAuditTable)
          .where(where)
          .orderBy(desc(AuthAuditTable.time_created))
          .limit(limit)
          .offset(offset)
          .all()
          .pipe(Effect.catch((e) => Effect.sync(() => console.error("[auth-audit] 查询 data 失败:", e))))

        return {
          data: (rows ?? []).map((row) => ({
            id: row.id,
            user_id: row.user_id,
            username: row.username,
            action: row.action,
            ip: row.ip,
            user_agent: row.user_agent,
            operator: row.operator,
            time_created: row.time_created,
          })),
          total: totalRow?.value ?? 0,
        }
      }),
    })
  }),
)

export const defaultLayer = layer.pipe(Layer.provide(Database.defaultLayer))

export const node = LayerNode.make(layer, [Database.node])
