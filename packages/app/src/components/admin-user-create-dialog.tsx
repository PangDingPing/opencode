import { createSignal, Show, type Component } from "solid-js"
import { Dialog } from "@opencode-ai/ui/dialog"
import { Button } from "@opencode-ai/ui/button"
import { useDialog } from "@opencode-ai/ui/context/dialog"
import { showToast } from "@/utils/toast"

// 用户信息类型（与 users.tsx 保持一致）
type UserItem = {
  id: string
  username: string
  role: "admin" | "user"
  display_name?: string | null
  disabled: boolean
  must_change_password: boolean
  time_created: number
  time_updated: number
}

// 新增用户弹窗 props
type Props = {
  users: UserItem[]
  onDone: () => void
}

// 密码强度校验：至少 8 位，需包含字母和数字
function validatePassword(pwd: string): string | null {
  if (pwd.length < 8) return "密码至少 8 位"
  if (!/[a-zA-Z]/.test(pwd)) return "密码必须包含字母"
  if (!/\d/.test(pwd)) return "密码必须包含数字"
  return null
}

// 新增用户弹窗：用户名手动输入（不受白名单限制），密码 + 确认密码 + 角色单选
const AdminUserCreateDialog: Component<Props> = (props) => {
  const dialog = useDialog()
  const [username, setUsername] = createSignal("")
  const [password, setPassword] = createSignal("")
  const [confirmPassword, setConfirmPassword] = createSignal("")
  const [role, setRole] = createSignal<"admin" | "user">("user")
  const [error, setError] = createSignal("")
  const [loading, setLoading] = createSignal(false)

  // 已注册用户名集合（用于前端查重提示）
  const usedUsernames = () => new Set(props.users.map((u) => u.username))

  const handleSubmit = async (e: Event) => {
    e.preventDefault()
    if (loading()) return

    setError("")

    const usernameVal = username().trim()
    const passwordVal = password()

    if (!usernameVal) {
      setError("请输入用户名")
      return
    }

    if (usedUsernames().has(usernameVal)) {
      setError("该用户名已被注册")
      return
    }

    const validationError = validatePassword(passwordVal)
    if (validationError) {
      setError(validationError)
      return
    }

    if (passwordVal !== confirmPassword()) {
      setError("两次输入的密码不一致")
      return
    }

    setLoading(true)

    try {
      const res = await fetch("/api/admin/users", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ username: usernameVal, password: passwordVal, role: role() }),
      })

      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        setError(data.message ?? "创建用户失败")
        setLoading(false)
        return
      }

      showToast({ title: "用户创建成功", description: usernameVal, variant: "success" })
      dialog.close()
      props.onDone()
    } catch {
      setError("网络错误，请重试")
      setLoading(false)
    }
  }

  return (
    <Dialog title="新增用户" fit>
      <form class="flex flex-col gap-4 pl-6 pr-2.5 pb-3" onSubmit={handleSubmit}>
        <div class="flex flex-col gap-1.5">
          <label class="text-12-regular text-text-base">用户名</label>
          <input
            type="text"
            class="h-10 px-3 rounded-md border border-border-weak-base bg-surface-base text-14-regular text-text-strong outline-none focus:border-border-strong-base"
            value={username()}
            onInput={(e) => setUsername(e.currentTarget.value)}
            placeholder="请输入用户名"
            autocomplete="off"
            required
          />
          <span class="text-11-regular text-text-weak">用户名可自定义，不受白名单限制</span>
        </div>

        <div class="flex flex-col gap-1.5">
          <label class="text-12-regular text-text-base">密码</label>
          <input
            type="password"
            class="h-10 px-3 rounded-md border border-border-weak-base bg-surface-base text-14-regular text-text-strong outline-none focus:border-border-strong-base"
            value={password()}
            onInput={(e) => setPassword(e.currentTarget.value)}
            autocomplete="new-password"
            required
          />
          <span class="text-11-regular text-text-weak">至少 8 位，需包含字母和数字</span>
        </div>

        <div class="flex flex-col gap-1.5">
          <label class="text-12-regular text-text-base">确认密码</label>
          <input
            type="password"
            class="h-10 px-3 rounded-md border border-border-weak-base bg-surface-base text-14-regular text-text-strong outline-none focus:border-border-strong-base"
            value={confirmPassword()}
            onInput={(e) => setConfirmPassword(e.currentTarget.value)}
            autocomplete="new-password"
            required
          />
        </div>

        <div class="flex flex-col gap-1.5">
          <label class="text-12-regular text-text-base">角色</label>
          <div class="flex gap-4">
            <label class="flex items-center gap-2 text-14-regular text-text-strong cursor-pointer">
              <input
                type="radio"
                name="role"
                value="user"
                checked={role() === "user"}
                onChange={() => setRole("user")}
              />
              普通用户
            </label>
            <label class="flex items-center gap-2 text-14-regular text-text-strong cursor-pointer">
              <input
                type="radio"
                name="role"
                value="admin"
                checked={role() === "admin"}
                onChange={() => setRole("admin")}
              />
              管理员
            </label>
          </div>
        </div>

        <Show when={error()}>
          <div class="text-12-regular text-text-danger px-1">{error()}</div>
        </Show>

        <div class="flex justify-end gap-2">
          <Button variant="ghost" size="large" onClick={() => dialog.close()}>
            取消
          </Button>
          <Button type="submit" variant="primary" size="large" disabled={loading()}>
            {loading() ? "提交中..." : "确认新增"}
          </Button>
        </div>
      </form>
    </Dialog>
  )
}

export default AdminUserCreateDialog
