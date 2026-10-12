import { createMemo, createResource, createSignal, For, Show, type Component } from "solid-js"
import { Button } from "@opencode-ai/ui/button"
import { useCurrentUser } from "@/context/auth"

// 审计记录（来自后端 /api/admin/auth-logs 响应）
type AuditLogEntry = {
  id: string
  user_id: string | null
  username: string
  action: "login" | "logout" | "login_failed" | "kicked" | "disabled"
  ip: string | null
  user_agent: string | null
  operator: string | null
  time_created: number
}

// 动作 → 显示名 + 彩色标签样式
const ACTION_STYLES: Record<AuditLogEntry["action"], { label: string; class: string }> = {
  login: { label: "登录", class: "text-text-success bg-text-success/10" },
  logout: { label: "登出", class: "text-text-base bg-surface-raised-base-hover" },
  login_failed: { label: "登录失败", class: "text-text-danger bg-text-danger/10" },
  kicked: { label: "强制下线", class: "text-text-warning bg-text-warning/10" },
  disabled: { label: "禁用", class: "text-text-primary bg-text-primary/10" },
}

// 格式化时间戳（YYYY-MM-DD HH:mm:ss）
function formatTime(ts: number): string {
  const d = new Date(ts)
  const pad = (n: number) => String(n).padStart(2, "0")
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`
}

const PAGE_SIZE = 50

// 登录日志页（admin-only）：用户名模糊筛选 + 动作过滤 + 分页
const AuthLogsPage: Component = () => {
  const { isAdmin } = useCurrentUser()
  const [username, setUsername] = createSignal("")
  const [action, setAction] = createSignal("")
  const [page, setPage] = createSignal(0)

  // 查询参数组合（任一变化自动重新查询）
  const query = createMemo(() => ({
    username: username(),
    action: action(),
    offset: page() * PAGE_SIZE,
  }))

  const [logs] = createResource(query, async (q) => {
    const params = new URLSearchParams()
    if (q.username) params.set("username", q.username)
    if (q.action) params.set("action", q.action)
    params.set("limit", String(PAGE_SIZE))
    params.set("offset", String(q.offset))
    const res = await fetch(`/api/admin/auth-logs?${params.toString()}`, { credentials: "include" })
    if (!res.ok) return { data: [] as AuditLogEntry[], total: 0 }
    return (await res.json()) as { data: AuditLogEntry[]; total: number }
  })

  // 筛选条件变化时重置到第一页
  const onFilterChange = (fn: () => void) => {
    fn()
    setPage(0)
  }

  const totalPages = () => Math.max(1, Math.ceil((logs()?.total ?? 0) / PAGE_SIZE))

  return (
    <div class="h-dvh w-screen flex flex-col bg-background-base">
      <div class="flex-1 overflow-y-auto p-8">
        <div class="max-w-5xl mx-auto flex flex-col gap-6">
          <div class="flex flex-col gap-2">
            <h1 class="text-20-medium text-text-strong">登录日志</h1>
            <p class="text-14-regular text-text-base">共 {logs()?.total ?? 0} 条记录</p>
          </div>

          <Show
            when={isAdmin()}
            fallback={<div class="text-14-regular text-text-danger">无权访问此页面</div>}
          >
            {/* 筛选栏 */}
            <div class="flex items-center gap-3">
              <input
                type="text"
                placeholder="按用户名筛选"
                class="px-3 py-1.5 rounded-md border border-border-weak-base bg-surface-base text-14-regular text-text-strong w-48 focus:outline-none"
                value={username()}
                onInput={(e) => onFilterChange(() => setUsername(e.currentTarget.value))}
              />
              <select
                class="px-3 py-1.5 rounded-md border border-border-weak-base bg-surface-base text-14-regular text-text-strong"
                value={action()}
                onChange={(e) => onFilterChange(() => setAction(e.currentTarget.value))}
              >
                <option value="">全部动作</option>
                <option value="login">登录</option>
                <option value="logout">登出</option>
                <option value="login_failed">登录失败</option>
                <option value="kicked">强制下线</option>
                <option value="disabled">禁用</option>
              </select>
            </div>

            <Show when={!logs.loading} fallback={<div class="text-14-regular text-text-base">加载中...</div>}>
              <div class="rounded-lg border border-border-weak-base overflow-hidden">
                <table class="w-full">
                  <thead class="bg-surface-raised-base-hover">
                    <tr>
                      <th class="px-4 py-2 text-left text-12-regular text-text-base">时间</th>
                      <th class="px-4 py-2 text-left text-12-regular text-text-base">用户名</th>
                      <th class="px-4 py-2 text-left text-12-regular text-text-base">动作</th>
                      <th class="px-4 py-2 text-left text-12-regular text-text-base">登录 IP</th>
                      <th class="px-4 py-2 text-left text-12-regular text-text-base">设备</th>
                      <th class="px-4 py-2 text-left text-12-regular text-text-base">操作者</th>
                    </tr>
                  </thead>
                  <tbody>
                    <For each={logs()?.data ?? []}>
                      {(log) => (
                        <tr class="border-t border-border-weaker-base">
                          <td class="px-4 py-2 text-12-regular text-text-weak">{formatTime(log.time_created)}</td>
                          <td class="px-4 py-2 text-14-regular text-text-strong">{log.username}</td>
                          <td class="px-4 py-2">
                            <span
                              classList={{
                                "inline-block px-2 py-0.5 rounded text-11-regular": true,
                                [ACTION_STYLES[log.action].class]: true,
                              }}
                            >
                              {ACTION_STYLES[log.action].label}
                            </span>
                          </td>
                          <td class="px-4 py-2 text-12-regular text-text-base">{log.ip ?? "unknown"}</td>
                          <td class="px-4 py-2 text-12-regular text-text-weak">
                            <span title={log.user_agent ?? undefined}>
                              {(log.user_agent ?? "unknown").slice(0, 30)}
                              {(log.user_agent ?? "").length > 30 ? "…" : ""}
                            </span>
                          </td>
                          <td class="px-4 py-2 text-12-regular text-text-base">{log.operator ?? "—"}</td>
                        </tr>
                      )}
                    </For>
                  </tbody>
                </table>
              </div>
              <Show when={(logs()?.data.length ?? 0) === 0}>
                <div class="text-14-regular text-text-weak text-center py-4">没有符合条件的记录</div>
              </Show>

              {/* 分页 */}
              <div class="flex items-center justify-end gap-3">
                <span class="text-12-regular text-text-weak">
                  第 {page() + 1} / {totalPages()} 页
                </span>
                <Button variant="ghost" size="large" disabled={page() === 0} onClick={() => setPage((p) => p - 1)}>
                  上一页
                </Button>
                <Button variant="ghost" size="large" disabled={page() + 1 >= totalPages()} onClick={() => setPage((p) => p + 1)}>
                  下一页
                </Button>
              </div>
            </Show>
          </Show>
        </div>
      </div>
    </div>
  )
}

export default AuthLogsPage
