# 开发日志:取消 OPENCODE_SERVER_PASSWORD 实现多用户隔离

**日期**:2026-07-03
**类型**:fix(功能修复 + 体验优化)

## 需求背景

用户之前反馈多用户隔离失效,排查发现 `OPENCODE_SERVER_PASSWORD` 未设置时,后端认证中间件 `authorizationLayer` 会提前 return 变成"放行模式",导致:
1. 不验证 cookie → 不注入 `CurrentUser`
2. session handler 拿到空 `CurrentUser` → `user_id` 写成 NULL
3. session 表 `user_id` 全是 NULL → 隔离失效

但设置 `OPENCODE_SERVER_PASSWORD` 后,用户需要输两次密码:
1. 浏览器弹原生 Basic Auth 框(全局共享密码)
2. 进到登录页输系统用户密码

而且 Basic Auth 登录后身份硬编码为 `usr_cli`(admin),根本无法区分多用户。

**目标**:取消 `OPENCODE_SERVER_PASSWORD`,用户只需登录页输一次密码,cookie 有效时正常使用,cookie 失效时自动跳转登录页。

## 备选方案

| 方案 | 优点 | 缺点 | 选择 |
|------|------|------|------|
| 去掉中间件提前 return,无密码时也走 cookie 验证 | 改动最小,cookie 验证逻辑已存在 | CLI/SDK 失去 Basic Auth 访问 | ✅ |
| 新增 token 认证机制给 CLI/SDK | CLI/SDK 也能访问 | 改动大,需设计 token 发放/管理 | ❌ 过度设计 |
| 保留 OPENCODE_SERVER_PASSWORD 但改为多用户密码 | 兼容 CLI | 仍需输两次密码,体验无改善 | ❌ |

## 文件改动

### 1. `packages/opencode/src/server/routes/instance/httpapi/middleware/authorization.ts`

**改动范围**:L131-190 `authorizationLayer`

**改动前**(L131-187):
```ts
export const authorizationLayer = Layer.effect(
  Authorization,
  Effect.gen(function* () {
    const config = yield* ServerAuth.Config
    if (!ServerAuth.required(config)) return Authorization.of((effect) => effect)  // ← 问题根因
    // ... cookie 验证 + Basic Auth + 401
  }),
)
```

**改动后**(L131-190):
```ts
export const authorizationLayer = Layer.effect(
  Authorization,
  Effect.gen(function* () {
    const config = yield* ServerAuth.Config
    // ❌ 删除:if (!ServerAuth.required(config)) return Authorization.of((effect) => effect)
    const userSvc = yield* User.Service
    const tokenSvc = yield* AuthToken.Service
    return Authorization.of((effect) =>
      Effect.gen(function* () {
        // 1. cookie 验证(始终生效)
        // 2. Basic Auth(用 if (ServerAuth.required(config)) 包裹,仅设置密码时生效)
        // 3. 都没有 → 401(无密码时不带 www-authenticate 头)
      }),
    )
  }),
)
```

**关键点**:
- UI 静态资源中间件 `authorizationRouterMiddleware`(L114-129)**保持不变**,确保登录页 HTML/JS/CSS 无条件放行
- Basic Auth 部分用 `if (ServerAuth.required(config))` 包裹,向后兼容(以后设置密码仍可用)
- 401 响应在无密码时不带 `www-authenticate` 头,避免浏览器弹 Basic Auth 框

### 2. `packages/app/src/utils/server.ts`

**改动范围**:L20-53 `fetchWithCredentials`

**改动前**(L20-49):
```ts
export function createSdkForServer({...}) {
  // ...
  const baseFetch = config.fetch
  const fetchWithCredentials = (req: any) => {
    const next = new Request(req, { credentials: "include" })
    return baseFetch ? baseFetch(next) : fetch(next)
  }
  // ...
}
```

**改动后**(L20-53):
```ts
let isRedirectingToLogin = false  // 模块级标志,防并发 401 重复跳转

export function createSdkForServer({...}) {
  // ...
  const underlyingFetch = config.fetch ?? fetch
  const fetchWithCredentials = Object.assign(
    (req: any) => {
      const next = new Request(req, { credentials: "include" })
      return underlyingFetch(next).then((response: Response) => {
        if (response.status === 401 && !isRedirectingToLogin) {
          isRedirectingToLogin = true
          try { localStorage.removeItem("opencode.global.dat:tabs") } catch {}
          window.location.href = "/"
        }
        return response
      })
    },
    { preconnect: underlyingFetch.preconnect },  // 保留 preconnect 满足 typeof fetch 类型
  )
  // ...
}
```

**关键点**:
- 用 `Object.assign` 保留 `preconnect` 属性,满足 `createOpencodeClient` 对 `typeof fetch` 的类型要求
- `isRedirectingToLogin` 标志避免多个并发 401 触发重复跳转
- 清除 `opencode.global.dat:tabs` 防止刷新后路由恢复到已失效的 session
- SDK 请求路径是 `/session`、`/config` 等,不会拦截到 `/api/auth/login`(登录请求本身),无死循环风险

## 影响范围

