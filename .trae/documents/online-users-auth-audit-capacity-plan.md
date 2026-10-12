# 实施计划：在线用户展示 + 登录审计日志 + Docker 容量评估

## Context（背景）

本项目是 fork 自 anomalyco/opencode 的多用户版本（v.1.17.6 分支），Docker 单容器部署于局域网，约 32 个账号使用。管理员目前只能看到账号列表，无法知道**谁正在使用**，也没有登录行为的审计记录。本计划新增三个交付物：

1. **功能 A — 在线用户页面**：管理员可查看当前正在使用的账号（活跃判定：最近 15 分钟内有请求活动，基于现有 `session_token.last_extend_at` 机制，无新增心跳）
2. **功能 B — 登录审计**：记录登录成功 / 登出 / 登录失败 / 管理员踢下线 / 管理员禁用五类事件，写入数据库表（管理界面可查）+ 按天 JSONL 日志文件（数据卷持久化）+ 容器控制台
3. **功能 C — Docker 容量分析**：评估当前部署最多承载多少并发用户、短板在哪（纯分析，不改代码，输出报告）

**已确认的设计决策**（用户选择）：活跃判定 / 独立在线页面 / DB表+日志文件 / 记录五类事件（踢下线与禁用分开记录，审计语义不混淆）/ 在线页带「踢下线」按钮 / 审计不做防篡改外发、在线页用拉取式（15s 轮询）——后三项为 2026-10-12 智囊评审确认。

---

## 功能 A + B：后端改动

### A1. 数据库迁移（新建 1 文件）

