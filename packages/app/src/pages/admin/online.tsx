import { createResource, createSignal, For, onCleanup, onMount, Show, type Component } from "solid-js"
import { Button } from "@opencode-ai/ui/button"
import { Dialog } from "@opencode-ai/ui/dialog"
import { useDialog } from "@opencode-ai/ui/context/dialog"
import { useCurrentUser } from "@/context/auth"
import { showToast } from "@/utils/toast"

// 在线用户信息（来自后端 /api/admin/online 响应）
// ip/user_agent 是登录时刻记录的（extend 不更新），故列名不叫「IP」而叫「登录 IP」
type OnlineUser = {
  user_id: string
  username: string
  display_name: string | null
  role: string
  ip: string | null
  user_agent: string | null
  last_active_at: number
  session_count: number
}

// 相对时间（如「3 分钟前」）
function relativeTime(ts: number): string {
  const diff = Date.now() - ts
  if (diff < 60_000) return "刚刚"
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)} 分钟前`
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)} 小时前`
  return `${Math.floor(diff / 86_400_000)} 天前`
}

// 上次刷新时间（HH:mm:ss）
function formatClock(ts: number): string {
  const d = new Date(ts)
  const pad = (n: number) => String(n).padStart(2, "0")
  return `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`
}

// 轮询间隔：15 秒
const POLL_INTERVAL_MS = 15_000