| 层面 | 影响 |
|------|------|
| 后端 API | 无密码时也走 cookie 验证,CLI/SDK 失去 Basic Auth 访问能力 |
| 前端 | cookie 失效时自动跳转登录页,不再静默退化到隔离失效状态 |
| UI 静态资源 | 不受影响,`authorizationRouterMiddleware` 保持放行 |
| 向后兼容 | 设置 `OPENCODE_SERVER_PASSWORD` 后,Basic Auth 仍可用(CLI 兼容) |

## 踩坑记录

### 1. PowerShell curl 别名问题
- PowerShell 把 `curl` 当成 `Invoke-WebRequest` 别名,参数不兼容
- 解决:用 `curl.exe` 显式调用真正的 curl

### 2. bun -e 在 PowerShell 中的引号转义
- `bun -e 'import { Database } from "bun:sqlite"; ...'` 在 PowerShell 中双引号被解析掉
- 解决:写到临时 `.ts` 文件,用 `bun run` 执行

### 3. createOpencodeClient 的 fetch 类型要求 preconnect
- 改动后 typecheck 报错:`Property 'preconnect' is missing in type '(req: any) => Promise<Response>'`
- 原代码的箭头函数也缺少 preconnect,但可能是之前 typecheck 没跑到这个文件
- 解决:用 `Object.assign(fn, { preconnect: underlyingFetch.preconnect })` 补上属性

### 4. session 列表 directory 过滤
- 用李杰的 token 查 `/session` 返回空数组,但数据库里李杰有 3 个 session
- 原因:session.list 默认按 directory 过滤,李杰的 session 在其他目录下
- 解决:带 `?directory=D:/AI/opencode/packages/opencode` 参数查询,验证隔离逻辑

### 5. 未登录访问导致页面无限刷新(上线后才发现)
- 现象:用户打开 http://localhost:3000/ 页面一直刷新停不下来
- 原因:第一版 401 拦截逻辑过于激进——未登录用户首次访问页面时,AuthGate 会渲染登录页,但 SDK 也会同时发起 session/config 请求探活,这些请求收到 401 后触发 `window.location.href = "/"` 跳转,页面重载后又收到 401,形成死循环
- 错误的假设:原以为"SDK 请求路径是 `/session`、`/config`,不会拦截到 `/api/auth/login`,无死循环风险"——但这忽略了未登录场景下 SDK 探活请求也会收到 401
- 解决:新增模块级 `hasEverSucceeded` 标志,仅在本次页面加载期间 SDK 曾请求成功过(2xx)后才拦截 401
  - 未登录用户首次访问:从未成功 → 不拦截,交给 AuthGate 显示登录页
  - 已登录用户 cookie 失效:之前成功过 → 拦截跳转登录页
  - 跳转后页面重载,模块重置,`hasEverSucceeded` 归 false → 不会再触发跳转
- 教训:拦截类逻辑要区分"预期内的 401"(未登录首次访问)和"预期外的 401"(登录态丢失),不能一刀切

## 验证步骤

### 阶段 1:类型检查
- `cd packages/opencode && bun typecheck` — 无新增错误(预先存在的 effect/drizzle 版本冲突错误与本次改动无关)
- `cd packages/app && bun typecheck` — server.ts 的 preconnect 错误已解决,其他错误(settings.tsx、message-timeline.tsx)是预先存在的

### 阶段 2:后端单元验证
不设置 `OPENCODE_SERVER_PASSWORD`,启动后端:
```powershell
cd d:\AI\opencode\packages\opencode
bun run --conditions=browser ./src/index.ts serve --port 4098
```

| 测试项 | 预期 | 实际 | 结果 |
|--------|------|------|------|
| 无 cookie 访问 `/session` | HTTP 401 | HTTP 401 | ✅ |
| 李杰 token 带 cookie 访问 `/session` | HTTP 200 | HTTP 200 | ✅ |
| 李杰 token 创建 session | user_id = "usr_李杰" | user_id = "usr_李杰" | ✅ |
| 庞定平 token 创建 session | user_id = "usr_庞定平" | user_id = "usr_庞定平" | ✅ |
| 李杰查 session 列表 | 只看到自己的 | 1 个(user_id=usr_李杰) | ✅ |
| 庞定平查 session 列表 | 只看到自己的 | 1 个(user_id=usr_庞定平) | ✅ |

### 阶段 3:前端验证
```powershell
cd d:\AI\opencode\packages\app
bun dev -- --port 4444
```
- 前端 dev server 编译成功(vite ready)
- 访问 http://localhost:4444 → HTTP 200
- 401 拦截逻辑代码审查通过(flag 防重复、清 localStorage、跳转 `/`、无死循环)

### 阶段 4:未登录访问验证(修复死循环后)
- 不设置 `OPENCODE_SERVER_PASSWORD`,启动后端 + 前端 dev server
- 清除浏览器 cookie 和 localStorage,模拟未登录首次访问
- 访问 http://localhost:3000/ → 正常显示登录页,不再无限刷新 ✅

## commit hash

(待用户确认后提交)

## 已知遗留

1. CLI/SDK 用户在无密码时无法访问 API(没有 cookie 机制)。如需 CLI 支持,需另外设计 token 认证方案。
2. SSE 流式请求中途 cookie 失效不会触发跳转,流会静默断开。可后续在 SSE 客户端加 onerror 处理。
3. 登录限速使用内存存储(`packages/server/src/handlers/auth.ts`),多实例部署时限速不共享。本次不处理。
