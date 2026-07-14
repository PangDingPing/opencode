# 实施计划:取消 OPENCODE_SERVER_PASSWORD 实现多用户隔离

## 背景与目标

**背景**:当前多用户隔离依赖 `OPENCODE_SERVER_PASSWORD` 环境变量。该变量未设置时,后端认证中间件 `authorizationLayer` 会提前 return 变成"放行模式",导致:
- 不验证 cookie → 不注入 `CurrentUser`
- session handler 拿到空 `CurrentUser` → `user_id` 写成 NULL
- session 表 `user_id` 全是 NULL → 隔离失效

**用户痛点**:设置 `OPENCODE_SERVER_PASSWORD` 后,浏览器会弹原生 Basic Auth 框(输第一次密码),进到登录页又要输系统用户密码(第二次),体验差。而 Basic Auth 用的是全局共享密码,登录后身份硬编码为 `usr_cli`(admin),根本无法区分多用户。

**目标**:
1. 取消 `OPENCODE_SERVER_PASSWORD` 环境变量
2. 用户只需在登录页输一次系统用户密码
3. cookie 有效 → 正常使用,`user_id` 正常写入,隔离生效
4. cookie 失效 → 下一个请求收到 401 → 自动跳转登录页

## 当前状态分析

### 后端认证中间件(`authorization.ts`)