**文件**：`packages/core/src/database/migration/20261012100000_add_auth_audit.ts`
（命名对齐现有迁移文件模式，参照 [20260625120000_add_user_and_ownership.ts](file:///d:/AI/opencode/packages/core/src/database/migration/20260625120000_add_user_and_ownership.ts) 的 `satisfies DatabaseMigration.Migration` 写法）

```sql
CREATE TABLE auth_audit (
  id text PRIMARY KEY,            -- crypto.randomUUID()
  user_id text,                   -- 可空：登录失败且用户不存在时为空
  username text NOT NULL,         -- 用户名快照，用户被删除后日志仍可读
  action text NOT NULL,           -- 'login' | 'logout' | 'login_failed' | 'kicked' | 'disabled'
  ip text,
  user_agent text,
  operator text,                  -- 操作管理员用户名（kicked / disabled 时记录）
  time_created integer NOT NULL,
  time_updated integer NOT NULL
);
CREATE INDEX auth_audit_user_idx ON auth_audit (user_id);
CREATE INDEX auth_audit_time_idx ON auth_audit (time_created);
```

不需要 `foreign key`（user_id 仅为关联查询用，删除用户不级联删日志）。

### A2. drizzle 表定义 + 核心服务：AuthAudit（新建 2 文件）

**文件**：`packages/core/src/auth-audit/sql.ts`（AuthAuditTable drizzle 表定义，参照 [auth-token/sql.ts](file:///d:/AI/opencode/packages/core/src/auth-token/sql.ts) 模式：snake_case 字段、`...Timestamps`、索引定义与 A1 迁移保持一致）+ `packages/core/src/auth-audit/index.ts`（服务本体）
（完全对齐 [auth-token/index.ts](file:///d:/AI/opencode/packages/core/src/auth-token/index.ts) 模式：第 1 行自引用 `export * as AuthAudit from "./index"`、`Layer.effect` 构建时捕获 db、`defaultLayer` + `node`）

接口：

```ts
type AuditAction = "login" | "logout" | "login_failed" | "kicked" | "disabled"
interface AuthAuditServiceIface {
  // 记录一条审计事件：DB insert（await）+ 追加日志文件 + console.log（best-effort，失败不影响主流程）
  record: (entry: { userId?: string; username: string; action: AuditAction; ip?: string; userAgent?: string; operator?: string }) => Effect.Effect<void, never>
  // 管理端查询（username 模糊 / action 过滤 / limit≤200 / offset，返回 total 供分页）
  list: (query: { limit?: number; offset?: number; username?: string; action?: string }) => Effect.Effect<{ data: AuthAuditEntry[]; total: number }, never>
}
```

**日志文件**：追加到 `Path.log`（[global.ts](file:///d:/AI/opencode/packages/core/src/global.ts) 的 `/root/.local/share/opencode/log`，Docker named volume 持久化）下按天文件 `auth-YYYYMMDD.log`，JSONL 格式：

```json
{"time":"2026-10-12T17:30:00.000+08:00","action":"login","username":"张三","user_id":"usr_...","ip":"192.168.1.5","user_agent":"Mozilla/5.0 ...","operator":null}
```

用 `fs/promises.appendFile` 异步追加，`Effect.catch` 吞错。**表清理**：service 内部内存时间戳节流，每 24 小时在首次 `record()` 时惰性删除 180 天前记录（不改 serve.ts 启动流程，避免接线改动）。

### A3. AuthToken 服务扩展（修改 1 文件）

**文件**：`packages/core/src/auth-token/index.ts`（自定义文件，已在改动清单 1.6 节）

新增方法 `listActive(activeWithinMs)`：查询 `revoked_at IS NULL AND expires_at > now AND last_extend_at > now - activeWithinMs` 的 token，与 `user` 表 join（drizzle `innerJoin(UserTable)`），在 JS 侧按 `user_id` 聚合（行数少，无需 SQL GROUP BY），返回：

```ts
Array<{ user_id, username, display_name, role, ip, user_agent, last_active_at, session_count }>
// ip/user_agent 取最近活跃 token 的值（注意：token 的 ip/ua 是登录时刻记录的，extend 不更新）；last_active_at = MAX(last_extend_at)
```

### A4. API 端点声明（新建 1 文件）

**文件**：`packages/server/src/groups/admin-monitor.ts`（新组，模块化原则：不动现有 `groups/admin.ts`）

```ts
export const AdminMonitorGroup = HttpApiGroup.make("server.admin.monitor")
  .add(HttpApiEndpoint.get("admin.online.list", "/api/admin/online", { success: OnlineListResponse, error: [ForbiddenError] }).middleware(RequireAdmin))
  .add(HttpApiEndpoint.get("admin.authlog.list", "/api/admin/auth-logs", { query: AuthLogQuery, success: AuthLogListResponse, error: [ForbiddenError] }).middleware(RequireAdmin))
```

参照 [groups/admin.ts](file:///d:/AI/opencode/packages/server/src/groups/admin.ts) 的声明模式；GET 查询参数用 **`query:` 字段**声明（同包先例：[groups/location.ts](file:///d:/AI/opencode/packages/server/src/groups/location.ts) L58-60 的 `location.get`，`query: LocationQuery`——不要写成 `payload`，那是 POST body）。

### A5. 端点实现（新建 1 文件）

**文件**：`packages/server/src/handlers/admin-monitor.ts`

- `admin.online.list`：`tokenSvc.listActive(15 * 60 * 1000)` → `{ data: [...] }`
- `admin.authlog.list`：`auditSvc.list(...)` → `{ data: [...], total }`

### A6. 组装接线（修改 2 文件，各 1-2 行）

- [packages/server/src/api.ts](file:///d:/AI/opencode/packages/server/src/api.ts)：`.add(AdminMonitorGroup)`（import + 1 行）
- [packages/server/src/handlers.ts](file:///d:/AI/opencode/packages/server/src/handlers.ts)：`Layer.mergeAll` 加 `AdminMonitorHandler`；末尾加 `Layer.provide(Layer.merge(AuthAuditDefaultLayer, DatabaseDefaultLayer))`

### A7. 审计埋点（修改 2 文件，每处 2-5 行）

**[packages/server/src/handlers/auth.ts](file:///d:/AI/opencode/packages/server/src/handlers/auth.ts)**：
- `auth.login`（L77 附近）：`verifyPassword` 失败 → `record({ username, action: "login_failed", ip, userAgent })`；成功 → token 创建后 `record({ userId, username, action: "login", ip, userAgent })`。限速锁定拒绝（L72 附近 `checkRateLimit` 返回 false 的分支）也记 1 条 login_failed——否则爆破时审计只见 5 条后沉默，看不出持续异常
- `auth.logout`（L102 附近）：`Authorization` 是全局中间件（api.ts L51），logout 不在公开路径，进 handler 前 CurrentUser 已注入——直接 `const user = yield* CurrentUser` 拿用户名 → revoke → `record({ userId: user.id, username: user.username, action: "logout" })`。**无需**手动 `verify(token)`/`getUser` 绕路（省 2 次 DB 查询）

**[packages/server/src/handlers/admin.ts](file:///d:/AI/opencode/packages/server/src/handlers/admin.ts)**：
- `admin.user.sessions.revoke`（L121 附近）：该 handler 现不加载目标用户，先补 `loadUser(id)` 拿 target → `record({ userId: id, username: target.username, action: "kicked", operator: 当前admin.username })`
- `admin.user.disable`（L102 附近）：`record({ userId: id, username: target.username, action: "disabled", operator: 当前admin.username })`。**禁用与踢下线分开记录**（禁用=改状态+撤会话，踢下线=只撤会话），审计不混用 kicked

改密触发的其他设备下线**暂不记录**（语义歧义，后续需要再加 action）。

### A8. 客户端 IP 获取改进（修改 1 文件，**必做**）

现状 `getRequestIP`（auth.ts L56）已实现 `x-forwarded-for → x-real-ip → "unknown"` 链，但局域网直连无代理头时仍恒为 `"unknown"`。经确认（effect 类型定义 HttpServerRequest L103）：`HttpServerRequest` **暴露 `remoteAddress?: Option.Option<string>`**，可直接读取 TCP 对端地址。补全 fallback 链：`x-forwarded-for → x-real-ip → remoteAddress(Option) → "unknown"`。**此项从「可选」升级为必做**：不做则在线页 IP 列与审计 IP 字段全为 unknown，A/B 两功能价值打折。

---

## 功能 A + B：前端改动（packages/app，SolidJS）

### B1. 在线用户页（新建 1 文件）

**文件**：`packages/app/src/pages/admin/online.tsx`（对齐 [admin/users.tsx](file:///d:/AI/opencode/packages/app/src/pages/admin/users.tsx) 的 fetch + 表格风格）
- 顶部：标题「在线用户」+ 汇总「当前在线 N 人」+ 手动刷新按钮 + 上次刷新时间
- `createResource` 拉 `/api/admin/online`，`setInterval` 15 秒自动刷新（onCleanup 清理）；监听 `visibilitychange`，页面切后台时暂停轮询、回前台立即刷新一次并恢复
- 表格列：用户名（含显示名/角色徽标）、**登录 IP**（token 的 ip/ua 是登录时刻记录的，`extend` 不更新，故列名不叫「IP」）、设备（UA 截断显示）、最近活跃（相对时间如「3 分钟前」）、在线会话数、操作
- 操作列：**「踢下线」按钮**（带确认弹窗防误触），调用**现有端点** `admin.user.sessions.revoke`（POST `/api/admin/users/:id/sessions/revoke`），成功后刷新在线列表——踢人动作由 A7 埋点自动产生 `kicked` 审计记录，与登录日志页联动；不新增后端端点
- 底部说明文案：「在线 = 最近 15 分钟内有操作；挂机页面无操作会显示离线」

### B2. 登录日志页（新建 1 文件）

**文件**：`packages/app/src/pages/admin/auth-logs.tsx`
- 筛选栏：用户名输入框、动作下拉（全部/登录/登出/登录失败/强制下线/禁用）、每页 50 条 + 上一页/下一页（用 `total` 分页）
- 表格列：时间、用户名、动作（彩色标签：登录=绿 / 登出=灰 / 失败=红 / 强制下线=橙 / 禁用=紫）、登录 IP、设备、操作者

### B3. 路由与菜单（修改 2 文件，各 1-3 行）

- [packages/app/src/app.tsx](file:///d:/AI/opencode/packages/app/src/app.tsx)：L59 附近加两个 lazy import，L424 附近加 `<Route path="/admin/online">`、`<Route path="/admin/logs">`
- [packages/app/src/components/user-menu.tsx](file:///d:/AI/opencode/packages/app/src/components/user-menu.tsx)：L68 admin `<Show>` 块内加「在线用户」「登录日志」两个菜单项（navigate 到新路由）

---

## 功能 C：Docker 容量评估报告（纯分析）

输出到会话回复 + 计划文档本节。基于代码事实（不改代码）：

**架构事实**：单 Bun 进程（binary）+ `node:http`；effect fiber 每请求一纤程；SQLite WAL（busy_timeout 5000ms，named volume ext4，写吞吐千级 TPS）；LLM 流量是外部 API 代理（容器 CPU 占用低）；每浏览器页面开 1-2 条 SSE 长连接（`/api/event` 等，心跳 10s）；`GlobalBus.setMaxListeners(200)`（[bus/global.ts](file:///d:/AI/opencode/packages/opencode/src/bus/global.ts)）；容器无 `--memory/--cpus` 限制（run.ps1）。

**瓶颈排序**：
1. **SSE 连接上限（代码级天花板，最先到）**：GlobalBus 200 监听器 → 人均 2-3 条连接 → 约 60-100 个并发浏览器页面
2. **单进程 CPU**：流式 JSON 解析 + SSE 广播扇出在单线程，多用户同时收长回复时是热点；无法纵向扩容
3. **SQLite 单写者**：并发对话写消息/事件序列化；50 人规模余量大，100+ 活跃对话时排队（busy_timeout 5s 兜底）
4. **无容器资源隔离**：内存挤占宿主机风险

**结论**：当前 32 账号、日常 ≤10 同时活跃——余量充足（估计可承载 50 左右活跃用户）；100+ 需调 GlobalBus 上限 + 资源限制，再往上需多实例（上游已留 clustering 预留）。

---

## 实施顺序

1. A1 迁移 → A2 AuthAudit 服务 → A3 AuthToken 扩展（core 包，`bun typecheck`）
2. A4-A6 server 包端点 + 接线（`bun typecheck`）
3. A7 埋点 + A8 IP 增强（**同批实施**，A8 是埋点数据质量的根，先于前端）
4. B1-B3 前端（`bun typecheck`）
5. 本地源码模式冒烟（见下）
6. 功能 C 报告撰写（随时可做，无依赖）
7. 更新 `自定义改动.md`（新增 1.26 节）+ `日志/` 开发日志；commit 按 `feat(yejian)` 分文件提交

## 验证方式

1. **typecheck**：`packages/core`、`packages/server`、`packages/app` 三个包目录分别 `bun typecheck`（不从根目录跑测试）
2. **迁移**：源码模式启动自动执行迁移，检查 `sqlite3 opencode.db ".schema auth_audit"`
3. **端到端冒烟**（源码直跑，参照改动清单 1.9 节启动方式）：
   - 用户 A 登录 → `/api/admin/online` 出现 A（admin 账号查看）→ A 开会话发消息 → 最近活跃刷新
   - A 等 15 分钟无操作（或临时把阈值调小验证）→ 从在线列表消失
   - 登出 → `auth-YYYYMMDD.log` 出现 logout 行；连续错密码 5 次 → login_failed 行（锁定后继续尝试仍留记录）；admin 踢人（在线页按钮或用户管理页）→ kicked 行 + operator；禁用账号 → disabled 行 + operator
   - `/admin/online`、`/admin/logs` 页面渲染、筛选、分页正常；普通用户访问返回 403/无权
4. **测试**：`packages/core` 下新增 `test/auth-audit.test.ts`（record/list/cleanup/文件追加），从包目录 `bun test`

## 涉及文件清单

| 类型 | 文件 |
| --- | --- |
| 新建 | `packages/core/src/database/migration/20261012100000_add_auth_audit.ts`、`packages/core/src/auth-audit/sql.ts`（drizzle 表定义）、`packages/core/src/auth-audit/index.ts`、`packages/server/src/groups/admin-monitor.ts`、`packages/server/src/handlers/admin-monitor.ts`、`packages/app/src/pages/admin/online.tsx`、`packages/app/src/pages/admin/auth-logs.tsx`、`packages/core/test/auth-audit.test.ts` |
| 修改 | `packages/core/src/auth-token/index.ts`（+listActive）、`packages/server/src/api.ts`、`packages/server/src/handlers.ts`、`packages/server/src/handlers/auth.ts`、`packages/server/src/handlers/admin.ts`、`packages/app/src/app.tsx`、`packages/app/src/components/user-menu.tsx` |
| 文档 | `自定义改动.md`、`日志/20261012开发日志-在线用户与登录审计.md` |

## 风险与边界

- 全部新功能走新文件，上游文件改动 ≤ 5 行/处且带 `// yejian:` 注释，合并冲突面最小
- `auth_audit` 写放大：每次登录登出 1 行，32 用户规模年增 <10 万行，24h 惰性清理 180 天前数据足够
- online 判定依赖 `last_extend_at`（已存在的机制），语义上「在线 = 活跃」，UI 已注明，不会误报「挂着页面也算在线」
- `x-forwarded-for` 可伪造：登录限速与审计 IP 均来自请求头，LAN 内可换头绕过限速并刷 login_failed 行；配合「锁定拒绝也记审计」+ 180 天惰性清理兜底，内部 LAN 威胁模型下接受此风险
- 审计不做防篡改外发：admin 既有 DB 权限也有日志文件权限，审计与被审计权限同源；已确认内部管理场景可接受（2026-10-12 评审决策），如未来有外部合规需求再考虑日志外发
