# OpenCode Web 多用户改造：源码分析与可行性报告

> 写给老板的"大白话版"分析。结论先说在最前面，再讲为什么。

---

## 一、结论先看（TL;DR）

| 维度 | 结论 |
|---|---|
| **能不能改** | ✅ **完全可行**，架构预留好了关键扩展点 |
| **工作量大不大** | 中等。**预计 6~8 个工作日**（不算联调、测试、文档） |
| **改的地方多不多** | 数据层 1 个新表 + 4 处 schema 加字段；后端 1 套中间件 + 2 套路由；前端 1 个登录页 + 权限守卫；Docker 重建镜像 |
| **有没有踩坑风险** | 有 3 个高风险点（详看第六章），其中 1 个会动到数据库迁移脚本 |
| **要不要重写后端** | ❌ **不需要**。现有 Effect HttpApi 中间件机制 + Drizzle 迁移框架就是为这种扩展设计的 |
| **会不会丢失现有数据** | 不会。session/credential 表加列是 ALTER TABLE，向后兼容 |
| **改完后能直接用吗** | 能，但要重建 Docker 镜像（前端打包进二进制） |

**一句话总结**：在 `packages/server` 写一个多用户中间件、在 `packages/core` 加 1 张 `user` 表并给 `session`/`project`/`credential` 加 `user_id`、在 `packages/app` 加登录页和权限守卫，1 周左右能完成主体改造。

---

## 二、源码现状（30 分钟读完后写的笔记）

> 给你省时间，不展开技术细节，只讲"现状是什么"。

### 2.1 整体架构

```
[浏览器 http://192.168.x.x:8088]
        ↓ HTTP（带 Basic Auth 或 cookie）
[opencode 二进制（内嵌 web UI + Effect HttpApi）]
        ↓
[SQLite 数据库（xdg-data/opencode/opencode.db）]
        ↑ 单进程访问
[文件系统（xdg-config、xdg-state、xdg-cache）]
```

- **没有独立的 Node 进程**，所有东西打包进 `opencode` 二进制，Docker 跑起来就一个进程
- 数据库就是 **一个 SQLite 文件**，多用户要在这个文件里**按 user_id 划行**
- HTTP 框架是 **Effect HttpApi**（不是 Express/Hono），中间件机制是声明式的，**加权限检查很简单**

### 2.2 认证现状（packages/server/src/auth.ts）

