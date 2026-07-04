# 多用户系统重构方案：统一认证架构

> **问题背景**：当前系统存在两套认证混用——`OPENCODE_SERVER_USERNAME/PASSWORD`（Basic Auth）+ 多用户数据库认证。Basic Auth 一旦通过即可绕过所有会话隔离，导致多用户认证完全失效。退出登录后瞬间跳转回上次会话页面。

---

## 一、问题分析

### 1.1 当前认证链路

```
用户直接输入会话 URL（如 http://localhost:3000/Qzpc.../session/ses_xxx）
    ↓
浏览器自动携带 Basic Auth header（Authorization: Basic b3BlbmNvZGU6dGVzdDEyMzQ=）
    ↓
后端 authorizationLayer 第 82-99 行尝试 cookie 认证 → 失败（无 cookie 或 cookie 无效）
    ↓
后端 authorizationLayer 第 107-130 行尝试 Basic Auth → 成功！
    ↓
后端注入 CLI 用户（usr_cli），放行所有请求
    ↓
前端渲染 Session 组件，完全绕过 AuthGate 和数据库认证
```

**核心漏洞**：Basic Auth 认证通过后，后端直接放行，**不检查 cookie、不验证数据库用户、不执行会话隔离**。

### 1.2 退出登录瞬间跳回问题

```
用户点击退出登录
    ↓
POST /api/auth/logout 撤销 token + 返回 Set-Cookie（清除 cookie）
    ↓
前端 await fetch(...) 等待响应完成
    ↓
localStorage.removeItem("opencode.global.dat:tabs") 清除持久化数据
    ↓
window.location.href = "/" 强制刷新
    ↓
AuthGate 开始 fetchMe() 异步检查 /api/auth/me
    ↓
**此时 cookie 可能还没被浏览器完全清除**（浏览器处理 Set-Cookie 有延迟）
    ↓
fetchMe() 返回用户数据 → AuthGate 渲染子组件
    ↓
持久化的 tabs 数据被恢复 → 路由跳转回上次会话
```

**核心问题**：cookie 清除有延迟，前端在 cookie 过期前就完成了认证检查。

---

## 二、重构目标

### 2.1 核心目标

1. **彻底移除 Basic Auth 认证路径**：不再支持 `OPENCODE_SERVER_USERNAME/PASSWORD` 的 Basic Auth
2. **统一为多用户数据库认证**：所有请求必须通过 cookie 认证（登录后生成的 session token）
3. **消除双重认证**：用户只需输一次密码（登录时的密码），不再需要额外输入 `OPENCODE_SERVER_PASSWORD`
4. **修复退出登录**：确保退出后强制停留在登录页，不再瞬间跳回上次会话

### 2.2 预期行为

| 场景 | 预期行为 |
|------|---------|
| 直接输入会话 URL | 跳登录页，必须登录才能访问 |
| 已登录用户访问会话 URL | 正常显示会话 |
| 点击退出登录 | 跳登录页，不再跳回 |
| Basic Auth header 带错误密码 | 返回 401 |
| Basic Auth header 带正确密码 | 返回 401（不再支持 Basic Auth） |

---

## 三、修改方案

### 3.1 后端修改

#### 修改 1：`packages/server/src/middleware/authorization.ts`

**目标**：移除 Basic Auth 认证路径，只保留 cookie 认证

**修改内容**：
- 删除 `credentialFromRequest` 函数（不再从 Basic Auth header 提取凭证）
- 删除 `ServerAuth.Config` 依赖（不再读取 `OPENCODE_SERVER_USERNAME/PASSWORD`）
- 删除 Basic Auth 认证分支（第 107-130 行）
- 删除默认用户注入分支（第 133-145 行）
- 简化为：无 cookie → 返回 401

**关键改动**：
```typescript
// 修改前（第 107-130 行）
if (needsBasicAuth) {
  const credential = yield* credentialFromRequest(request)
  if (ServerAuth.authorized(credential, config)) {
    // Basic Auth 通过 → 注入一个 admin 用户
    return yield* effect.pipe(Effect.provideService(CurrentUser, cliUser))
  }
}

// 修改后（删除整个分支）
// 2. 无 cookie → 拒绝（不再支持 Basic Auth）
yield* HttpEffect.appendPreResponseHandler((_req, response) =>
  Effect.succeed(HttpServerResponseModule.HttpServerResponse.setHeader(response, "www-authenticate", WWW_AUTHENTICATE)),
)
return yield* new UnauthorizedError({ message: "Authentication required" })
```

