"""
初始化 opencode.db 用户表：
- 读取 D:\\AI\\opencode\\docker\\allowed-names.txt 白名单
- 白名单内用户全部创建为普通用户
- 单独创建/确保管理员账号 admin 存在且角色为 admin
- 所有账号密码统一为 Yejian2016
- 密码使用 PHC 格式 scrypt hash，与项目 user/index.ts 一致
"""
import sqlite3
import hashlib
import os
import time
import argparse


# scrypt 参数（与 packages/core/src/user/index.ts 的 SCRYPT_PARAMS 保持一致）
N = 16384
r = 8
p = 1
keylen = 64


def build_phc_hash(password: str) -> str:
    """生成 PHC 格式 scrypt 密码哈希。"""
    salt = os.urandom(16)
    hash_bytes = hashlib.scrypt(
        password.encode("utf-8"),
        salt=salt,
        n=N,
        r=r,
        p=p,
        dklen=keylen,
    )
    return f"scrypt$N={N}$r={r}$p={p}${salt.hex()}${hash_bytes.hex()}"


def read_allowed_names(path: str) -> list[str]:
    """读取白名单文件，忽略空行和 # 开头的注释行。"""
    names = []
    with open(path, "r", encoding="utf-8") as f:
        for line in f:
            name = line.strip()
            if not name or name.startswith("#"):
                continue
            names.append(name)
    return names


def init_users(db_path: str, names_path: str, password: str) -> None:
    """初始化用户表：批量创建普通用户，并确保 admin 管理员存在。"""
    allowed_names = read_allowed_names(names_path)

    conn = sqlite3.connect(db_path)
    cur = conn.cursor()

    try:
        cur.execute("SELECT name FROM sqlite_master WHERE type='table' AND name='user'")
        if not cur.fetchone():
            raise RuntimeError(f"user 表不存在，请确认数据库路径是否正确：{db_path}")

        # 普通用户：从白名单中排除 admin，避免与管理员账号冲突
        normal_names = [name for name in allowed_names if name != "admin"]

        # 统一生成密码哈希，保证同一密码在不同用户间也使用不同 salt
        now = int(time.time() * 1000)

        for username in normal_names:
            user_id = f"usr_{username}"
            phc_hash = build_phc_hash(password)

            cur.execute("SELECT id FROM user WHERE username = ?", (username,))
            existing = cur.fetchone()

            if existing:
                cur.execute(
                    "UPDATE user SET password_hash = ?, role = 'user', display_name = ?, disabled = 0, must_change_password = 0, time_updated = ? WHERE username = ?",
                    (phc_hash, username, now, username),
                )
                print(f"[更新] 普通用户：{username}")
            else:
                cur.execute(
                    """INSERT INTO user (id, username, password_hash, role, display_name, disabled, must_change_password, time_created, time_updated)
                       VALUES (?, ?, ?, 'user', ?, 0, 0, ?, ?)""",
                    (user_id, username, phc_hash, username, now, now),
                )
                print(f"[创建] 普通用户：{username}")

        # 确保 admin 管理员账号存在
        admin_hash = build_phc_hash(password)
        cur.execute("SELECT id FROM user WHERE username = 'admin'")
        admin_existing = cur.fetchone()

        if admin_existing:
            cur.execute(
                "UPDATE user SET password_hash = ?, role = 'admin', display_name = ?, disabled = 0, must_change_password = 0, time_updated = ? WHERE username = 'admin'",
                (admin_hash, "管理员", now),
            )
            print("[更新] 管理员：admin")
        else:
            admin_id = "usr_admin"
            cur.execute(
                """INSERT INTO user (id, username, password_hash, role, display_name, disabled, must_change_password, time_created, time_updated)
                   VALUES (?, 'admin', ?, 'admin', ?, 0, 0, ?, ?)""",
                (admin_id, admin_hash, "管理员", now, now),
            )
            print("[创建] 管理员：admin")

        conn.commit()
        print(f"初始化完成，共处理 {len(normal_names) + 1} 个账号（{len(normal_names)} 个普通用户 + 1 个管理员）。")
    finally:
        conn.close()


def main() -> None:
    parser = argparse.ArgumentParser(description="初始化 opencode.db 用户表")
    parser.add_argument(
        "--db",
        default=os.path.join(os.getcwd(), "opencode.db"),
        help="opencode.db 数据库路径，默认当前目录下的 opencode.db",
    )
    parser.add_argument(
        "--names",
        default=r"D:\AI\opencode\docker\allowed-names.txt",
        help="白名单文件路径，默认 D:\\AI\\opencode\\docker\\allowed-names.txt",
    )
    parser.add_argument(
        "--password",
        default="Yejian2016",
        help="统一密码，默认 Yejian2016",
    )
    args = parser.parse_args()

    init_users(args.db, args.names, args.password)


if __name__ == "__main__":
    main()