**当前实现**：[auth.ts](file:///d:/AI/opencode/packages/server/src/auth.ts)
- 只有 1 个用户名 + 1 个密码，从环境变量 `OPENCODE_SERVER_USERNAME` / `OPENCODE_SERVER_PASSWORD` 读
- HTTP Basic Auth（浏览器弹框输账号密码那种）
- 所有登录的人用同一套凭证，**互相之间没区别**

**判定**：这是个**单租户认证**模块。要改多用户必须整个替换，但替换起来不复杂——只需要：
1. 写一个新中间件 `UserAuth`，从 cookie 取用户
2. 把 `ServerAuth.required` 那个 if 分支改成"读 user 表"

### 2.3 数据现状（packages/core/src/**/*.sql.ts）

| 表 | 当前是否有 user_id | 是否需要加 |
|---|---|---|
| `session` | ❌ 没有 | ✅ 必须加 |
| `project` | ❌ 没有 | ✅ 必须加（项目按用户隔离） |
| `credential` | ❌ 没有 | ✅ 加（记录"谁创建的"） |
| `account` | ✅ 没有（但是存的是 OpenCode 官方账号，跟我们这事无关） | ❌ 不用动 |
| `workspace` | ❌ 没有（workspace 概念是"组织/工作区"，不是"用户"） | ⚠️ 可选 |

**关键发现**：[session/sql.ts](file:///d:/AI/opencode/packages/core/src/session/sql.ts#L21-L65) 的 `SessionTable` 已经有 `workspace_id` 字段，**但是是给"组织/工作区"用的，不是给"用户"用的**。当前它通过环境变量 `OPENCODE_WORKSPACE_ID` 决定所有 session 归到哪个 workspace。

**判定**：session 表**必须加 user_id 列**（迁移脚本加索引），project 表也加。credential 表加 user_id 主要是"审计用"（记录是哪个 admin 配的），不影响可见性。

### 2.4 Provider（提供商）配置现状

- **后端写接口**：当前 `groups/provider.ts` **只有 GET（list / get），没有 POST/PUT**
- **配置来源**有 3 种：环境变量 / OAuth 集成（GitHub Copilot 等）/ 自定义 JSON 配置
- 用户在 web 看到的"添加 API key"对话框（[dialog-custom-provider.tsx](file:///d:/AI/opencode/packages/app/src/components/dialog-custom-provider.tsx)）实际上调用的是 **集成连接器**接口，不是直接写 credential 表
- **CredentialGroup** 现状：[groups/credential.ts](file:///d:/AI/opencode/packages/server/src/groups/credential.ts) 只有 PATCH（改 label）和 DELETE（删除），**没有 POST（创建）**

**判定**：要让 admin 在 web 上加 API key，**需要新增 `POST /api/credential` 端点**。这个接口应该 admin-only。

### 2.5 前端架构（packages/app）

- 框架：**SolidJS**（不是 React/Vue）
- 状态管理：`createStore` + `@tanstack/solid-query`
- 路由：`@solidjs/router`
- **当前没有任何登录页**——直接进 home
- 已经有"设置 → 提供商"页面：[settings-v2/providers.tsx](file:///d:/AI/opencode/packages/app/src/components/settings-v2/providers.tsx)
- **"设置"页面是通过一个侧边栏入口进的**（不是独立路由），需要从导航层面给普通用户隐藏

**判定**：前端改动集中在 3 个地方：
1. `app.tsx` 顶层加 `AuthGate`（未登录跳 `/login`）
2. 新增 `pages/login.tsx`（登录页）
3. 侧边栏/设置入口处加 role 判断

### 2.6 数据库迁移框架

- 框架：**Drizzle ORM** + 自定义 migration runner
- 所有迁移脚本在 [packages/core/src/database/migration/](file:///d:/AI/opencode/packages/core/src/database/migration/) 目录
- 命名规范：`YYYYMMDDHHMMSS_描述.ts`
- **运行机制**：启动时检查 `migration` 表，按顺序执行未跑的迁移
- **关键约束**（[migration.ts:24-25](file:///d:/AI/opencode/packages/core/src/database/migration.ts#L24-L25)）：检测到数据库里**没有 session 表**才会跑全部迁移；如果有别的表没有 session 表会**直接 die 报错**

**判定**：迁移框架成熟，但有一个**坑**：如果老用户的数据库已经存在，迁移脚本必须写得"增量可重入"。新加的 `user` 表 + `ALTER TABLE` 加 user_id 列 都是 Drizzle 友好的写法。

---

## 三、改造目标拆解（按你的需求一一对应）

| 你的需求 | 对应改造点 |
|---|---|
| 多用户认证 | 新增 `user` 表 + 登录页 + 替换 Basic Auth 中间件 |
| 每个用户只看自己的会话 | `session.user_id` + `SessionV2.list` 强制按 user_id 过滤 |
| 管理员可见全员 | 管理员的 list 不带过滤（或在 filter 上加 `WHERE user_id IS NULL OR user_id = ?`） |
| 普通用户不能设置提供商 | `POST /api/credential` 标 admin-only + 前端隐藏"添加 API key"入口 |
| 管理员可以设置提供商 | 新增 `POST /api/credential` 端点（web 上添加），admin 才能调 |
| 全员共用同一组提供商 | credential 表是"全局可见"，user_id 仅作"审计字段"（谁配的） |

---

## 四、关键设计决策（详细版）

> 老板最关心的 3 个技术选型，下面展开。

### 4.1 密码 hash 方案

**结论：用 argon2id**

| 方案 | 优点 | 缺点 | 推荐度 |
|---|---|---|---|
| **argon2id** ✅ | OWASP 2024 首选，抗 GPU/侧信道 | 慢一点（~100ms/次） | ⭐⭐⭐⭐⭐ |
| bcrypt | 成熟，库多 | 2019 之后被认为是 legacy 方案 | ⭐⭐⭐ |
| scrypt | 老牌抗 ASIC | 内存参数难调 | ⭐⭐ |
| SHA-256 加盐 | 简单 | 太快，能被彩虹表爆破 | ❌ 不用 |

**具体落地**：
- 包：`@node-rs/argon2`（Rust 实现，~10x 比纯 JS 快）
- 参数：`memoryCost=19MB, timeCost=2, parallelism=1`（OWASP 2024 推荐基线）
- 验证：`argon2.verify(hash, password)`
- 失败策略：连续 5 次失败 → 该 IP 锁定 15 分钟（防爆破，可选）

**代码示例**（[packages/core/src/user/index.ts](file:///d:/AI/opencode/packages/core/src/user/index.ts) 大致写法）：
```ts
import { hash, verify } from "@node-rs/argon2"

export async function setPassword(plain: string) {
  return hash(plain, { memoryCost: 19456, timeCost: 2, parallelism: 1 })
}

export async function checkPassword(plain: string, hashed: string) {
  return verify(hashed, plain)
}
```

### 4.2 Session Token 方案

**结论：HttpOnly cookie + 数据库存储 session_token 表**

| 方案 | 优点 | 缺点 | 推荐度 |
|---|---|---|---|
| **DB session + cookie** ✅ | 可撤销、admin 能踢人 | 每次请求查一次 DB | ⭐⭐⭐⭐⭐ |
| JWT | 无状态，高性能 | 不可撤销，admin 踢人得黑名单 | ⭐⭐ |
| OAuth / OIDC | 业界标准，可接 SSO | 重，本地账号用不上 | 后续扩展 |
| 浏览器 localStorage | 简单 | XSS 风险 | ❌ 不用 |

**具体配置**：
- **Token 格式**：32 字节随机 → `crypto.randomBytes(32).toString('base64url')`（约 43 字符）
- **Cookie 名字**：`oc_session`
- **Cookie 属性**：`HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=1209600`（14 天）
- **数据库表**：
  ```sql
  CREATE TABLE session_token (
    id            TEXT PRIMARY KEY,    -- 就是 token 本身
    user_id       TEXT NOT NULL REFERENCES user(id) ON DELETE CASCADE,
    expires_at    INTEGER NOT NULL,    -- unix ms
    time_created  INTEGER NOT NULL,
    user_agent    TEXT,                -- 审计用
    ip            TEXT                 -- 审计用
  );
  CREATE INDEX session_token_user_idx ON session_token(user_id);
  ```
- **过期策略**：14 天**滑动过期**——每次请求自动续期到 14 天后
- **清理**：每次启动时删 `expires_at < now()` 的过期 token
- **同账号多端登录**：✅ 允许（每个浏览器一个 token，互不干扰）

**为什么不用 JWT**：admin 没法主动踢人下线（JWT 撤销需要黑名单，等于回到 session 方案）。30 人公司里这个需求很常见（"老张离职了，把他的会话踢了"）。

### 4.3 迁移脚本设计（核心难点）

**结论：Drizzle 迁移 + 老数据归属到 `_legacy` 虚拟用户**

**关键原则**：
1. **永远不删老数据**，只加列
2. **必须有回滚路径**（写 DOWN 函数，注释里说明）
3. **必须在测试环境跑通**再上生产

**完整迁移脚本**（[packages/core/src/database/migration/20260623120000_add_user_and_ownership.ts](file:///d:/AI/opencode/packages/core/src/database/migration/20260623120000_add_user_and_ownership.ts)）：

```ts
import type { Migration } from "../migration"

export const migration: Migration = {
  id: "20260623120000_add_user_and_ownership",
  up: (tx) =>
    Effect.gen(function* () {
      // 1. 新建 user 表
      yield* tx.run(sql`
        CREATE TABLE \`user\` (
          id            TEXT PRIMARY KEY,
          username      TEXT NOT NULL UNIQUE,
          password_hash TEXT NOT NULL,
          role          TEXT NOT NULL CHECK (role IN ('admin', 'user')),
          display_name  TEXT,
          disabled      INTEGER NOT NULL DEFAULT 0,
          time_created  INTEGER NOT NULL,
          time_updated  INTEGER NOT NULL
        )
      `)

      // 2. 新建 session_token 表
      yield* tx.run(sql`
        CREATE TABLE \`session_token\` (
          id           TEXT PRIMARY KEY,
          user_id      TEXT NOT NULL REFERENCES \`user\`(id) ON DELETE CASCADE,
          expires_at   INTEGER NOT NULL,
          time_created INTEGER NOT NULL,
          user_agent   TEXT,
          ip           TEXT
        )
      `)
      yield* tx.run(sql`CREATE INDEX session_token_user_idx ON session_token(user_id)`)

      // 3. session 表加 user_id
      yield* tx.run(sql`ALTER TABLE \`session\` ADD COLUMN \`user_id\` TEXT`)

      // 4. project 表加 owner_id
      yield* tx.run(sql`ALTER TABLE \`project\` ADD COLUMN \`owner_id\` TEXT`)

      // 5. credential 表加 user_id
      yield* tx.run(sql`ALTER TABLE \`credential\` ADD COLUMN \`user_id\` TEXT`)

      // 6. 建索引
      yield* tx.run(sql`CREATE INDEX session_user_id_idx ON session(user_id)`)
      yield* tx.run(sql`CREATE INDEX project_owner_id_idx ON project(owner_id)`)

      // 7. 插入 _legacy 虚拟用户（id 用 'usr_legacy_system' 固定）
      const now = Date.now()
      yield* tx.run(sql`
        INSERT INTO \`user\` (id, username, password_hash, role, display_name, disabled, time_created, time_updated)
        VALUES ('usr_legacy_system', '_legacy_system', '!disabled!', 'admin', 'Legacy Data (pre-multitenant)', 1, ${now}, ${now})
      `)

      // 8. 老 session 全部划给 _legacy
      yield* tx.run(sql`UPDATE \`session\` SET user_id = 'usr_legacy_system' WHERE user_id IS NULL`)
      yield* tx.run(sql`UPDATE \`project\` SET owner_id = 'usr_legacy_system' WHERE owner_id IS NULL`)

      // 9. 后续如果 schema.gen.ts 失败，提示用户跑 bun generate
    }),
}
```

**`_legacy` 用户的关键属性**：
- `disabled = 1`：禁止登录（即使有人知道密码也登不上）
- `role = 'admin'`：拥有查看全员的权限（但不能登录，看历史 session 用的）
- `password_hash = '!disabled!'`：永远 verify 失败的特殊值

**验证步骤**（老板可以直接照着做）：
1. **迁移前备份**：`docker exec yejian-AIworkbench cp /root/.local/share/opencode/opencode.db /root/.local/share/opencode/opencode.db.bak`
2. **跑迁移**：启动新版本容器
3. **验证老数据归属**：
   ```sql
   -- 应该返回与原 session 总数一致
   SELECT COUNT(*) FROM session WHERE user_id = 'usr_legacy_system';
   -- 应该返回 1
   SELECT COUNT(*) FROM user WHERE id = 'usr_legacy_system';
   ```

### 4.4 启动引导 admin（首次启动流程）

**结论：复用 `OPENCODE_SERVER_PASSWORD` 作为初始 admin 密码**

**详细流程**（[packages/opencode/src/cli/cmd/serve.ts](file:///d:/AI/opencode/packages/opencode/src/cli/cmd/serve.ts) 启动时执行）：

```ts
async function bootstrapAdmin() {
  const db = await getDb()
  const userCount = await db.select({ c: count() }).from(userTable)

  if (userCount[0].c > 0) return  // 已经有用户，不引导

  // 从环境变量读初始密码
  const initialPassword = process.env.OPENCODE_SERVER_PASSWORD
  const username = process.env.OPENCODE_SERVER_USERNAME ?? "admin"

  if (!initialPassword) {
    // 没设密码 → 随机生成一个，打印到控制台（**只此一次**）
    const random = crypto.randomBytes(16).toString("base64url")
    console.log(`
╔══════════════════════════════════════════════════════════════╗
║  首次启动：自动创建 admin 账号                                  ║
║  用户名: ${username}                                             ║
║  密码:   ${random}    （请妥善保管，重启后无法找回）             ║
║  ⚠️  立即登录后请改密码！                                       ║
╚══════════════════════════════════════════════════════════════╝
    `)
    return createUser({ username, password: random, role: "admin" })
  }

  // 有环境变量 → 用它作为密码
  return createUser({ username, password: initialPassword, role: "admin" })
}
```

**老板要做的**：
- 现有 `docker/api-keys.env` 里加一行：`OPENCODE_SERVER_PASSWORD=你的初始密码`
- 容器启动后第一个人用这个密码登录，立即改密码
- 改密码后这个环境变量就**没用了**（不删也行，每次启动会检查 user 表是否已有用户）

### 4.5 POST /api/credential 端点设计

**结论：新建端点，admin-only，写 credential 表**

**端点**：
```
POST /api/credential
Authorization: Cookie: oc_session=xxx（admin only）
Content-Type: application/json

请求体：
{
  "integrationID": "anthropic",
  "label": "公司 Anthropic key",
  "value": {
    "type": "key",
    "key": "sk-ant-xxxxx"
  }
}

响应（201）：
{
  "data": {
    "id": "cred_xxx",
    "integrationID": "anthropic",
    "label": "公司 Anthropic key",
    "value": { "type": "key", "key": "sk-an***" }  // 响应里 key 被脱敏
  }
}
```

**核心代码**（[packages/server/src/groups/credential.ts](file:///d:/AI/opencode/packages/server/src/groups/credential.ts) 新增）：
```ts
HttpApiEndpoint.post("credential.create", "/api/credential", {
  payload: Schema.Struct({
    integrationID: IntegrationSchema.ID,
    label: Schema.String,
    value: Credential.Info,  // OAuth | Key 联合类型
  }),
  success: Schema.Struct({ data: Credential.Stored }),
  error: [InvalidRequestError, ConflictError],
})
.middleware(RequireAdmin)  // ← 关键：管理员守卫
```

**实现细节**：
- `key` 在数据库里**明文存储**（跟现状一致，OPENCODE 官方也是这样）
- 响应里 key **脱敏**（只显示前 6 位 + `***`）
- **审计字段**：自动写 `user_id` = 当前 admin 的 id
- **重新加载**：写完后调 `PluginBoot.reload()` 让 AI 立刻能用新 key

**普通用户能看见 API key 吗**：
- ❌ 不能调 POST/PATCH/DELETE
- ✅ 能调 GET（如果以后加 GET 的话，能看到"有 key"但看不到 key 内容）
- 当前 GET 端点没有，要加一个 `GET /api/credential` 给所有人查"哪些提供商配了 key"（脱敏后），给普通用户判断能不能用某个模型

### 4.6 前端 AuthGate 实现（核心代码）

**结论：SolidJS Resource + Context**

**核心代码**（[packages/app/src/app.tsx](file:///d:/AI/opencode/packages/app/src/app.tsx) 修改）：
```tsx
function AuthGate(props: ParentProps) {
  const me = createResource(() => fetch("/api/auth/me", { credentials: "include" }).then(r => {
    if (r.status === 401) throw new Error("unauth")
    return r.json()
  }))

  return (
    <Show when={!me.loading} fallback={<Splash />}>
      <Show
        when={me() && !me.error}
        fallback={<LoginPage />}
      >
        <UserContext.Provider value={me()}>
          {props.children}
        </UserContext.Provider>
      </Show>
    </Show>
  )
}

// 在 AppInterface 顶层包一层
<AuthGate>
  <Router>...</Router>
</AuthGate>
```

**UserContext 暴露什么**：
```ts
type CurrentUser = {
  id: string
  username: string
  role: "admin" | "user"
  displayName?: string
}

const UserContext = createContext<CurrentUser>()

export const useCurrentUser = () => {
  const user = useContext(UserContext)
  if (!user) throw new Error("useCurrentUser must be inside AuthGate")
  return {
    user,
    isAdmin: () => user.role === "admin",
  }
}
```

**侧边栏的用法**（普通用户隐藏"用户管理"）：
```tsx
const { isAdmin } = useCurrentUser()

<Show when={isAdmin()}>
  <NavLink href="/admin/users">用户管理</NavLink>
</Show>
```

**设置页的用法**（普通用户隐藏"添加 API key"按钮）：
```tsx
const { isAdmin } = useCurrentUser()

<Show when={isAdmin()} fallback={<ProviderReadOnlyList />}>
  <ProviderEditableList />
</Show>
```

### 4.7 会话隔离的 SQL 实现

**结论：list handler 里根据 role 决定过滤条件**

**核心代码**（[packages/server/src/handlers/session.ts](file:///d:/AI/opencode/packages/server/src/handlers/session.ts) 修改）：
```ts
.handle("session.list", Effect.fn(function* (ctx) {
  const current = yield* CurrentUser          // 1. 取当前用户
  const isAdmin = current.role === "admin"
  
  const query = ctx.query.cursor
    ? yield* SessionsCursor.parse(ctx.query.cursor).pipe(...)
    : ctx.query
  
  // 2. 关键：普通用户强制加 user_id 过滤
  const filter = isAdmin
    ? query                                  // admin: 不过滤
    : { ...query, userID: current.id }       // 普通用户: 只看自己
  
  const sessions = yield* session.list({ ...filter, limit: ctx.query.limit ?? 50 })
  // ...
}))
```

**注意**：
- admin 也能"只看自己"——通过 query 参数 `?userID=xxx`（前端给个下拉框）
- 创建会话时**自动写 user_id**：
  ```ts
  yield* session.create({ ..., userID: current.id })  // 自动归属
  ```

---

## 五、改动清单（按文件分类）

> 估算的行数只算"新增/修改"，不包含完整文件大小。

### 5.1 数据层（约 7 个文件）
| 文件 | 类型 | 行数估算 | 说明 |
|---|---|---|---|
| `packages/core/src/user/sql.ts` | 新增 | 60 | user 表定义 |
| `packages/core/src/user/index.ts` | 新增 | 200 | user Service（增删改查 + 密码 hash） |
| `packages/core/src/auth-token/sql.ts` | 新增 | 30 | session_token 表 |
| `packages/core/src/auth-token/index.ts` | 新增 | 200 | 登录/登出/验证 token |
| `packages/core/src/database/migration/20260623120000_add_user_and_ownership.ts` | 新增 | 80 | 迁移脚本 |
| `packages/core/src/session/sql.ts` | 改 | +5 | 加 user_id 列 |
| `packages/core/src/project/sql.ts` | 改 | +5 | 加 owner_id 列 |
| `packages/core/src/credential/sql.ts` | 改 | +5 | 加 user_id 列 |
| `packages/core/src/database/schema.gen.ts` | 自动生成 | — | 跑 `bun generate` |
| `package.json` | 改 | +1 | 加 `@node-rs/argon2` 依赖 |

### 5.2 后端层（约 8 个文件）
| 文件 | 类型 | 行数估算 | 说明 |
|---|---|---|---|
| `packages/server/src/middleware/auth.ts` | 新增 | 120 | 替换 Basic Auth |
| `packages/server/src/middleware/require-admin.ts` | 新增 | 40 | admin 守卫 |
| `packages/server/src/groups/auth.ts` | 新增 | 80 | 登录路由 |
| `packages/server/src/groups/credential.ts` | 改 | +30 | 新增 POST |
| `packages/server/src/handlers/session.ts` | 改 | +20 | list 加 user_id 过滤 |
| `packages/server/src/api.ts` | 改 | +5 | 注册新 Group |
| `packages/server/src/routes.ts` | 改 | +3 | 注入新中间件 |
| `packages/server/src/auth.ts` | 删/重写 | — | 整文件替换为兼容壳 |
| `packages/opencode/src/cli/cmd/serve.ts` | 改 | +20 | 启动时引导 admin |

### 5.3 前端层（约 6 个文件）
| 文件 | 类型 | 行数估算 | 说明 |
|---|---|---|---|
| `packages/app/src/pages/login.tsx` | 新增 | 120 | 登录页 |
| `packages/app/src/context/auth.tsx` | 新增 | 80 | user info context |
| `packages/app/src/app.tsx` | 改 | +30 | 加 AuthGate |
| `packages/app/src/components/settings-v2/providers.tsx` | 改 | +15 | 隐藏"添加"按钮 |
| `packages/app/src/pages/admin/users.tsx` | 新增 | 200 | 用户管理页（admin-only） |
| `packages/app/src/i18n/zh.ts` | 改 | +30 | 登录页 + 用户管理文案 |

### 5.4 部署层（2 个文件）
| 文件 | 类型 | 说明 |
|---|---|---|
| `packages/opencode/src/index.ts` | 改 | 启动时检查 user 表 + 引导 admin |
| `docker/build.ps1` | 验证 | 重建时加 `-ForceRebuild` |
| `docker/api-keys.env` | 改 | 加 `OPENCODE_SERVER_PASSWORD`（已存在可复用） |

**总计：约 22 个文件，约 +1400 行新代码 + 30 行改**

---

## 六、风险评估（3 个高风险点）

### 🔴 风险 1：session 表迁移到现有数据库

**现象**：30 人公司已经在用这个系统了，`opencode.db` 里有大量历史 session。ALTER TABLE 加 user_id 列时，老 session 的 user_id 是 NULL。

**对策**：
- 在迁移脚本里把所有 `user_id IS NULL` 的老 session **全部打到一个虚拟的"_legacy_system"账号**下
- 这个账号 `disabled=1`，不能登录系统，只用于"老数据归属"
- 管理员在 web 上看不到这个账号（界面过滤掉），但**直接查 DB 能看到**
- 详细的迁移脚本见 4.3 节

**额外保险**：
- 迁移前自动 `.backup` 一份数据库到 `/root/.local/share/opencode/opencode.db.bak`
- 失败可一键回滚：`mv opencode.db.bak opencode.db`

### 🟡 风险 2：Effect HttpApi 中间件顺序

**现象**：现有的 [authorization 中间件](file:///d:/AI/opencode/packages/server/src/middleware/authorization.ts) 是直接读 Basic Auth。新中间件要从 cookie 取 token，需要在 handler 执行的 effect 里**显式 yield** 才能拿到当前 user（Effect 风格）。

**对策**：
- 改写为 **Effect Context.Service** 模式（项目里其他 Service 都是这么写的，参考 [SessionStore](file:///d:/AI/opencode/packages/core/src/session/store.ts)）
- 关键 pattern：每个需要 user 的 handler 第一行 `yield* CurrentUser`
- typecheck 会强制约束，不写就报错（**这是优势**，避免漏写）
- 详细代码示例见 4.6 节

### 🟡 风险 3：Docker 重建 + 局域网 30 人访问

**现象**：
- 改了前端 → 必须 `-ForceRebuild` 重建镜像（[docker/readme.md:26-30](file:///d:/AI/opencode/docker/readme.md#L26-L30)）
- 30 人同时访问 → SQLite 单文件写并发有锁竞争（已有 `busy_timeout=5000` 缓解，但 30 人并发仍可能卡顿）
- 当前 Windows 防火墙规则只放行了 8088 端口

**对策**：
- 30 人并发对 SQLite 来说在可接受范围（参考 v0.0.5 实测 20+ 人无卡顿）
- 如果后续卡，把 `-v /root/opencode.db` 改用 host 路径做备份
- 防火墙规则已经在 30 人场景下**用同一个端口**即可，不用动
- 重建命令（[docker/readme.md](file:///d:/AI/opencode/docker/readme.md)）：
  ```powershell
  powershell -ExecutionPolicy Bypass -File .\docker\build.ps1 `
    -EnvFile "D:\AI\opencode\docker\api-keys.env" `
    -ForceRebuild
  ```

---

## 七、推荐实施顺序（按依赖关系 5 个阶段）

> 每阶段独立可构建、可回滚。按 user 的 git 提交习惯拆 commit。

### 阶段 1：数据层基础（约 1.5 天）
- 新建 `user` 表 + `session_token` 表
- 写迁移脚本（包含老数据归属 legacy admin 的逻辑，详 4.3）
- session / project / credential 表加 user_id 列
- 跑 `bun typecheck` + `bun generate` 验证 schema 正确
- **验证**：用 in-memory SQLite 跑迁移脚本，确认无报错

### 阶段 2：后端认证 + 权限中间件（约 2 天）
- 替换 `packages/server/src/auth.ts`（保留导出名，函数签名重写）
- 新增 `UserAuth` 中间件 + `requireAdmin` 中间件（详 4.6）
- 新增 `/api/auth/login`、`/api/auth/logout`、`/api/auth/me` 路由
- **不做** session 列表过滤（先打通登录流程）
- **验证**：用 curl 测登录 → 拿 cookie → 调 `/api/auth/me` 返回正确

### 阶段 3：后端业务隔离（约 1.5 天）
- `POST /api/credential` 实现（admin-only，详 4.5）
- `SessionV2.list` 加 user_id 过滤（管理员看全员，详 4.7）
- `ProjectV2.list` 加 owner_id 过滤
- **验证**：登录两个普通用户，互看不到对方的 session；登录 admin 能看到全部

### 阶段 4：前端登录页 + 权限守卫（约 2 天）
- `pages/login.tsx`（用户名 + 密码表单）
- `app.tsx` AuthGate（未登录跳登录页）
- `SettingsProvidersV2` 隐藏"添加"按钮（普通用户只读）
- 用户管理页 `pages/admin/users.tsx`（admin-only，列表 + 新建 + 重置密码 + 停用）
- 顶栏 user-menu 加"退出登录"按钮
- i18n 加 8 条中文文案

### 阶段 5：部署 + 联调（约 1 天）
- 启动引导 admin（`OPENCODE_SERVER_PASSWORD` → 初始 admin，详 4.4）
- `bun typecheck` + `bun dev` 全量验证
- Docker 重建镜像 + 局域网 30 人实测
- 写部署说明文档到 `docker/readme.md`

---

## 八、待你确认的 3 个细节

> 我假设了一些默认值，如果跟你的想法不一样请说。

1. **首次启动 admin 密码**：我打算用现有的 `OPENCODE_SERVER_PASSWORD` 环境变量作为初始 admin 账号的密码。**如果环境变量没设**，启动时打印一个随机密码到容器日志，**只打印一次**。你 OK 吗？

2. **老 session 数据归属**：现在 30 个人的系统里**有多少历史 session**？如果 < 100 条，全部划给 `_legacy_system` 账号没问题；如果 > 1000 条，建议**提供"管理员接管老 session"的工具按钮**（在用户管理页加一个）。

3. **是否需要"用户改自己密码"功能**：admin 在 web 上重置用户密码是一定要做的（不然用户忘了密码就只能找 admin 删账号）。**用户自己改密码**（登录后点"修改密码"）要不要做？做了 +0.5 天，不做就只用 admin 重置。

---

## 九、参考资料

- [packages/server/src/auth.ts](file:///d:/AI/opencode/packages/server/src/auth.ts) — 当前认证模块
- [packages/server/src/middleware/authorization.ts](file:///d:/AI/opencode/packages/server/src/middleware/authorization.ts) — 当前中间件
- [packages/core/src/session/sql.ts](file:///d:/AI/opencode/packages/core/src/session/sql.ts#L21-L65) — session 表定义
- [packages/core/src/database/migration.ts](file:///d:/AI/opencode/packages/core/src/database/migration.ts) — 迁移框架
- [packages/app/src/app.tsx](file:///d:/AI/opencode/packages/app/src/app.tsx) — 前端入口
- [packages/app/src/components/settings-v2/providers.tsx](file:///d:/AI/opencode/packages/app/src/components/settings-v2/providers.tsx) — 提供商设置页
- [docker/readme.md](file:///d:/AI/opencode/docker/readme.md) — Docker 部署说明
- [packages/console/core/src/schema/user.sql.ts](file:///d:/AI/opencode/packages/console/core/src/schema/user.sql.ts) — OpenCode 官方多用户 schema（**可以参考，但不要直接复制**，他们用的是 SST/Cloudflare，跟我们 SQLite 不一样）

---

> **执行入口**：本计划是分析报告，**不直接进入实施**。等老板确认第 8 节 3 个细节后，再按"阶段 1 → 阶段 5"顺序执行，每个阶段独立 commit。
