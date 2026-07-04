# OpenCode Web 多用户改造：实施指导方案

> 本文档基于 `multi-user-feasibility-analysis.md`（可行性分析）+ `multi-user-feasibility-review.md`（智囊评审）+ 讨论确认结果，作为后期实施的**权威执行依据**。
> 原报告作为分析背景保留，本文档作为执行依据。两者有冲突时以本文档为准。

---

## 一、关键决策汇总（讨论确认结果）

| 决策项 | 结论 | 理由 |
|---|---|---|
| **Project 隔离** | ❌ 不隔离，项目共享 | 审查师之间经常互相接手项目，严格隔离反而增加 admin 移交负担 |
| **首次启动密码** | ✅ 强制 `OPENCODE_SERVER_PASSWORD` | 没设直接拒绝启动，避免 Docker stdout 丢密码 |
| **Session 隔离** | ✅ 按 user_id 严格隔离 | 核心需求，普通用户只看自己的会话 |
| **Provider 设置可见性** | ✅ 普通用户隐藏整个入口 | 不只是隐藏"添加"按钮，整个提供商设置页对普通用户不可见 |
| **Credential 可见性** | ✅ 全局共享，user_id 仅作审计字段 | 全员共用同一组 API key |
| **密码 hash** | ✅ argon2id | OWASP 2024 首选 |
| **Session token** | ✅ DB session + HttpOnly cookie | 可撤销，admin 能踢人 |
| **惰性续期** | ✅ 5 分钟续一次 | 避免每请求 UPDATE |
| **改密踢出设备** | ✅ 改密后踢出其他 session | 安全最佳实践 |
| **密码强度** | ✅ 8 位+含字母数字 | 简单规则 |
| **登录限速** | ✅ 同 IP 5 次失败锁 15 分钟 | 内存计数，单进程可接受 |
| **定期备份** | ✅ 一期就做 | 单文件 SQLite，硬盘坏就全完，cron 简单搞定 |
| **审计日志** | ⚠️ 一期不做完整 audit_log，但改密/踢人记简单日志 | 30 人内部系统，1-2 个 admin，完整审计二期再加 |
| **admin 代为操作** | ❌ 一期不做 | 30 人不需要，二期可加"批量转移 session"工具 |
| **`_legacy` 用户禁用机制** | ✅ 用 `disabled` 列，不用特殊 hash 字符串 | 避免 verify 函数改动后误判 |
| **用户名实名制** | ✅ 用户名必须是实名，且在白名单内 | 30 人审查机构，实名制便于管理和追溯 |
| **实名白名单文件** | ✅ `docker/allowed-names.txt`，每行一个名字 | 后期编辑文件+重启即可，无需重建镜像 |
| **初始用户创建** | ✅ 迁移脚本读取白名单，批量创建 29 个用户 | 初始密码统一为 `OPENCODE_SERVER_PASSWORD`，首次登录强制改密 |
| **文件路径隔离** | ✅ session 工作目录按实名分文件夹 | 每个用户的输入输出文件天然隔离，如 `/workspace/上官兵/` |

### 对原报告的修订点

| 原报告章节 | 修订内容 |
|---|---|
| 2.3 数据现状 | project 表**不加 owner_id**（项目共享） |
| 3 改造目标 | "项目按用户隔离"改为"项目共享，仅 session 隔离" |
| 4.3 迁移脚本 | 删除 project 表加 owner_id 的步骤；`_legacy` 用户用 `disabled=1` 列，不用 `password_hash='!disabled!'` |
| 4.4 启动引导 | 删除"随机生成密码打印到控制台"分支；没设 env 直接 `Effect.die` |
| 4.5 credential 端点 | 普通用户**看不到 provider 设置入口**，不需要 GET 端点给普通用户 |
| 4.7 会话隔离 | 删除 ProjectV2.list 过滤；session_token 表加 `last_extend_at` 字段 |
| 5.1 数据层 | 删除 `project/sql.ts` 改动；`session_token` 表加 `last_extend_at` |
| 7 实施顺序 | 见下方修订版 |

---

## 一点五、用户实名白名单机制（新增需求）

