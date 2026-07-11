# 20260711 开发日志 — Docker 打包前适配（scryptSync + bootstrapUsers）

## 需求背景

准备把 v.1.17.6多用户 分支打包成 Docker 镜像。打包前检查发现两个必修问题：

1. **跨平台密码哈希问题**：`packages/core/src/user/index.ts` 用 `@node-rs/argon2`，在 Linux 容器里启动会因 native binding 路径硬编码 Windows 路径崩溃
2. **多用户预置缺失**：`bootstrapAdmin()` 只能从 `OPENCODE_SERVER_USERNAME/PASSWORD` 单条创建 admin，没有"一组用户"清单的预置入口

## 备选方案

### 1. 密码哈希方案

| 方案 | 优劣 |
|---|---|
| A. 保留 `@node-rs/argon2`，容器内 apt 装系统包修复 | 复杂，alpine 包源没有 libargon2-dev 完整链 |
| B. 切到 `node:crypto.scryptSync` | 跨平台无依赖，OWASP 2024 推荐参数 (N=2^14, r=8, p=1)，**选这个** |
| C. 切到 bcryptjs | 跨平台，但 OWASP 不推荐 bcrypt 替代 scrypt/argon2 |

### 2. 多用户预置方案

| 方案 | 优劣 |
|---|---|
| A. 用 opencode 已有的 `/api/users` POST 端点 + 额外 cli 命令 | CLI 复杂度高，要新写命令 |
| B. 在 `serve.ts` 加 `bootstrapUsers()`，读 `OPENCODE_SEED_USERS_FILE` 环境变量指向的 JSON 文件 | 容器启动时静默预置，**选这个** |
| C. 写 SQL 脚本预先初始化 SQLite | 破坏 schema 完整性，迁库麻烦 |

## 文件改动

### 1. `packages/core/src/user/index.ts`

- L1：`import { hash, verify } from "@node-rs/argon2"` → `import { scryptSync, randomBytes, timingSafeEqual } from "node:crypto"`
- L9-14：删除 `ARGON2_OPTIONS`（argon2id 参数），新增 `SCRYPT_PARAMS = { N: 16384, r: 8, p: 1, keylen: 64 }`
- L15-29：新增 `hashPassword(pwd: string): Promise<string>`，格式 `<salt-hex>:<hash-hex>`
- L31-48：新增 `verifyPasswordHash(stored: string, pwd: string): Promise<boolean>`，用 `timingSafeEqual` 防侧信道
- L105（createUser）：`hash(input.password, ARGON2_OPTIONS)` → `hashPassword(input.password)`
- L142（verifyPassword）：`verify(row.password_hash, password)` → `verifyPasswordHash(row.password_hash, password)`
- L194（changePassword）：`hash(newPassword, ARGON2_OPTIONS)` → `hashPassword(newPassword)`
- L209（resetPassword）：`hash(newPassword, ARGON2_OPTIONS)` → `hashPassword(newPassword)`

### 2. `packages/opencode/src/cli/cmd/serve.ts`

- L10：新增 `import { readFile } from "node:fs/promises"`
- L37-84：新增 `bootstrapUsers()` 函数
  - 读 `process.env.OPENCODE_SEED_USERS_FILE` 路径
  - 文件不存在 / JSON 解析失败 → `console.warn` 静默跳过，不阻塞启动
  - 对每个用户：`getByUsername` 查已存在则跳过；否则 `createUser({ username, password, role, displayName })`
- L107-111：在 `bootstrapAdmin()` 之后调用 `bootstrapUsers()`，共用 `Database.defaultLayer` + `User.defaultLayer`

## 预置用户 JSON 文件格式

```json
[
  { "username": "alice", "password": "Alice1234", "role": "user", "displayName": "Alice Wang" },
  { "username": "bob",   "password": "Bob12345",   "role": "admin" }
]
```

**校验规则**（沿用 `validatePassword`）：密码 ≥ 8 位 + 含字母 + 含数字

