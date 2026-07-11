import { createSignal, Show, type Component } from "solid-js"
import { Button } from "@opencode-ai/ui/button"
import { useLanguage } from "@/context/language"
import { navigateToDefaultProject } from "@/utils/default-project"

// 登录页：用户名 + 密码表单，登录成功后跳转到默认项目
const LoginPage: Component = () => {
  const language = useLanguage()
  const [username, setUsername] = createSignal("")
  const [password, setPassword] = createSignal("")
  const [error, setError] = createSignal("")
  const [loading, setLoading] = createSignal(false)

  const handleSubmit = async (e: Event) => {
    e.preventDefault()
    if (loading()) return

    setError("")
    setLoading(true)

    try {
      const res = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ username: username().trim(), password: password() }),
      })

      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        const message = data.message ?? "登录失败"
        // 登录限速锁定
        if (res.status === 400 && message.includes("15 分钟")) {
          setError(message)
        } else {
          setError(message)
        }
        setLoading(false)
        return
      }

      // yejian: 登录成功，跳转到默认项目（整页刷新，确保项目状态完全重载）
      navigateToDefaultProject()
    } catch {
      setError("网络错误，请重试")
      setLoading(false)
    }
  }

  return (
    <div class="h-dvh w-screen flex flex-col items-center justify-center bg-background-base">
      <div class="flex flex-col items-center gap-8 w-full max-w-sm px-6">
        <img src="/LOGO.png" alt="冶建图审·数智办公系统" class="h-15 w-auto" />

        <div class="flex flex-col items-center gap-2">
          <h1 class="text-20-medium text-text-strong">冶建图审·数智办公系统</h1>
          <p class="text-14-regular text-text-base">请登录后使用</p>
        </div>

        <form class="flex flex-col gap-4 w-full" onSubmit={handleSubmit}>
          <div class="flex flex-col gap-1.5">
            <label class="text-12-regular text-text-base">用户名（实名）</label>
            <input
              type="text"
              class="h-10 px-3 rounded-md border border-border-weak-base bg-surface-base text-14-regular text-text-strong outline-none focus:border-border-strong-base"
              value={username()}
              onInput={(e) => setUsername(e.currentTarget.value)}
              placeholder="请输入实名"
              autocomplete="username"
              required
            />
          </div>

          <div class="flex flex-col gap-1.5">
            <label class="text-12-regular text-text-base">密码</label>
            <input
              type="password"
              class="h-10 px-3 rounded-md border border-border-weak-base bg-surface-base text-14-regular text-text-strong outline-none focus:border-border-strong-base"
              value={password()}
              onInput={(e) => setPassword(e.currentTarget.value)}
              placeholder="请输入密码"
              autocomplete="current-password"
              required
            />
          </div>

          <Show when={error()}>
            <div class="text-12-regular text-text-danger px-1">{error()}</div>
          </Show>

          <Button type="submit" variant="primary" size="large" disabled={loading()}>
            {loading() ? "登录中..." : "登录"}
          </Button>
        </form>
      </div>
    </div>
  )
}

export default LoginPage