> 30 人审查机构要求实名制，用户名必须为真实姓名，且在白名单内。

### 白名单文件

- **文件位置**：`docker/allowed-names.txt`
- **文件格式**：每行一个名字，`#` 开头的行为注释
- **当前名单**：29 人（上官兵、朱艳萍、官润荣、李杰、戴雪葵、黄莉、徐琳、陈嘉敏、张行之、张志君、彭敏睿、马晓龙、谭永杰、庄树楷、欧杏、刘晓宇、欧轩、邵君、龚建平、段迎霞、庞定平、潘红、张慧怡、刘志恒、杜智颖、韦志华、张秀峰、张伟、贺俊毅、白帆）
- **后期维护**：直接编辑 `docker/allowed-names.txt`，加人或删人，然后 `docker restart` 容器即可（**无需重建镜像**）

### 读取与校验逻辑

- **启动时**：读取白名单文件 → 解析成 `string[]` → 缓存在内存
- **admin 创建用户时**：前端从白名单里**下拉选择**（不是自由输入），后端二次校验
- **用户名约束**：必须完全匹配白名单中的某一行（区分大小写、不去空格）

### 初始用户批量创建

- **迁移脚本**读取白名单，批量创建 29 个用户
- **初始密码**统一为 `OPENCODE_SERVER_PASSWORD`（env 变量）
- **角色**全部为 `user`（普通用户）
- **首次登录强制改密**：user 表加 `must_change_password` 列，登录时检查，前端跳改密页

### Docker 挂载

`docker-compose.yml` 或 `docker run` 里加一行挂载：
```yaml
volumes:
  - ./allowed-names.txt:/data/allowed-names.txt:ro
```
代码通过 env 变量 `OPENCODE_ALLOWED_NAMES_FILE` 读取路径（默认 `/data/allowed-names.txt`）。

### 用户实名作为文件路径关键字

每个用户的 session 工作目录按实名隔离：
- **路径规则**：`${workspaceDir}/${username}/`
- **示例**：`/root/.local/share/opencode/workspace/上官兵/`
- **实现方式**：创建 session 时，`directory` 字段自动填入 `${workspaceDir}/${currentUser.username}/`
- **目录创建**：session 创建前自动 `mkdir -p` 确保目录存在
- **效果**：每个用户的输入输出文件天然按实名分文件夹，AI 只能在该用户目录下操作

---

## 二、修订后的实施方案（5 个阶段）

> 每阶段独立可构建、可回滚。按 git 提交习惯拆 commit（每文件一个 commit，按依赖顺序）。

### 阶段 1：数据层基础（2 天）

**目标**：建表 + 迁移脚本 + 老数据归属

**任务清单**：

1. **新建 `packages/core/src/user/sql.ts`** — user 表定义
   ```ts
   // user 表 schema（Drizzle 写法）
   export const UserTable = sqliteTable("user", {
     id: text().$type<UserID>().primaryKey(),
     username: text().notNull().unique(),          // 实名，必须在白名单内
     password_hash: text().notNull(),
     role: text().$type<"admin" | "user">().notNull(),
     display_name: text(),
     disabled: integer().notNull().default(0),     // 0=正常 1=禁用，verify 前先查这列
     must_change_password: integer().notNull().default(0),  // 1=首次登录强制改密
     ...Timestamps,
   })
   ```

2. **新建 `packages/core/src/auth-token/sql.ts`** — session_token 表
   ```ts
   export const SessionTokenTable = sqliteTable("session_token", {
     id: text().primaryKey(),                    // token 本身
     user_id: text().notNull().references(() => UserTable.id, { onDelete: "cascade" }),
     expires_at: integer().notNull(),            // unix ms
     last_extend_at: integer().notNull(),        // 惰性续期用，5 分钟续一次
     revoked_at: integer(),                      // 软删除，admin 踢人用（null=有效）
     time_created: integer().notNull(),
     user_agent: text(),
     ip: text(),
   }, (table) => [
     index("session_token_user_idx").on(table.user_id),
   ])
   ```

