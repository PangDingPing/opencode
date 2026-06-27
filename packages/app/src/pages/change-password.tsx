import { createSignal, Show, type Component } from "solid-js"
import { Splash } from "@opencode-ai/ui/logo"
import { Button } from "@opencode-ai/ui/button"

// 改密页：首次登录（forceMode）只输入新密码，日常改密需输入旧密码
const ChangePasswordPage: Component<{ forceMode?: boolean }> = (props) => {
  const [oldPassword, setOldPassword] = createSignal("")
  const [newPassword, setNewPassword] = createSignal("")
  const [confirmPassword, setConfirmPassword] = createSignal("")
  const [error, setError] = createSignal("")
  const [loading, setLoading] = createSignal(false)

  // 密码强度校验：8位+含字母+含数字
  const validatePassword = (pwd: string): string | null => {
    if (pwd.length < 8) return "密码至少 8 位"
    if (!/[a-zA-Z]/.test(pwd)) return "密码必须包含字母"
    if (!/\d/.test(pwd)) return "密码必须包含数字"
    return null
  }

  const handleSubmit = async (e: Event) => {
    e.preventDefault()
    if (loading()) return

    setError("")

    const oldPwd = oldPassword()
    const newPwd = newPassword()

    const validationError = validatePassword(newPwd)
    if (validationError) {
      setError(validationError)
      return
    }

    if (newPwd !== confirmPassword()) {
      setError("两次输入的新密码不一致")
      return
    }

    if (!oldPwd) {
      setError("请输入旧密码")
      return
    }

    setLoading(true)

    try {
      const res = await fetch("/api/auth/change-password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ oldPassword: oldPwd, newPassword: newPwd }),
      })

      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        setError(data.message ?? "改密失败")
        setLoading(false)
        return
      }

      window.location.href = "/login"
    } catch {
      setError("网络错误，请重试")
      setLoading(false)
    }
  }

  return (
    <div class="h-dvh w-screen flex flex-col items-center justify-center bg-background-base">
      <div class="flex flex-col items-center gap-8 w-full max-w-sm px-6">
        <Splash class="w-12 h-15" />

        <div class="flex flex-col items-center gap-2">
          <h1 class="text-20-medium text-text-strong">
            {props.forceMode ? "首次登录请修改密码" : "修改密码"}
          </h1>
          <Show when={props.forceMode}>
            <p class="text-14-regular text-text-base">为了账号安全，请设置新密码</p>
          </Show>
        </div>

        <form class="flex flex-col gap-4 w-full" onSubmit={handleSubmit}>
          <Show when={!props.forceMode}>
            <div class="flex flex-col gap-1.5">
              <label class="text-12-regular text-text-base">旧密码</label>
              <input
                type="password"
                class="h-10 px-3 rounded-md border border-border-weak-base bg-surface-base text-14-regular text-text-strong outline-none focus:border-border-strong-base"
                value={oldPassword()}
                onInput={(e) => setOldPassword(e.currentTarget.value)}
                autocomplete="current-password"
                required
              />
            </div>
          </Show>

          <div class="flex flex-col gap-1.5">
            <label class="text-12-regular text-text-base">新密码</label>
            <input
              type="password"
              class="h-10 px-3 rounded-md border border-border-weak-base bg-surface-base text-14-regular text-text-strong outline-none focus:border-border-strong-base"
              value={newPassword()}
              onInput={(e) => setNewPassword(e.currentTarget.value)}
              autocomplete="new-password"
              required
            />
            <span class="text-11-regular text-text-weak">至少 8 位，需包含字母和数字</span>
          </div>

          <div class="flex flex-col gap-1.5">
            <label class="text-12-regular text-text-base">确认新密码</label>
            <input
              type="password"
              class="h-10 px-3 rounded-md border border-border-weak-base bg-surface-base text-14-regular text-text-strong outline-none focus:border-border-strong-base"
              value={confirmPassword()}
              onInput={(e) => setConfirmPassword(e.currentTarget.value)}
              autocomplete="new-password"
              required
            />
          </div>

          <Show when={error()}>
            <div class="text-12-regular text-text-danger px-1">{error()}</div>
          </Show>

          <Button type="submit" variant="primary" size="large" disabled={loading()}>
            {loading() ? "提交中..." : "确认修改"}
          </Button>
        </form>
      </div>
    </div>
  )
}

export default ChangePasswordPage
