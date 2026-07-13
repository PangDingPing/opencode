"""
直接用 Python 生成 PHC 格式 scrypt hash 并插入用户表。
PHC 格式: scrypt$N=16384$r=8$p=1$<salt_hex>$<hash_hex>
与 user/index.ts 的 hashPassword 输出格式一致，verifyPasswordHash 能验证。
"""
import sqlite3
import hashlib
import os
import time

# scrypt 参数（与 user/index.ts 的 SCRYPT_PARAMS 一致）
N = 16384
r = 8
p = 1
keylen = 64

username = "yejian"
password = "Yejian2016"
role = "admin"
display_name = "冶建管理员"
user_id = "usr_" + username

# 生成 salt 和 hash
salt = os.urandom(16)
hash_bytes = hashlib.scrypt(
    password.encode("utf-8"),
    salt=salt,
    n=N,
    r=r,
    p=p,
    dklen=keylen,
)

# PHC 格式
phc_hash = f"scrypt$N={N}$r={r}$p={p}${salt.hex()}${hash_bytes.hex()}"
print(f"Generated PHC hash: {phc_hash[:60]}...")

# 直接操作主数据库（需要先停掉 opencode 或用 WAL 模式）
db_path = "/data/root/.local/share/opencode/opencode.db"
conn = sqlite3.connect(db_path)
cur = conn.cursor()

# 检查用户是否已存在
cur.execute("SELECT id FROM user WHERE username = ?", (username,))
existing = cur.fetchone()
if existing:
    print(f"User '{username}' already exists (id={existing[0]}), updating password...")
    cur.execute(
        "UPDATE user SET password_hash = ?, role = ?, display_name = ?, must_change_password = 0, time_updated = ? WHERE username = ?",
        (phc_hash, role, display_name, int(time.time() * 1000), username),
    )
else:
    print(f"Creating user '{username}'...")
    now = int(time.time() * 1000)
    cur.execute(
        """INSERT INTO user (id, username, password_hash, role, display_name, disabled, must_change_password, time_created, time_updated)
           VALUES (?, ?, ?, ?, ?, 0, 0, ?, ?)""",
        (user_id, username, phc_hash, role, display_name, now, now),
    )

conn.commit()
print(f"Done. User '{username}' ready.")

# 验证
cur.execute("SELECT id, username, role, display_name, must_change_password FROM user WHERE username = ?", (username,))
row = cur.fetchone()
print(f"Verify: {row}")
conn.close()