3. **新建 `packages/core/src/database/migration/20260623120000_add_user_and_ownership.ts`** — 迁移脚本
   - 建 `user` 表 + `session_token` 表
   - `session` 表加 `user_id` 列 + 索引
   - **不加** project 表的 owner_id（项目共享）
   - `credential` 表加 `user_id` 列（审计用）
   - 插入 `_legacy_system` 虚拟用户（`disabled=1`, `role='admin'`）
   - 老 session 全部 `UPDATE ... SET user_id = 'usr_legacy_system' WHERE user_id IS NULL`

4. **新建 `packages/core/src/user/allowed-names.ts`** — 白名单读取模块
   ```ts
   // 读取 allowed-names.txt，解析成 string[]
   // 路径从 env 变量 OPENCODE_ALLOWED_NAMES_FILE 读取，默认 /data/allowed-names.txt
   // 本地开发时回退到项目根目录的 docker/allowed-names.txt
   export function loadAllowedNames(): string[]
   export function isAllowedName(name: string): boolean
   ```

5. **新建 `packages/core/src/database/migration/20260623120001_seed_initial_users.ts`** — 初始用户种子迁移
   - 读取白名单文件
   - 批量创建 29 个用户（role='user', must_change_password=1）
   - 初始密码 = `OPENCODE_SERVER_PASSWORD`（argon2id hash）
   - **幂等设计**：已存在的用户名跳过，不重复创建
   - 注意：此迁移依赖 `OPENCODE_SERVER_PASSWORD` env 变量，没设则跳过（只建表不建用户）

6. **改 `packages/core/src/session/sql.ts`** — 加 `user_id` 列
   ```ts
   // 在 SessionTable 里加一行
   user_id: text().$type<UserID>(),
   ```

7. **改 `packages/core/src/credential/sql.ts`** — 加 `user_id` 列（审计用）

8. **跑 `bun generate`** 生成 schema.gen.ts

9. **用真实老库 dry-run**：从生产 cp 一份 `opencode.db` 出来，跑迁移脚本，验证：
   - 老 session 全部划到 `usr_legacy_system`
   - user 表有 1 条 `_legacy_system` 记录 + 29 条实名用户记录
   - 原有数据无丢失

**验证标准**：
- `bun typecheck` 通过
- 真实老库迁移无报错
- `SELECT COUNT(*) FROM session WHERE user_id = 'usr_legacy_system'` 等于原 session 总数
- `SELECT COUNT(*) FROM user WHERE role = 'user'` 等于白名单人数（29）
- `SELECT must_change_password FROM user WHERE username = '上官兵'` 返回 1

**Commit 建议**（按依赖顺序，每文件一个 commit）：
1. `feat(core): add user table schema with must_change_password` — user/sql.ts
2. `feat(core): add session_token table schema` — auth-token/sql.ts
3. `feat(core): add user_id to session table` — session/sql.ts
4. `feat(core): add user_id to credential table` — credential/sql.ts
5. `feat(core): add allowed-names whitelist loader` — user/allowed-names.ts
6. `feat(core): add multi-user migration script` — migration 建表脚本
7. `feat(core): seed initial users from whitelist` — migration 种子脚本
8. `chore(core): regenerate schema` — schema.gen.ts
9. `chore(docker): add allowed-names.txt whitelist file` — docker/allowed-names.txt

---

### 阶段 2：后端认证 + 权限中间件（2 天）

**目标**：替换 Basic Auth + 登录/登出/me 接口 + admin 守卫

**任务清单**：

1. **新建 `packages/core/src/user/index.ts`** — user Service
   - `createUser({ username, password, role })` — **先校验 username 在白名单内**，argon2id hash 后写入
   - `verifyPassword(username, password)` — 先查 `disabled` 列，disabled=1 直接拒绝；再 argon2.verify
   - `listUsers()` / `getUser(id)` / `updateUser(id, ...)` / `disableUser(id)` / `resetPassword(id, newPwd)`
   - 密码强度校验：`validatePassword(pwd)` — 至少 8 位 + 含字母 + 含数字
   - `getAllowedNames()` — 返回白名单（供前端下拉选）
   - `changePassword(userID, oldPwd, newPwd)` — 改密后清 `must_change_password=0` + revoke 其他 token

