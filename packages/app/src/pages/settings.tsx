import { createSignal, type Component } from "solid-js"
import { Button } from "@opencode-ai/ui/button"
import { useCurrentUser, logout } from "@/context/auth"

const UserSettingsPage: Component = () => {
  const { user, isAdmin, refetch } = useCurrentUser()
  const [error, setError] = createSignal("")
  const [loading, setLoading] = createSignal(false)

  const handleDeleteAccount = async () => {
    if (!confirm("确定要删除当前账号吗？此操作不可恢复。")) return

    setLoading(true)
    setError("")

    try {
      const res = await fetch("/api/auth/delete-account", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
      })

      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        setError(data.message ?? "删除失败")
        setLoading(false)
        return
      }

      await logout()
    } catch {
      setError("网络错误，请重试")
      setLoading(false)
    }
  }

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

            <Button variant="destructive" size="large" disabled={loading()} onClick={handleDeleteAccount}>
              {loading() ? "处理中..." : "删除账号"}
            </Button>
          </div>

          <Show when={error()}>
            <div class="text-12-regular text-text-danger px-1">{error()}</div>
          </Show>
        </div>
      </div>
    </div>
  )
}

export default UserSettingsPage
