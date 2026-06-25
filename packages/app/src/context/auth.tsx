import { createContext, useContext, createResource, Show, lazy, type ParentProps } from "solid-js"
import { Dynamic } from "solid-js/web"
import { Splash } from "@opencode-ai/ui/logo"

// 当前用户信息（从 /api/auth/me 获取）
export type CurrentUser = {
  id: string
  username: string
  role: "admin" | "user"
  display_name?: string
  must_change_password: boolean
}

const UserContext = createContext<CurrentUser>()

// 获取当前登录用户（必须在 AuthGate 内部使用）
export function useCurrentUser() {
  const user = useContext(UserContext)
  if (!user) throw new Error("useCurrentUser 必须在 AuthGate 内部使用")
  return {
    user,
    isAdmin: () => user.role === "admin",
  }
}

// 可选获取（未登录时返回 undefined）
export function useCurrentUserOptional() {
  return useContext(UserContext)
}

// 获取当前用户信息的 fetcher
async function fetchMe(): Promise<CurrentUser | null> {
  try {
    const res = await fetch("/api/auth/me", { credentials: "include" })
    if (res.status === 401) return null
    if (!res.ok) return null
    const data = await res.json()
    return data as CurrentUser
  } catch {
    return null
  }
}

// 动态导入登录页和改密页（避免循环依赖和首屏加载过多）
const LoginPage = lazy(() => import("@/pages/login"))
const ChangePasswordPage = lazy(() => import("@/pages/change-password"))

// AuthGate：未登录显示登录页，登录后注入 UserContext
export function AuthGate(props: ParentProps) {
  const [me, { refetch }] = createResource(fetchMe)

  return (
    <Show
      when={!me.loading}
      fallback={
        <div class="h-dvh w-screen flex flex-col items-center justify-center bg-background-base">
          <Splash class="w-16 h-20 opacity-50 animate-pulse" />
        </div>
      }
    >
      <Show when={me()} fallback={<Dynamic component={LoginPage} onLoginSuccess={() => refetch()} />}>
        {(user) => (
          <UserContext.Provider value={user()}>
            <Show when={!user().must_change_password} fallback={<Dynamic component={ChangePasswordPage} forceMode />}>
              {props.children}
            </Show>
          </UserContext.Provider>
        )}
      </Show>
    </Show>
  )
}

// 退出登录辅助函数
export async function logout() {
  try {
    await fetch("/api/auth/logout", { method: "POST", credentials: "include" })
  } catch {
    // 忽略错误
  }
  window.location.reload()
}