2. **新建 `packages/core/src/auth-token/index.ts`** — token Service
   - `createToken(userID, userAgent, ip)` — 生成 32 字节随机 token，写入 DB，返回 token 字符串
   - `verifyToken(token)` — 查 DB，`revoked_at IS NULL AND expires_at > now()` 才有效
   - `extendToken(token)` — 惰性续期：`now - last_extend_at < 5min` 则跳过；否则 UPDATE `expires_at` 和 `last_extend_at`
   - `revokeToken(token, revokedBy)` — 软删除，设 `revoked_at = now`
   - `revokeAllUserTokens(userID, revokedBy)` — 改密/踢人时用
   - `cleanupExpired()` — 启动时删 `expires_at < now()` 的过期 token

3. **新建 `packages/server/src/middleware/auth.ts`** — 替换 Basic Auth
   - 从 cookie `oc_session` 取 token
   - `verifyToken` + `extendToken`
   - 把当前用户注入 Effect Context（`CurrentUser` Service）
   - 未登录返回 401 + 跳 `/login`（前端处理）

4. **新建 `packages/server/src/middleware/require-admin.ts`** — admin 守卫
   - `yield* CurrentUser` 取当前用户
   - `role !== 'admin'` 返回 403

5. **新建 `packages/server/src/groups/auth.ts`** — 登录路由
   - `POST /api/auth/login` — body: `{ username, password }`，成功设 cookie，返回 user info（含 `must_change_password` 标志）
   - `POST /api/auth/logout` — revoke 当前 token，清 cookie
   - `GET /api/auth/me` — 返回当前 user info（含 `must_change_password` 标志）
   - `POST /api/auth/change-password` — body: `{ oldPassword, newPassword }`，改密后清 `must_change_password=0` + revoke 其他 token
   - `GET /api/auth/allowed-names` — admin only，返回白名单（供前端创建用户时下拉选）

6. **改 `packages/server/src/middleware/authorization.ts`** — 切换到新中间件
   - 保留导出名 `Authorization`，内部实现改为读 cookie

7. **改 `packages/server/src/auth.ts`** — 简化为兼容壳
   - 保留 `header()` / `headers()` 给 CLI 用（CLI 仍用 Basic Auth）
   - Web 端走新的 cookie 中间件

8. **登录限速**（内存计数，在 login handler 里）
   ```ts
   // 简单的内存限速，单进程可接受
   const loginAttempts = new Map<string, { count: number; lockedUntil: number }>()
   // 同 IP 5 次失败 → 锁 15 分钟
   ```

9. **改 `packages/opencode/src/cli/cmd/serve.ts`** — 启动引导
   ```ts
   async function bootstrapAdmin() {
     const userCount = await db.select({ c: count() }).from(userTable)
     if (userCount[0].c > 0) return  // 已有用户（含迁移脚本创建的 29 人），跳过

     const password = process.env.OPENCODE_SERVER_PASSWORD
     if (!password) {
       console.error("首次启动必须设置 OPENCODE_SERVER_PASSWORD 环境变量")
       process.exit(1)  // fail-fast
     }
     const username = process.env.OPENCODE_SERVER_USERNAME ?? "admin"
     await createUser({ username, password, role: "admin" })  // admin 不受白名单限制
     console.log(`已创建初始 admin 账号: ${username}`)
   }
   ```
   **注意**：迁移脚本会先创建 29 个普通用户（读白名单），bootstrapAdmin 在迁移后执行，创建 admin 账号。两者顺序：迁移 → bootstrapAdmin。

**验证标准**：
- `curl -X POST /api/auth/login -d '{"username":"admin","password":"xxx"}'` 返回 200 + Set-Cookie
- `curl -b cookie.txt /api/auth/me` 返回 user info（含 `must_change_password` 字段）
- `curl -b cookie.txt -X POST /api/auth/logout` 返回 200，cookie 被清
- 错误密码 5 次后返回 429
- 用白名单内的实名用户登录，返回 `must_change_password: 1`
- admin 调 `GET /api/auth/allowed-names` 返回 29 个名字
- admin 创建用户时用户名不在白名单内 → 返回 400

