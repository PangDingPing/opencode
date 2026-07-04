import { createSignal, Show, type Component } from "solid-js"
import { Dialog } from "@opencode-ai/ui/dialog"
import { Button } from "@opencode-ai/ui/button"
import { useDialog } from "@opencode-ai/ui/context/dialog"
import { showToast } from "@/utils/toast"

// 改显示名弹窗 props
type Props = {
  userId: string
  username: string
  initialDisplayName?: string | null
  onDone: () => void
}

// 改显示名弹窗：可清空（传 null 表示清空）
const AdminEditUserDialog: Component<Props> = (props) => {
  const dialog = useDialog()
  const [displayName, setDisplayName] = createSignal(props.initialDisplayName ?? "")
  const [error, setError] = createSignal("")
  const [loading, setLoading] = createSignal(false)

  const handleSubmit = async (e: Event) => {
    e.preventDefault()
    if (loading()) return

    setError("")

    const value = displayName().trim()
    // 传 null 表示清空显示名；非空字符串表示设置显示名
    const payload = value === "" ? null : value

    setLoading(true)

    try {
      const res = await fetch(`/api/admin/users/${props.userId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ display_name: payload }),
      })

      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        setError(data.message ?? "修改显示名失败")
        setLoading(false)
        return
      }

      showToast({
        title: "显示名已更新",
        description: value === "" ? `用户 ${props.username} 显示名已清空` : `用户 ${props.username} 显示名已改为 "${value}"`,
        variant: "success",
      })
      dialog.close()
      props.onDone()
    } catch {
      setError("网络错误，请重试")
      setLoading(false)
    }
  }

  return (
    <Dialog title="修改显示名" fit>
      <form class="flex flex-col gap-4 pl-6 pr-2.5 pb-3" onSubmit={handleSubmit}>
        <div class="text-13-regular text-text-base px-1">
          正在修改用户 <span class="text-text-strong font-medium">{props.username}</span> 的显示名
        </div>

        <div class="flex flex-col gap-1.5">
          <label class="text-12-regular text-text-base">显示名</label>
          <input
            type="text"
            class="h-10 px-3 rounded-md border border-border-weak-base bg-surface-base text-14-regular text-text-strong outline-none focus:border-border-strong-base"
            value={displayName()}
            onInput={(e) => setDisplayName(e.currentTarget.value)}
            placeholder="留空表示清空显示名"
            autocomplete="off"
          />
          <span class="text-11-regular text-text-weak">留空保存即清空显示名，用户名将作为默认显示</span>
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

export default AdminEditUserDialog
