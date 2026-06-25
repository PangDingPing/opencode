import { createSignal, Show, type Component } from "solid-js"
import { Dialog } from "@opencode-ai/ui/dialog"
import { Button } from "@opencode-ai/ui/button"
import { useDialog } from "@opencode-ai/ui/context/dialog"

// 改密对话框（日常改密场景，在 dialog 里弹出）
const ChangePasswordDialog: Component = () => {
  const dialog = useDialog()
  const [oldPassword, setOldPassword] = createSignal("")
  const [newPassword, setNewPassword] = createSignal("")
  const [confirmPassword, setConfirmPassword] = createSignal("")
  const [error, setError] = createSignal("")
  const [loading, setLoading] = createSignal(false)

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

      // 改密成功，关闭对话框并刷新
      dialog.close()
      window.location.reload()
    } catch {
      setError("网络错误，请重试")
      setLoading(false)
    }
  }

  return (
    <Dialog title="修改密码" fit>
      <form class="flex flex-col gap-4 pl-6 pr-2.5 pb-3" onSubmit={handleSubmit}>
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

        <div class="flex justify-end gap-2">
          <Button variant="ghost" size="large" onClick={() => dialog.close()}>
            取消
          </Button>
          <Button type="submit" variant="primary" size="large" disabled={loading()}>
            {loading() ? "提交中..." : "确认修改"}
          </Button>
        </div>
      </form>
    </Dialog>
  )
}

export default ChangePasswordDialog