**Commit 建议**：
1. `feat(core): add user service with argon2id and whitelist validation` — user/index.ts
2. `feat(core): add auth token service with lazy extend` — auth-token/index.ts
3. `feat(server): add cookie-based auth middleware` — middleware/auth.ts
4. `feat(server): add require-admin middleware` — middleware/require-admin.ts
5. `feat(server): add auth routes with must_change_password support` — groups/auth.ts
6. `refactor(server): switch authorization to cookie-based auth` — middleware/authorization.ts
7. `refactor(server): simplify legacy auth module to CLI compat shell` — auth.ts
8. `feat(server): add login rate limiting` — groups/auth.ts（或单独文件）
9. `feat(opencode): bootstrap admin on first startup with env password` — serve.ts

---

### 阶段 3：后端业务隔离 + 文件路径隔离（1.5 天）

**目标**：session 按 user_id 过滤 + credential 写入端点 + session 工作目录按实名隔离

**任务清单**：

1. **改 `packages/server/src/handlers/session.ts`** — list 加 user_id 过滤
   ```ts
   .handle("session.list", Effect.fn(function* (ctx) {
     const current = yield* CurrentUser
     const isAdmin = current.role === "admin"

     // 普通用户强制加 user_id 过滤；admin 不过滤（看全员）
     const filter = isAdmin
       ? ctx.query
       : { ...ctx.query, userID: current.id }

     const sessions = yield* session.list({ ...filter, limit: ctx.query.limit ?? 50 })
     // ...
   }))
   ```

2. **改 session 创建逻辑** — 自动写 user_id + 按实名设工作目录
   ```ts
   // 创建 session 时自动归属当前用户 + 工作目录按实名隔离
   const userDir = path.join(workspaceDir, current.username)
   yield* fs.mkdir(userDir, { recursive: true })  // 确保目录存在
   yield* session.create({
     ...,
     userID: current.id,
     directory: userDir,  // 每个用户的输入输出文件天然隔离
   })
   ```
   **效果**：用户"上官兵"的 session 工作目录为 `/root/.local/share/opencode/workspace/上官兵/`，AI 只能在该目录下操作文件。

3. **改 `packages/server/src/groups/credential.ts`** — 新增 POST 端点
   ```ts
   HttpApiEndpoint.post("credential.create", "/api/credential", {
     payload: Schema.Struct({
       integrationID: IntegrationSchema.ID,
       label: Schema.String,
       value: Credential.Info,
     }),
     success: Schema.Struct({ data: Credential.Stored }),
   }).middleware(RequireAdmin)  // admin-only
   ```
   - 写入时自动填 `user_id` = 当前 admin 的 id（审计用）
   - 响应里 key 脱敏（前 6 位 + `***`）

4. **改 `packages/server/src/api.ts`** — 注册新 Group + 中间件

**验证标准**：
- 登录两个普通用户，互看不到对方的 session
- 登录 admin 能看到全部 session
- 普通用户调 `POST /api/credential` 返回 403
- admin 调 `POST /api/credential` 返回 201
- 用户"上官兵"创建 session 后，文件系统出现 `/workspace/上官兵/` 目录
- 不同用户的 session 工作目录互不重叠

**Commit 建议**：
1. `feat(server): filter session list by user_id for non-admin` — handlers/session.ts
2. `feat(server): auto-assign user_id and real-name directory on session creation` — session 创建逻辑
3. `feat(server): add admin-only credential create endpoint` — groups/credential.ts
4. `refactor(server): register auth and credential groups` — api.ts

---

### 阶段 4：前端登录页 + 权限守卫（2 天）

**目标**：登录页 + AuthGate + 普通用户隐藏 provider 设置

**任务清单**：

1. **新建 `packages/app/src/pages/login.tsx`** — 登录页
   - 用户名 + 密码表单
   - 登录失败显示错误提示
   - 登录成功后检查 `must_change_password`，为 1 则跳改密页

