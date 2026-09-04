# 2026-09-04 开发日志：多用户自定义代码全量 typecheck 修复，打通 git push

## 需求背景

推送远程仓库时被 husky pre-push 钩子（`bun turbo typecheck`）挡住。多用户自定义代码（fork 自 anomalyco/opencode）历史上从未通过 typecheck：server 包 17 个存量错误 + opencode 包若干错误。用户确认把存量错误全部修掉，让全仓库 typecheck 变绿后推送。

## 备选方案

1. **绕过钩子**（`git push --no-verify`）：治标不治本，存量债务永远在，否决。
2. **`as any` 强转糊类型**：会掩盖真实 bug（后面证明这批错误里藏了 3 个真运行时 bug），否决。
3. **逐个按 effect-smol 正确模式修复**（采纳）：Layer.effect 化 / provides 声明 / mapError 映射 / 测试补 mock，与上游同款写法对齐。

## 文件改动（19 个提交，按依赖顺序）

### core 基础层（自定义文件，整体重放级别）

| 文件 | 行号 | 改动 |
| --- | --- | --- |
| `packages/core/src/user/sql.ts` | L21 | UserTable.id 去 `$type<ID>()` brand 注解（drizzle 推断冲突） |
| `packages/core/src/user/password.ts` | L34 | scrypt `params` 显式类型注解 `{ N: number; r: number; p: number }` |
| `packages/core/src/user/index.ts` | 全文 | 重构为 `Layer.effect` 构建时捕获 db（上游 session/store.ts 模式），各方法 R=never |
| `packages/core/src/auth-token/index.ts` | 全文 | 同上重构；`cleanupExpired` 的 `gt`→`lt`（**方向反了，原删的是未过期 token**） |

### server 中间件层（上游文件，小改动）

| 文件 | 行号 | 改动 |
| --- | --- | --- |
| `middleware/auth.ts` | L19, L90 | `CookieAuth` 声明 `provides: CurrentUser`；`HttpServerResponse` 改限定名 |
| `middleware/authorization.ts` | L18-23, L75 | `Authorization` 同样声明 `provides: CurrentUser` + 限定名类型 |
| `middleware/require-admin.ts` | L16-19 | `Effect.serviceOption(CurrentUser)` 读取，缺失 fail-closed 403 |

### server handlers 层（上游文件，小改动）

| 文件 | 行号 | 改动 |
| --- | --- | --- |
| `handlers/admin.ts` | L81-83 | `updateUser` 失败 `mapError` → `InvalidRequestError` |
| `handlers/auth.ts` | L135-137, L164 | `changePassword` 映射；delete-account 返回 `{ ok: true }`（**原返回 schema 对象，运行时也是错的**） |
| `handlers/credential.ts` | L27 | `UserID.make(user.id)` 补 brand |
| `handlers/session.ts` | L37, L88, L97-113 | `UserID.make`×2；**`const session` 遮蔽外层服务 + TDZ 自引用——session.get 接口原来一调就抛 ReferenceError，完全不可用** |

### server 路由层

| 文件 | 行号 | 改动 |
| --- | --- | --- |
| `routes.ts` | L18-22 | provide 顺序改回上游同款：先 handlers（引入 RequireAdmin key 依赖）再中间件实现层 |

### opencode 包

| 文件 | 行号 | 改动 |
| --- | --- | --- |
| `src/cli/cmd/serve.ts` | L19, L44, L105-116 | 去掉 `Effect.gen("name", fn)` 名字参数（effect-smol 不支持，第一参数被当 self 对象）；bootstrapAdmin/bootstrapUsers 加 `Effect.catch` 兜底 |
| `test/session/prompt.test.ts` | L44, L217-218 | SessionPrompt 新依赖 `User.Service`（system prompt 注入登录用户身份），`Layer.mock` 补齐 |
| `test/server/httpapi-authorization.test.ts` | L13-14, L62-67 | authorizationLayer 依赖 User/AuthToken（cookie 认证），mock 补齐 |
| `test/server/httpapi-control-plane.test.ts` | L9-10, L48-50 | 同上 |
| `test/server/httpapi-global.test.ts` | L10-11, L42-44 | 同上 |

### app 包（顺带修出的前端 bug）

| 文件 | 行号 | 改动 |
| --- | --- | --- |
| `components/file-tree.tsx` | L169-171 | classList 重复 key `"text-text-weak"` 合并为 `ignored \|\| !active()` |
| `pages/session/message-timeline.tsx` | L585 | 移除 virtua 0.49.1 handle 上不存在的 `measure()`（运行时 TypeError） |

### 其他

- `.gitignore`：忽略本地工具目录 `.workbuddy/`

## 影响范围

