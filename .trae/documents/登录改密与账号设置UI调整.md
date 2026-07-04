# 登录改密与账号设置 UI 调整

## 摘要

针对用户反馈的三个问题进行前端调整：
1. 修复首次登录改密成功后跳转 `/login` 无反应的 BUG，改为跳转到新建会话页。
2. 账号设置页移除"删除账号"按钮及相关代码。
3. 登录页与首次登录改密页的 LOGO 替换为 `packages/app/public/LOGO.png`，登录页标题 "opencode" 改为 "冶建图审·数智办公系统"。

---

## 当前状态分析

### 认证流程架构（关键背景）
整个登录、改密流程由 `AuthGate`（[auth.tsx](file:///d:/AI/opencode/packages/app/src/context/auth.tsx)）统一控制，**不通过路由切换**：
- 未登录 → 渲染 `LoginPage`
- 已登录但 `must_change_password=true` → 渲染 `ChangePasswordPage forceMode`（首次登录改密）
- 已登录且密码正常 → 渲染子组件（应用主界面）

路由表（[app.tsx](file:///d:/AI/opencode/packages/app/src/app.tsx) 第 418-425 行）中**没有 `/login` 和 `/change-password` 路由**，这两个页面只由 AuthGate 条件渲染。

### 问题根因
1. **改密跳转 BUG**：[change-password.tsx:63](file:///d:/AI/opencode/packages/app/src/pages/change-password.tsx#L63) 执行 `window.location.href = "/login"`，但路由表无此路由，导致页面"无反应"。
2. **删除账号按钮**：[settings.tsx:58-60](file:///d:/AI/opencode/packages/app/src/pages/settings.tsx#L58-L60) 存在"删除账号"按钮，调用 `/api/auth/delete-account` 接口。
3. **LOGO 引用方式**：登录页和改密页都使用 `Splash` 内联 SVG 组件（[logo.tsx:18-32](file:///d:/AI/opencode/packages/ui/src/components/logo.tsx#L18-L32)），未引用 `LOGO.png`。`LOGO.png` 文件已存在于 [packages/app/public/LOGO.png](file:///d:/AI/opencode/packages/app/public/LOGO.png)，但全项目无任何代码引用。

---

## 拟定修改

### 修改 1：改密成功后跳转到新建会话页

**文件**：[packages/app/src/pages/change-password.tsx](file:///d:/AI/opencode/packages/app/src/pages/change-password.tsx)

**改动**：第 63 行
```tsx
// 修改前
window.location.href = "/login"

// 修改后
window.location.href = "/new-session"
```

**原理**：
- `/new-session` 是路由表中已定义的新建会话路由（[app.tsx:419](file:///d:/AI/opencode/packages/app/src/app.tsx#L419)）。
- 改密成功后浏览器跳转 `/new-session`，AuthGate 重新挂载并调用 `/api/auth/me`，此时 `must_change_password` 已为 false（参考日常改密弹窗 [change-password-dialog.tsx:64-66](file:///d:/AI/opencode/packages/app/src/components/change-password-dialog.tsx#L64-L66) 的 reload 实现可印证改密不会清 session），AuthGate 渲染应用主界面，路由匹配 `/new-session` 显示新建会话页。

---

### 修改 2：账号设置页移除"删除账号"

**文件**：[packages/app/src/pages/settings.tsx](file:///d:/AI/opencode/packages/app/src/pages/settings.tsx)

**改动内容**（移除所有仅服务于"删除账号"的代码）：
1. 第 3 行 import 移除 `logout`（只被 handleDeleteAccount 使用）：`import { useCurrentUser, logout } from "@/context/auth"` → `import { useCurrentUser } from "@/context/auth"`
2. 第 1 行 import 移除 `createSignal`（loading/error 不再需要）：`import { createSignal, type Component } from "solid-js"` → `import { type Component } from "solid-js"`
3. 第 6 行移除未使用的 `refetch`：`const { user, isAdmin, refetch } = useCurrentUser()` → `const { user, isAdmin } = useCurrentUser()`
4. 第 7-8 行删除 `error`、`loading` 信号声明
5. 第 10-35 行删除 `handleDeleteAccount` 函数
6. 第 58-60 行删除"删除账号"按钮
7. 第 63-65 行删除错误提示 `<Show when={error()}>` 块（注：当前代码此处使用了 `Show` 但未导入，属遗留问题，一并清理）

**修改后完整文件结构**：
```tsx
import { type Component } from "solid-js"
import { Button } from "@opencode-ai/ui/button"
import { useCurrentUser } from "@/context/auth"

const UserSettingsPage: Component = () => {
  const { user, isAdmin } = useCurrentUser()

  return (
    <div class="h-dvh w-screen flex flex-col items-center justify-center bg-background-base">
      <div class="flex flex-col items-center gap-8 w-full max-w-sm px-6">
        <h1 class="text-20-medium text-text-strong">账号设置</h1>

        <div class="w-full flex flex-col gap-4">
          <div class="flex flex-col gap-1.5">
            <label class="text-12-regular text-text-base">用户名</label>
            <div class="text-14-regular text-text-strong">{user?.username}</div>
          </div>

          <div class="flex flex-col gap-1.5">
            <label class="text-12-regular text-text-base">角色</label>
            <div class="text-14-regular text-text-strong">{isAdmin() ? "管理员" : "普通用户"}</div>
          </div>

          <div class="flex flex-col gap-2 pt-4">
            <Button variant="secondary" size="large" onClick={() => (window.location.href = "/change-password")}>
              修改密码
            </Button>
          </div>
        </div>
      </div>
    </div>
  )
}

export default UserSettingsPage
```

**说明**：后端 `/api/auth/delete-account` 接口保留不动（用户只要求取消前端按钮）。设置页"修改密码"按钮的 `/change-password` 跳转问题用户未提及，按最小改动原则本次不动。

---

### 修改 3：LOGO 与标题替换

#### 3.1 登录页

**文件**：[packages/app/src/pages/login.tsx](file:///d:/AI/opencode/packages/app/src/pages/login.tsx)

**改动 A — LOGO 替换**（第 53 行）：
```tsx
// 修改前
<Splash class="w-12 h-15" />

// 修改后
<img src="/LOGO.png" alt="冶建图审·数智办公系统" class="h-15 w-auto" />
```
- `LOGO.png` 位于 public 目录，通过 `/LOGO.png` 访问。
- 使用 `h-15 w-auto`（高度 60px，宽度按图片原始比例自适应），避免横向 LOGO 被强行拉伸为竖向尺寸（Splash 原尺寸 48x60 是竖向比例）。

**改动 B — 标题文字替换**（第 56 行）：
```tsx
// 修改前
<h1 class="text-20-medium text-text-strong">opencode</h1>

// 修改后
<h1 class="text-20-medium text-text-strong">冶建图审·数智办公系统</h1>
```

**改动 C — 移除未使用的 Splash import**（第 2 行）：
```tsx
// 修改前
import { Splash } from "@opencode-ai/ui/logo"

// 删除此行（替换为 img 后不再使用 Splash）
```

#### 3.2 首次登录改密页

**文件**：[packages/app/src/pages/change-password.tsx](file:///d:/AI/opencode/packages/app/src/pages/change-password.tsx)

**改动 A — LOGO 替换**（第 73 行）：
```tsx
// 修改前
<Splash class="w-12 h-15" />

// 修改后
<img src="/LOGO.png" alt="冶建图审·数智办公系统" class="h-15 w-auto" />
```

**改动 B — 移除未使用的 Splash import**（第 2 行）：
```tsx
// 修改前
import { Splash } from "@opencode-ai/ui/logo"

// 删除此行
```

---

## 假设与决策

1. **跳转目标 `/new-session`**：用户明确要求"直接跳转新建会话"，对应路由表中已有的 `/new-session`。
2. **后端接口不动**：用户只要求取消前端"删除账号"按钮，后端 `/api/auth/delete-account` 接口保留。
3. **LOGO 尺寸处理**：采用 `h-15 w-auto` 保持 LOGO.png 原始宽高比，避免变形。若实际显示过大/过小，可在实现后微调 class。
4. **设置页"修改密码"按钮跳转问题**：本次不修复（用户未提及，遵循最小改动原则）。
5. **LOGO.png 文件**：已确认存在于 `packages/app/public/LOGO.png`，无需新增资源。

---

## 验证步骤

### 前端验证（本地 dev server）
1. 启动前端 dev server：`bun dev`（在 packages/app 目录）
2. **验证修改 1**（改密跳转）：
   - 用一个 `must_change_password=true` 的账号登录
   - 进入首次登录改密页，输入新密码提交
   - 确认页面跳转到 `/new-session`（新建会话页），不再卡在 `/login`
3. **验证修改 2**（删除账号按钮）：
   - 登录后进入"账号设置"页（`/settings`）
   - 确认页面只剩"修改密码"按钮，"删除账号"按钮已消失
   - 确认页面无报错（控制台无 Show 未定义等错误）
4. **验证修改 3**（LOGO 与标题）：
   - 退出登录，回到登录页
   - 确认 LOGO 显示为 LOGO.png 图片（非原 SVG）
   - 确认标题显示为"冶建图审·数智办公系统"（非"opencode"）
   - 再次用需改密账号登录，确认改密页 LOGO 也显示为 LOGO.png

### 类型检查
在 `packages/app` 目录运行 `bun typecheck`，确认无类型错误（特别是移除 import 后）。

---

## 影响范围

| 文件 | 影响类型 |
|------|---------|
| `packages/app/src/pages/change-password.tsx` | 跳转目标修改 + LOGO 替换 + 移除 Splash import |
| `packages/app/src/pages/login.tsx` | LOGO 替换 + 标题文字 + 移除 Splash import |
| `packages/app/src/pages/settings.tsx` | 移除删除账号按钮及相关代码 |

无后端改动，无路由配置改动，无新增文件。