2. **新建 `packages/app/src/pages/change-password.tsx`** — 改密页（首次登录 + 日常改密共用）
   - 首次登录场景：只输入新密码（不要求旧密码，因为初始密码统一）
   - 日常改密场景：输入旧密码 + 新密码
   - 新密码强度校验（8 位+含字母数字）
   - 改密成功后跳 home

3. **新建 `packages/app/src/context/auth.tsx`** — user context
   ```tsx
   type CurrentUser = {
     id: string
     username: string
     role: "admin" | "user"
     displayName?: string
     must_change_password: boolean
   }
   const UserContext = createContext<CurrentUser>()
   export const useCurrentUser = () => {
     const user = useContext(UserContext)
     if (!user) throw new Error("useCurrentUser must be inside AuthGate")
     return { user, isAdmin: () => user.role === "admin" }
   }
   ```

4. **改 `packages/app/src/app.tsx`** — 加 AuthGate + 首次登录强制改密守卫
   ```tsx
   function AuthGate(props: ParentProps) {
     const me = createResource(() => fetch("/api/auth/me", { credentials: "include" }).then(r => {
       if (r.status === 401) throw new Error("unauth")
       return r.json()
     }))
     return (
       <Show when={!me.loading} fallback={<Splash />}>
         <Show when={me() && !me.error} fallback={<LoginPage />}>
           <UserContext.Provider value={me()}>
             {/* 首次登录强制改密：must_change_password=1 时跳改密页 */}
             <Show when={me().must_change_password} fallback={props.children}>
               <ChangePasswordPage forceMode />
             </Show>
           </UserContext.Provider>
         </Show>
       </Show>
     )
   }
   ```

5. **改 `packages/app/src/components/settings-v2/providers.tsx`** — 普通用户隐藏整个入口
   ```tsx
   const { isAdmin } = useCurrentUser()
   // 普通用户根本看不到"提供商设置"这个 tab/入口
   <Show when={isAdmin()}>
     <ProviderSettings />
   </Show>
   ```

6. **新建 `packages/app/src/pages/admin/users.tsx`** — 用户管理页（admin-only）
   - 用户列表（表格：实名/角色/状态/创建时间/最后登录）
   - 新建用户：**用户名从白名单下拉选**（调 `GET /api/auth/allowed-names`），不是自由输入
   - 重置密码（admin 输入新密码，重置后 `must_change_password=1`）
   - 禁用/启用用户
   - 踢人下线（revoke 该用户所有 token）
   - 改密/踢人操作记简单日志（写入 `operation_log` 表或直接 console.log + 文件）

7. **改侧边栏/导航** — admin 才看到"用户管理"入口

8. **改顶栏 user-menu** — 加"退出登录"按钮 + "修改密码"入口 + 显示当前登录实名

9. **改 `packages/app/src/i18n/zh.ts`** — 加登录页 + 改密页 + 用户管理 + 白名单相关文案

**验证标准**：
- 未登录访问任何页面 → 跳登录页
- 普通用户登录后看不到"提供商设置"和"用户管理"入口
- admin 登录后能看到所有入口
- 首次登录（`must_change_password=1`）→ 强制跳改密页，改完才能进系统
- 退出登录后 cookie 被清，跳登录页
- 修改密码后其他设备被踢出
- admin 创建用户时用户名是下拉选（白名单），不是自由输入
- 顶栏显示当前登录实名

**Commit 建议**：
1. `feat(app): add login page with must_change_password redirect` — pages/login.tsx
2. `feat(app): add change password page (force + voluntary modes)` — pages/change-password.tsx
3. `feat(app): add auth context with must_change_password field` — context/auth.tsx
4. `feat(app): add AuthGate with force-change-password guard` — app.tsx
5. `feat(app): hide provider settings for non-admin users` — settings-v2/providers.tsx
6. `feat(app): add admin user management page with whitelist dropdown` — pages/admin/users.tsx
7. `feat(app): add logout, change-password, and real-name display to user menu` — 顶栏组件
8. `feat(app): add i18n strings for auth, change-password, and user management` — i18n/zh.ts

---

### 阶段 5：部署 + 联调 + 备份（1 天）