// 在线用户页（admin-only）：拉取式轮询，页面切后台暂停、回前台立即刷新一次并恢复
const OnlineUsersPage: Component = () => {
  const { user: currentUser, isAdmin } = useCurrentUser()
  const dialog = useDialog()
  const [lastRefreshAt, setLastRefreshAt] = createSignal(0)

  const [online, { refetch }] = createResource<OnlineUser[]>(async () => {
    const res = await fetch("/api/admin/online", { credentials: "include" })
    setLastRefreshAt(Date.now())
    if (!res.ok) return [] as OnlineUser[]
    const data = await res.json()
    return data.data as OnlineUser[]
  })

  // 15 秒轮询 + visibilitychange 暂停/恢复（切后台停止请求，回前台立即刷新一次）
  onMount(() => {
    let timer: ReturnType<typeof setInterval> | undefined
    const startPolling = () => {
      if (timer) return
      timer = setInterval(() => void refetch(), POLL_INTERVAL_MS)
    }
    const stopPolling = () => {
      if (!timer) return
      clearInterval(timer)
      timer = undefined
    }
    const onVisibilityChange = () => {
      if (document.hidden) {
        stopPolling()
      } else {
        void refetch()
        startPolling()
      }
    }
    startPolling()
    document.addEventListener("visibilitychange", onVisibilityChange)
    onCleanup(() => {
      stopPolling()
      document.removeEventListener("visibilitychange", onVisibilityChange)
    })
  })

  // 判断是否为当前登录用户自己（不能踢自己）
  const isSelf = (u: OnlineUser) => u.user_id === currentUser.id

  // 踢下线（带确认弹窗，调用现有 sessions.revoke 端点，成功后刷新在线列表；
  // 踢人动作由后端埋点自动产生 kicked 审计记录）
  const confirmKick = (u: OnlineUser) => {
    dialog.show(() => (
      <Dialog title="确认踢下线" fit>
        <div class="flex flex-col gap-4 pl-6 pr-2.5 pb-3">
          <div class="text-14-regular text-text-base">
            确定要让用户 <span class="text-text-strong font-medium">{u.username}</span> 下线吗？
            <div class="mt-2 text-12-regular text-text-weak">
              该用户的所有登录会话将立即失效，需要重新登录。
            </div>
          </div>
          <div class="flex justify-end gap-2">
            <Button variant="ghost" size="large" onClick={() => dialog.close()}>
              取消
            </Button>
            <Button
              variant="primary"
              size="large"
              class="!bg-text-danger !border-text-danger"
              onClick={async () => {
                const res = await fetch(`/api/admin/users/${u.user_id}/sessions/revoke`, {
                  method: "POST",
                  credentials: "include",
                })
                if (res.ok) {
                  showToast({ title: "已踢下线", description: `用户 ${u.username} 需重新登录`, variant: "success" })
                  dialog.close()
                  void refetch()
                } else {
                  const data = await res.json().catch(() => ({}))
                  showToast({ title: "踢下线失败", description: data.message ?? "", variant: "error" })
                }
              }}
            >
              确认踢下线
            </Button>
          </div>
        </div>
      </Dialog>
    ))
  }

  return (
    <div class="h-dvh w-screen flex flex-col bg-background-base">
      <div class="flex-1 overflow-y-auto p-8">
        <div class="max-w-5xl mx-auto flex flex-col gap-6">
          {/* 顶部：标题 + 汇总 + 手动刷新 + 上次刷新时间 */}
          <div class="flex justify-between items-center">
            <div class="flex flex-col gap-2">
              <h1 class="text-20-medium text-text-strong">在线用户</h1>
              <p class="text-14-regular text-text-base">
                当前在线 {online()?.length ?? 0} 人
                <Show when={lastRefreshAt()}>
                  <span class="ml-2 text-12-regular text-text-weak">（上次刷新 {formatClock(lastRefreshAt())}）</span>
                </Show>
              </p>
            </div>
            <Button variant="primary" size="large" onClick={() => void refetch()}>
              刷新
            </Button>
          </div>

          <Show
            when={isAdmin()}
            fallback={<div class="text-14-regular text-text-danger">无权访问此页面</div>}
          >
            <Show when={!online.loading} fallback={<div class="text-14-regular text-text-base">加载中...</div>}>
              <div class="rounded-lg border border-border-weak-base overflow-hidden">
                <table class="w-full">
                  <thead class="bg-surface-raised-base-hover">
                    <tr>
                      <th class="px-4 py-2 text-left text-12-regular text-text-base">用户名</th>
                      <th class="px-4 py-2 text-left text-12-regular text-text-base">登录 IP</th>
                      <th class="px-4 py-2 text-left text-12-regular text-text-base">设备</th>
                      <th class="px-4 py-2 text-left text-12-regular text-text-base">最近活跃</th>
                      <th class="px-4 py-2 text-left text-12-regular text-text-base">在线会话数</th>
                      <th class="px-4 py-2 text-right text-12-regular text-text-base">操作</th>
                    </tr>
                  </thead>
                  <tbody>
                    <For each={online() ?? []}>
                      {(u) => (
                        <tr class="border-t border-border-weaker-base">
                          <td class="px-4 py-2 text-14-regular text-text-strong">
                            {u.username}
                            <Show when={u.display_name}>
                              <span class="ml-2 text-12-regular text-text-weak">（{u.display_name}）</span>
                            </Show>
                            <Show when={u.role === "admin"}>
                              <span class="ml-2 text-11-regular text-text-weak">管理员</span>
                            </Show>
                            <Show when={isSelf(u)}>
                              <span class="ml-2 text-11-regular text-text-weak">（我）</span>
                            </Show>
                          </td>
                          <td class="px-4 py-2 text-14-regular text-text-base">{u.ip ?? "unknown"}</td>
                          <td class="px-4 py-2 text-12-regular text-text-weak">
                            <span title={u.user_agent ?? undefined}>
                              {(u.user_agent ?? "unknown").slice(0, 40)}
                              {(u.user_agent ?? "").length > 40 ? "…" : ""}
                            </span>
                          </td>
                          <td class="px-4 py-2 text-12-regular text-text-base">{relativeTime(u.last_active_at)}</td>
                          <td class="px-4 py-2 text-12-regular text-text-base">{u.session_count}</td>
                          <td class="px-4 py-2 text-right">
                            <Button
                              variant="ghost"
                              size="large"
                              class="!text-text-danger"
                              disabled={isSelf(u)}
                              onClick={() => confirmKick(u)}
                            >
                              踢下线
                            </Button>
                          </td>
                        </tr>
                      )}
                    </For>
                  </tbody>
                </table>
              </div>
              <Show when={(online()?.length ?? 0) === 0}>
                <div class="text-14-regular text-text-weak text-center py-4">当前没有在线用户</div>
              </Show>
            </Show>

            {/* 底部说明：在线判定语义 */}
            <p class="text-12-regular text-text-weak">在线 = 最近 15 分钟内有操作；挂机页面无操作会显示离线。</p>
          </Show>
        </div>
      </div>
    </div>
  )
}

export default OnlineUsersPage