- 多用户登录/鉴权链路：cookie 认证、admin 管理、会话归属过滤——修复后类型语义与运行时行为一致，且 fail-closed 更安全。
- `session.get` HTTP 接口从"必抛 ReferenceError"变为可用（真实 bug 修复）。
- `opencode serve` 启动引导：失败不再阻塞启动（尽力而为，打日志）。
- 前端文件树 ignored 文件弱化样式、消息时间线底部锚定恢复正常。

## 踩坑记录

1. **effect-smol 的 `Effect.gen` 不接受名字参数**：`Effect.gen("Cli.serve", fn)` 会把字符串当第一参数（期望 `{ self }` 对象）报 TS2345。命名要用 `Effect.fn("name")` 包裹。
2. **修掉一层错误才露下一层**：serve.ts 行 19/44 的 `Effect.gen` 错误修掉后，才暴露行 93 handler 的 `Error` vs `CliError` 通道错误（之前被坏类型推断掩盖）。
3. **`User.Service` 的 `Error` 通道会污染整条调用链**：`createUser: Effect<UserInfo, Error>` → bootstrapAdmin → serve handler 整体 `Effect<void, Error, Service>` 不满足 `effectCmd` 的 `CliError` 约束。解法：边界处 `Effect.catch` 兜底（bootstrap 本就是尽力而为）或 `mapError` 映射。
4. **测试的 Layer 类型错误定位法**：错误信息里 `Layer<..., ServeError, Service | Service>` 的 R 通道剩几个 `Service`，就是缺几个服务依赖——对照中间件 `yield*` 的服务逐个排查（本次是 User/AuthToken）。
5. **`Layer.provide` 顺序有讲究**：handlers `.middleware(RequireAdmin)` 会把 middleware key 加入依赖，必须先 provide handlers 再 provide 中间件实现层（与上游组装顺序一致）。
6. **修 typecheck 顺带捞到 3 个真运行时 bug**：session.get 的 TDZ 遮蔽、delete-account 返回 schema 对象、file-tree 重复 key——类型错误从不无辜。

## 验证步骤

1. `packages/opencode` 目录 `bun typecheck` → 0 错误
2. 仓库根 `bun typecheck`（turbo 全包）→ **23/23 successful**
3. 19 个分文件提交均带 `yejian` scope
4. `git push` 走 pre-push 钩子（bun 版本检查 + 全量 typecheck）通过

## commits（本次批次 19 个，从 `01c09ba88c` 到 `e5f4b492bd`）

- `01c09ba88c` fix(yejian): remove UserID brand annotation from user table id column
- `20b8ea6214` fix(yejian): annotate scrypt params object type explicitly for tsgo
- `0d9d0f071a` refactor(yejian): rebuild user service as Layer.effect capturing db at build time
- `b0cac1ab49` refactor(yejian): rebuild auth-token service as Layer.effect and fix cleanupExpired to delete expired tokens
- `47c85a89e0` fix(yejian): declare CookieAuth provides CurrentUser and correct HttpServerResponse type
- `c4b98d320e` fix(yejian): declare Authorization provides CurrentUser and correct HttpServerResponse type
- `6b54efcf0b` fix(yejian): read CurrentUser via serviceOption and fail closed when auth context missing
- `26e2e07cbd` fix(yejian): map updateUser failure to InvalidRequestError in admin user update
- `cd879646e5` fix(yejian): map changePassword failure to InvalidRequestError and return ok payload on account deletion
- `b5ce7d95b9` fix(yejian): brand user id with UserID.make in credential creation
- `d29ec018d7` fix(yejian): brand user ids with UserID.make and fix session variable shadowing TDZ crash in session.get
- `778eddfba7` fix(yejian): provide handlers before middleware layers to satisfy RequireAdmin dependency
- `e15654ed7b` fix(yejian): drop unsupported Effect.gen name args and make user bootstrap failures non-fatal in serve
- `e2a6df5767` test(yejian): mock User.Service to satisfy SessionPrompt layer requirements
- `ddebde03c3` / `2c81f3a97c` / `738ca990c6` test(yejian): mock User and AuthToken services for cookie auth dependencies（三个 httpapi 测试）
- `adc78e53dd` fix(yejian): merge duplicate classList key so weak text applies to ignored or inactive files
- `af6304580d` fix(yejian): remove virtualizer measure call missing from virtua 0.49.1 handle
- `e5f4b492bd` chore(yejian): ignore local WorkBuddy runtime data directory
- 另有清单提交：自定义改动.md 1.21 节 + 本日志

## 已知遗留

- 修复只做了 typecheck 验证 + 代码走查，未跑完整 bun test 套件（pre-push 钩子不跑测试）；下次本地冒烟时建议启动 dev server 验证登录、会话列表、admin 面板。
- `require-admin` 的 fail-closed（CurrentUser 缺失返回 403）是有意为之的安全选择，与上游"空值放行"语义不同，合并上游时注意保留。
- 线上 docker 仍是旧二进制，本批修复（尤其 session.get 接口）需重建镜像后生效。