**目标**：Docker 重建 + 30 人实测 + 定期备份

**任务清单**：

1. **改 `docker/api-keys.env`** — 确认 `OPENCODE_SERVER_PASSWORD` 已设置

2. **改 `packages/opencode/src/index.ts`** — 启动时调用 `bootstrapAdmin()`

3. **Docker 重建镜像**
   ```powershell
   powershell -ExecutionPolicy Bypass -File .\docker\build.ps1 `
     -EnvFile "D:\AI\opencode\docker\api-keys.env" `
     -ForceRebuild
   ```

4. **加定期备份** — 在容器 entrypoint 或 cron 里加
   ```sh
   # 每天凌晨 2 点备份，保留 7 天
   0 2 * * * cp /root/.local/share/opencode/opencode.db /root/.local/share/opencode/backup/opencode-$(date +\%Y\%m\%d).db && find /root/.local/share/opencode/backup/ -mtime +7 -delete
   ```

5. **局域网 30 人实测**
   - admin 登录 → 看到 29 个已创建的普通用户
   - 普通用户用初始密码登录 → 强制跳改密页 → 改完进系统
   - 普通用户看不到 provider 设置、看不到用户管理
   - 两个普通用户互看不到对方 session
   - admin 能看到全员 session
   - 改密后其他设备被踢
   - 用户"上官兵"创建 session → 文件系统出现 `/workspace/上官兵/` 目录
   - 30 人同时在线无卡顿

6. **改 `docker/readme.md`** — 补多用户部署说明
   - 首次启动必须设 `OPENCODE_SERVER_PASSWORD`
   - `allowed-names.txt` 文件的作用和编辑方式
   - 首次登录强制改密流程
   - admin 创建/管理用户的操作步骤
   - 备份恢复说明

**验证标准**：
- 容器启动无报错
- 首次启动自动创建 admin + 29 个普通用户
- 普通用户首次登录被强制改密
- 30 人并发无卡顿
- 备份文件正常生成
- 白名单文件挂载正确（编辑后重启生效）

**Commit 建议**：
1. `feat(opencode): call bootstrapAdmin on startup` — index.ts
2. `chore(docker): ensure OPENCODE_SERVER_PASSWORD is set` — api-keys.env（不提交密码，只确认机制）
3. `feat(docker): mount allowed-names.txt and add env var` — docker-compose 或 run 脚本
4. `feat(docker): add daily sqlite backup cron` — Dockerfile 或 entrypoint 脚本
5. `docs(docker): document multi-user deployment with whitelist` — docker/readme.md

---

## 三、总工作量估算

| 阶段 | 天数 | 说明 |
|---|---|---|
| 阶段 1：数据层 | 2 天 | 含白名单读取 + 初始用户种子 + 真实老库 dry-run |
| 阶段 2：后端认证 | 2 天 | 含限速 + 启动引导 + 首次改密逻辑 |
| 阶段 3：业务隔离 + 文件路径 | 1.5 天 | session 过滤 + credential POST + 实名目录隔离 |
| 阶段 4：前端 | 2 天 | 登录页 + 改密页 + AuthGate + 用户管理（白名单下拉） |
| 阶段 5：部署 | 1 天 | Docker 重建 + 白名单挂载 + 30 人实测 + 备份 |
| **合计** | **8.5 天** | 不算联调测试文档 |

---

## 四、风险检查清单（开工前确认）

- [ ] `docker/api-keys.env` 里 `OPENCODE_SERVER_PASSWORD` 已设置
- [ ] `docker/allowed-names.txt` 名单核对无误（当前 29 人）
- [ ] 从生产 cp 一份 `opencode.db` 到本地用于 dry-run 测试
- [ ] 确认 30 人里谁是 admin（建议 2 人，互为备份）
- [ ] 确认历史 session 数量（< 100 全划 legacy；> 100 考虑加"接管"工具）
- [ ] 确认是否需要"用户自己改密码"功能（建议做，已含在阶段 2/4）

---

> **执行入口**：本文档是实施指导，按"阶段 1 → 阶段 5"顺序执行，每个阶段独立 commit。开工前先完成第四章风险检查清单。