文件:[authorization.ts](file:///d:/AI/opencode/packages/opencode/src/server/routes/instance/httpapi/middleware/authorization.ts)

存在两个中间件:

1. **`authorizationLayer`(第 131-187 行)**:API 路由认证中间件,挂载在 `instanceApiRoutes`、`eventApiRoutes`、`rootApiRoutes` 上
   - 第 135 行:`if (!ServerAuth.required(config)) return Authorization.of((effect) => effect)` ← **关键问题点**
   - 第 146-161 行:cookie 验证逻辑(已实现,但被提前 return 跳过)
   - 第 163-177 行:Basic Auth 逻辑(CLI 兼容)
   - 第 179-183 行:都没有则返回 401

2. **`authorizationRouterMiddleware`(第 114-129 行)**:UI 静态资源路由中间件,挂载在 `uiRoute`、`docRoute` 上
   - 第 117 行:同样有提前 return 逻辑
   - **必须保持放行**:否则登录页 HTML/JS/CSS 加载不出来

### 前端 SDK fetch 包装

文件:[server.ts](file:///d:/AI/opencode/packages/app/src/utils/server.ts)

- 第 33-38 行:`fetchWithCredentials` 只强制 `credentials: "include"`,**没有 401 拦截**
- SDK 走的是 `/session`、`/config` 等路径,不会碰 `/api/auth/*`,所以拦截 401 不会死循环

### 前端 AuthGate

文件:[auth.tsx](file:///d:/AI/opencode/packages/app/src/context/auth.tsx)

- 第 32-42 行:`fetchMe` 请求 `/api/auth/me`,401 返回 null,触发渲染登录页
- 第 78-94 行:`logout` 函数已实现(撤销 token + 清 cookie + 跳转 `/`)
- **只在页面初次加载时判断一次**,运行时 cookie 失效不会自动跳转

## 实施步骤

### 阶段 1:后端改动 — 让 API 中间件在无密码时也走 cookie 验证

**文件**:[authorization.ts](file:///d:/AI/opencode/packages/opencode/src/server/routes/instance/httpapi/middleware/authorization.ts)

**改动位置**:第 131-187 行的 `authorizationLayer`

**改动内容**:去掉第 135 行的提前 return,让中间件在 `OPENCODE_SERVER_PASSWORD` 未设置时:
- 跳过 Basic Auth 校验(因为 `ServerAuth.authorized` 在无密码时本就返回 false,第 165 行天然跳过)
- 但仍走 cookie 验证逻辑(第 146-161 行)
- cookie 无效时返回 401(第 179-183 行)

**具体代码逻辑**:
```ts
export const authorizationLayer = Layer.effect(
  Authorization,
  Effect.gen(function* () {
    const config = yield* ServerAuth.Config
    // ❌ 删除:if (!ServerAuth.required(config)) return Authorization.of((effect) => effect)

    // 获取 User/AuthToken service 用于 cookie 认证
    const userSvc = yield* User.Service
    const tokenSvc = yield* AuthToken.Service

    return Authorization.of((effect) =>
      Effect.gen(function* () {
        const request = yield* HttpServerRequest.HttpServerRequest

        // 1. 先检查 cookie(web 用户)
        const cookieToken = parseCookieToken(request.headers.cookie)
        if (cookieToken) {
          const tokenInfo = yield* tokenSvc.verify(cookieToken).pipe(
            Effect.catch(() => Effect.succeed(null)),
          )
          if (tokenInfo) {
            const user = yield* userSvc.getUser(tokenInfo.userId).pipe(
              Effect.catch(() => Effect.succeed(null)),
            )
            if (user && user.disabled === 0) {
              yield* tokenSvc.extend(cookieToken).pipe(Effect.catch(() => Effect.void))
              return yield* effect.pipe(Effect.provideService(CurrentUser, user))
            }
          }
        }

        // 2. 检查 Basic Auth(CLI 用户)—— 仅在设置了 OPENCODE_SERVER_PASSWORD 时生效
        if (ServerAuth.required(config)) {
          const credential = yield* credentialFromRequest(request)
          if (ServerAuth.authorized(credential, config)) {
            const cliUser = { /* 原有硬编码 usr_cli */ }
            return yield* effect.pipe(Effect.provideService(CurrentUser, cliUser))
          }
          // 设置了密码但 Basic Auth 也失败 → 返回 401 + www-authenticate 头
          yield* HttpEffect.appendPreResponseHandler((_request, response) =>
            Effect.succeed(HttpServerResponse.setHeader(response, "www-authenticate", WWW_AUTHENTICATE)),
          )
        }

        // 3. 都没有,返回 401
        return yield* new HttpApiError.Unauthorized({})
      }),
    )
  }),
)
```

**关键点**:
- `authorizationRouterMiddleware`(UI 中间件)**保持不变**,确保登录页静态资源能正常加载
- Basic Auth 部分用 `if (ServerAuth.required(config))` 包裹,保留向后兼容(如果以后设置密码,Basic Auth 仍可用)
- 401 响应在无密码时不带 `www-authenticate` 头(避免浏览器弹 Basic Auth 框)

### 阶段 2:前端改动 — 拦截 401 自动跳转登录页

**文件**:[server.ts](file:///d:/AI/opencode/packages/app/src/utils/server.ts)

**改动位置**:第 33-38 行的 `fetchWithCredentials`

**改动内容**:在 fetch 响应后检查 401,触发跳转登录页

**具体代码逻辑**:
```ts
// 模块级标志,避免多个并发 401 重复跳转
let isRedirectingToLogin = false

const fetchWithCredentials = (req: any) => {
  const next = new Request(req, { credentials: "include" })
  const fetchFn = baseFetch ? baseFetch : fetch
  return fetchFn(next).then((response: Response) => {
    // 拦截 401:cookie 失效,跳转登录页
    if (response.status === 401 && !isRedirectingToLogin) {
      isRedirectingToLogin = true
      // 清除 localStorage 中的持久化数据
      try { localStorage.removeItem("opencode.global.dat:tabs") } catch {}
      // 跳转到根路径,AuthGate 会重新走 fetchMe,渲染登录页
      window.location.href = "/"
    }
    return response
  })
}
```

**关键点**:
- 用 `isRedirectingToLogin` 标志避免并发 401 重复跳转
- 清除 `opencode.global.dat:tabs` 防止刷新后路由恢复到已失效的 session
- 直接 `window.location.href = "/"` 触发整页刷新,AuthGate 自然走 `fetchMe` → 401 → 渲染登录页
- SDK 请求路径是 `/session`、`/config` 等,不会拦截到 `/api/auth/login`(登录请求本身),无死循环风险

### 阶段 3:验证

#### 验证步骤 1:后端单元验证

**目标**:确认后端在无 `OPENCODE_SERVER_PASSWORD` 时,cookie 验证逻辑生效

**操作**:
1. 不设置 `OPENCODE_SERVER_PASSWORD` 环境变量
2. 启动后端:
   ```powershell
   cd d:\AI\opencode\packages\opencode
   bun run --conditions=browser ./src/index.ts serve --port 4098
   ```
3. 用 curl 测试:
   - 无 cookie 访问 `/session` → 应返回 401
   - 先调用 `/api/auth/login` 获取 cookie,再带 cookie 访问 `/session` → 应返回 200

#### 验证步骤 2:前端 401 拦截验证

**目标**:确认 cookie 失效时前端自动跳转登录页

**操作**:
1. 启动前端:
   ```powershell
   cd d:\AI\opencode\packages\app
   bun dev -- --port 4444
   ```
2. 浏览器打开 `http://localhost:4444`,登录正常使用
3. 打开浏览器 DevTools → Application → Cookies,删除 `oc_session` cookie
4. 在页面上做任何操作(如新建 session)→ 应自动跳转回登录页

#### 验证步骤 3:端到端多用户隔离验证

**目标**:确认多用户隔离在无 `OPENCODE_SERVER_PASSWORD` 时正常工作

**操作**:
1. 确保系统有两个用户:用户 A(如 `lijie`)和用户 B(如 `pangdingping`),均为非 admin
2. 用浏览器无痕模式打开两个窗口,分别登录用户 A 和用户 B
3. 用户 A 创建一个 session,用户 B 创建一个 session
4. 验证:
   - 用户 A 的 session 列表只看到 A 自己的 session
   - 用户 B 的 session 列表只看到 B 自己的 session
   - 用户 A 直接访问用户 B 的 session URL → 跳转新会话页(已实现)
5. 数据库验证:
   ```powershell
   cd d:\AI\opencode\packages\opencode
   bun -e "import { Database } from '@opencode-ai/core/database/database'; const db = await Database.create(); const rows = await db.select(...); console.log(rows)"
   ```
   或直接用 sqlite3 查询 session 表,确认 `user_id` 字段不再是 NULL

## 假设与决策

### 假设
1. 用户使用场景以 Web 端为主,CLI/SDK 使用较少,失去 Basic Auth 影响可接受
2. cookie 7 天 TTL + 惰性续期,正常使用不会频繁触发 401
3. SSE 流式请求中途 cookie 失效的场景极少,暂不处理(流会断开但不会触发 fetch 401 拦截)

### 决策
1. **保留 Basic Auth 代码**:用 `if (ServerAuth.required(config))` 包裹,向后兼容。如果以后需要 CLI 访问,设置 `OPENCODE_SERVER_PASSWORD` 即可恢复
2. **UI 中间件不改**:`authorizationRouterMiddleware` 保持原样,确保登录页静态资源无条件放行
3. **401 响应不强制带 `www-authenticate` 头**:无密码时不带,避免浏览器弹 Basic Auth 框;有密码时带,保持 CLI 兼容
4. **前端用整页跳转**:直接 `window.location.href = "/"`,而不是 SPA 内部路由跳转。简单可靠,避免状态残留

## 影响范围

| 文件 | 改动 | 风险 |
|------|------|------|
| `packages/opencode/src/server/routes/instance/httpapi/middleware/authorization.ts` | 去掉提前 return,Basic Auth 用 if 包裹 | 低:cookie 验证逻辑已存在且测试过 |
| `packages/app/src/utils/server.ts` | 加 401 拦截 | 低:只读响应状态,不改请求 |

## 已知遗留

1. CLI/SDK 用户在无密码时无法访问 API(没有 cookie 机制)。如需 CLI 支持,需另外设计 token 认证方案。
2. SSE 流式请求中途 cookie 失效不会触发跳转,流会静默断开。可后续在 SSE 客户端加 onerror 处理。
3. 登录限速使用内存存储(`packages/server/src/handlers/auth.ts`),多实例部署时限速不共享。本次不处理。