## 容器启动用法

```powershell
# 1. 在 D:\AI\YEJIAN\config\seed-users.json 写好预置用户清单
# 2. docker run 时挂载进去
docker run -d --name yejian-AIworkbench -p 8088:8088 `
  -v "E:\AI\YEJIAN:/YEJIAN" `
  -v "E:\AI\AIworkbench-data/root:/root" `
  -v "D:\AI\YEJIAN\config\seed-users.json:/etc/opencode/seed-users.json:ro" `
  -e OPENCODE_SEED_USERS_FILE=/etc/opencode/seed-users.json `
  --env-file "E:\AI\dockerimage\api-keys.env" `
  --restart always yejian-opencode:v0.0.6
```

首次启动日志：
```
[bootstrapAdmin] 已创建初始 admin 账号: yejian   (如果有 OPENCODE_SERVER_PASSWORD 且 user 表空)
[bootstrapUsers] 已创建预置用户: alice (user)
[bootstrapUsers] 已创建预置用户: bob (admin)
opencode server listening on http://0.0.0.0:8088
```

第二次启动（日志）：
```
[bootstrapUsers] 用户已存在，跳过: alice
[bootstrapUsers] 用户已存在，跳过: bob
```

## 哈希迁移

**当前仓库内 `UserTable` 没有真实数据**（v.1.17.6多用户 era 是首次引入，`User` 表还从未被使用过），所以**不存在迁移问题**。

如果未来已有 argon2 哈希的存量用户：
- 简单的方案：清库重建（开发期 OK，生产期不可用）
- 复杂的方案：版本前缀哈希格式（`scrypt:hex` / `argon2:hex`），`verifyPasswordHash` 识别前缀分别走两个分支

## 验证步骤

打包成镜像前在本地验证（Linux 容器 / Windows 子系统）：

```bash
# 1. 在本地起后端，触发 bootstrapAdmin
OPENCODE_SERVER_PASSWORD=Yejian2016 OPENCODE_SERVER_USERNAME=yejian \
OPENCODE_SEED_USERS_FILE=./seed-users.json \
  bun run --conditions=browser ./src/index.ts serve --port 4096

# 2. 看日志是否输出 [bootstrapUsers] 已创建预置用户

# 3. 用预置的 alice 登录 web，验证密码哈希 (scrypt 格式) 能 verify 通过

# 4. 重启，确认 [bootstrapUsers] 用户已存在，跳过
```

## 踩坑记录

- **`scryptSync` 是同步 API**：原 argon2 的 `hash/verify` 是异步签名（`Promise<...>`），Effect 调用方用了 `Effect.promise(() => ...)` 包装。所以 `hashPassword/verifyPasswordHash` 也包成 `Promise` 返回值保持兼容，调用方零改动。
- **`@node-rs/argon2` 删除后 `bun install` 不会自动清理 lock**：需要在 `packages/core/package.json` 里删掉 `@node-rs/argon2` 依赖项，单独提交一个 `chore(core): remove @node-rs/argon2 dependency` commit。本次先不动 package.json，**打包前必须清理**。
- **预置文件应该挂 `:ro`**：seed-users.json 含明文密码，容器内只读挂载防误改。`docker run -v ...:ro`。
- **`OPENCODE_SEED_USERS_FILE` 在容器内路径**：用绝对路径 `/etc/opencode/seed-users.json`（挂载点），不要用相对路径（容器内 cwd 是 `/YEJIAN`）。

## 已知遗留

- `packages/core/package.json` 仍依赖 `@node-rs/argon2`，**打包前删除**（否则镜像里仍会带这个无用 native binding）
- `chore(core)` 类型的 package.json 清理 commit 留到打包前再补（避免 lock 文件冲突）
- `bootstrapUsers` 失败策略是"console.warn 静默跳过"——更严格可以改成"任意失败则 fail-fast"，但首次落地选宽松