#### 修改 2：`packages/server/src/handlers/auth.ts`

**目标**：确保 logout 返回正确的 Set-Cookie

**修改内容**：
- 确认 `clearSessionCookie` 函数正确设置 `Max-Age=0`
- 确认 `logout` handler 返回 `Set-Cookie: oc_session=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`

#### 修改 3：`packages/server/src/auth.ts`

**目标**：保留 `ServerAuth` 模块给 CLI 用，但标记为废弃

**修改内容**：
- 保留 `ServerAuth.required(config)` 和 `ServerAuth.authorized(credential, config)` 函数
- 添加 `@deprecated` 注释，说明 Web 端不再使用 Basic Auth
- CLI 仍可继续使用 Basic Auth（向后兼容）

---

### 3.2 前端修改

#### 修改 1：`packages/app/src/context/auth.tsx` — AuthGate 组件

**目标**：在 cookie 验证完成前，阻止所有子组件渲染

**修改内容**：
```typescript
// 修改前（第 65 行）
{props.children}  // ← 在 AuthGate 渲染时就已经创建了

// 修改后
<Show when={me()}>
  {(user) => (
    <UserContext.Provider value={user()}>
      <Show when={!user().must_change_password} fallback={<Dynamic component={ChangePasswordPage} forceMode />}>
        {props.children}  // ← 只有当 me() 有值时才渲染
      </Show>
    </UserContext.Provider>
  )}
</Show>
```

**关键改动**：将 `props.children` 移到 `<Show when={me()}>` 内部，确保只有当 `fetchMe()` 返回有效用户数据时，子组件才会渲染。

#### 修改 2：`packages/app/src/context/auth.tsx` — logout 函数

**目标**：确保退出登录后强制停留在登录页

**修改内容**：
```typescript
// 修改前
export async function logout() {
  try {
    await fetch("/api/auth/logout", { method: "POST", credentials: "include", cache: "no-store" })
  } catch {
    // 忽略错误
  }
  localStorage.removeItem("opencode.global.dat:tabs")
  await new Promise((resolve) => setTimeout(resolve, 200))
  window.location.href = "/"
}

// 修改后
export async function logout() {
  // 1. 发 POST 撤销 token 并清除 cookie
  try {
    await fetch("/api/auth/logout", { method: "POST", credentials: "include", cache: "no-store" })
  } catch {
    // 忽略错误
  }
  // 2. 清除 localStorage 中的 tabs 等持久化数据
  try {
    localStorage.removeItem("opencode.global.dat:tabs")
  } catch {
    // 忽略错误
  }
  // 3. 等待浏览器处理完 cookie 清除，再强制刷新
  await new Promise((resolve) => setTimeout(resolve, 500))
  window.location.href = "/"
}
```

**关键改动**：
- 等待时间从 200ms 增加到 500ms，确保浏览器有时间处理 Set-Cookie
- 添加 `cache: "no-store"` 防止 `/api/auth/logout` 响应被缓存

#### 修改 3：`packages/app/src/context/auth.tsx` — fetchMe 函数

**目标**：防止 `/api/auth/me` 响应被缓存

**修改内容**：
```typescript
// 修改前
const res = await fetch("/api/auth/me", { credentials: "include" })

// 修改后
const res = await fetch("/api/auth/me", { credentials: "include", cache: "no-store" })
```

---

## 四、实施步骤

### 阶段 1：后端移除 Basic Auth（1 天）

**任务清单**：

1. **修改 `packages/server/src/middleware/authorization.ts`**
   - 删除 `credentialFromRequest` 函数
   - 删除 `ServerAuth.Config` 依赖
   - 删除 Basic Auth 认证分支
   - 删除默认用户注入分支
   - 简化为：无 cookie → 返回 401

2. **修改 `packages/server/src/auth.ts`**
   - 保留 `ServerAuth` 模块给 CLI 用
   - 添加 `@deprecated` 注释

3. **验证**
   - `curl -X POST /api/auth/login -d '{"username":"admin","password":"xxx"}'` 返回 200 + Set-Cookie
   - `curl -b cookie.txt /api/auth/me` 返回 user info
   - `curl -H "Authorization: Basic b3BlbmNvZGU6dGVzdDEyMzQ=" /api/auth/me` 返回 401（不再支持 Basic Auth）
   - `bun typecheck` 通过

**Commit 建议**：
1. `refactor(server): remove Basic Auth from authorization middleware` — middleware/authorization.ts
2. `chore(server): deprecate ServerAuth module for CLI compat only` — auth.ts

### 阶段 2：前端修复认证守卫（0.5 天）

**任务清单**：

1. **修改 `packages/app/src/context/auth.tsx` — AuthGate 组件**
   - 将 `props.children` 移到 `<Show when={me()}>` 内部
   - 确保只有当 `fetchMe()` 返回有效用户数据时，子组件才会渲染

2. **修改 `packages/app/src/context/auth.tsx` — logout 函数**
   - 等待时间从 200ms 增加到 500ms
   - 添加 `cache: "no-store"` 防止响应被缓存

3. **修改 `packages/app/src/context/auth.tsx` — fetchMe 函数**
   - 添加 `cache: "no-store"` 防止 `/api/auth/me` 响应被缓存

4. **验证**
   - 直接输入会话 URL → 跳登录页
   - 已登录用户访问会话 URL → 正常显示
   - 点击退出登录 → 跳登录页，不再跳回
   - `bun typecheck` 通过

**Commit 建议**：
1. `fix(app): prevent AuthGate from rendering children before cookie verification` — auth.tsx
2. `fix(app): increase logout cookie clearance delay to 500ms` — auth.tsx
3. `fix(app): add cache: no-store to auth endpoints` — auth.tsx

### 阶段 3：联调测试（0.5 天）

**任务清单**：

1. **重启前后端 dev server**
2. **测试场景**：
   - 直接输入会话 URL → 跳登录页 ✓
   - 登录 admin → 访问会话 URL → 正常显示 ✓
   - 点击退出登录 → 跳登录页，不再跳回 ✓
   - Basic Auth header 带正确密码 → 返回 401 ✓
   - Basic Auth header 带错误密码 → 返回 401 ✓
3. **清理**：删除 `packages/server/src/auth.ts` 中的 `@deprecated` 注释（如果确定 CLI 不再需要）

---

## 五、风险评估

| 风险 | 影响 | 缓解措施 |
|------|------|---------|
| CLI 用户受影响 | 高 | 保留 `ServerAuth` 模块给 CLI 用，添加 `@deprecated` 注释 |
| 浏览器 cookie 清除延迟 | 中 | 增加等待时间到 500ms，添加 `cache: "no-store"` |
| 用户数据丢失 | 低 | 仅修改认证逻辑，不修改数据结构 |
| 性能影响 | 低 | 移除 Basic Auth 分支，实际减少了一次认证路径 |

---

## 六、验收标准

| 场景 | 预期行为 | 验证方法 |
|------|---------|---------|
| 直接输入会话 URL | 跳登录页 | 浏览器地址栏输入 `http://localhost:3000/Qzpc.../session/ses_xxx` |
| 已登录用户访问会话 URL | 正常显示 | 登录后输入会话 URL |
| 点击退出登录 | 跳登录页，不再跳回 | 点击退出登录按钮 |
| Basic Auth header 带正确密码 | 返回 401 | `curl -H "Authorization: Basic ..." /api/auth/me` |
| Basic Auth header 带错误密码 | 返回 401 | `curl -H "Authorization: Basic ..." /api/auth/me` |
| CLI 用户正常使用 | 不受影响 | CLI 命令正常运行 |
| `bun typecheck` | 通过 | 运行 `bun typecheck` |

---

## 七、文件清单

| 文件 | 修改类型 | 说明 |
|------|---------|------|
| `packages/server/src/middleware/authorization.ts` | 修改 | 移除 Basic Auth 认证路径 |
| `packages/server/src/auth.ts` | 修改 | 添加 `@deprecated` 注释 |
| `packages/app/src/context/auth.tsx` | 修改 | 修复 AuthGate 渲染逻辑 + 退出登录延迟 |

---

> **执行入口**：按"阶段 1 → 阶段 2 → 阶段 3"顺序执行，每个阶段独立 commit。完成后进行阶段 3 的联调测试。
