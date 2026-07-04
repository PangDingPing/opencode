import { createResource, For, Show, type Component } from "solid-js"
import { Button } from "@opencode-ai/ui/button"
import { Dialog } from "@opencode-ai/ui/dialog"
import { DropdownMenu } from "@opencode-ai/ui/dropdown-menu"
import { IconButton } from "@opencode-ai/ui/icon-button"
import { useDialog } from "@opencode-ai/ui/context/dialog"
import { useCurrentUser } from "@/context/auth"
import { showToast } from "@/utils/toast"
import AdminUserCreateDialog from "@/components/admin-user-create-dialog"
import AdminResetPasswordDialog from "@/components/admin-reset-password-dialog"
import AdminEditUserDialog from "@/components/admin-edit-user-dialog"

// 用户信息（来自后端 /api/admin/users 响应）
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

// 格式化时间戳
function formatTime(ts: number): string {
  const d = new Date(ts)
  const pad = (n: number) => String(n).padStart(2, "0")
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`
}

// 用户管理页（admin-only）：表格内联操作
const UsersAdminPage: Component = () => {
  const { user: currentUser, isAdmin } = useCurrentUser()
  const dialog = useDialog()

  const [users, { refetch }] = createResource<UserItem[]>(async () => {
    const res = await fetch("/api/admin/users", { credentials: "include" })
    if (!res.ok) return [] as UserItem[]
    const data = await res.json()
    return data.data as UserItem[]
  })

  // 判断是否为当前登录用户自己
  const isSelf = (u: UserItem) => u.id === currentUser.id

  // ============ 弹窗触发 ============

  // 新增用户
  const openCreate = () => {
    dialog.show(() => <AdminUserCreateDialog users={users() ?? []} onDone={refetch} />)
  }

  // 重置密码
  const openResetPassword = (u: UserItem) => {
    dialog.show(() => <AdminResetPasswordDialog userId={u.id} username={u.username} onDone={refetch} />)
  }

  // 改显示名
  const openEditDisplayName = (u: UserItem) => {
    dialog.show(
      () => (
        <AdminEditUserDialog
          userId={u.id}
          username={u.username}
          initialDisplayName={u.display_name}
          onDone={refetch}
        />
      ),
    )
  }

  // ============ 切换角色（admin ↔ user） ============

  const toggleRole = async (u: UserItem) => {
    const newRole = u.role === "admin" ? "user" : "admin"
    const res = await fetch(`/api/admin/users/${u.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      credentials: "include",
      body: JSON.stringify({ role: newRole }),
    })
    if (res.ok) {
      showToast({ title: "角色已切换", description: `${u.username} → ${newRole === "admin" ? "管理员" : "普通用户"}`, variant: "success" })
      refetch()
    } else {
      const data = await res.json().catch(() => ({}))
      showToast({ title: "切换角色失败", description: data.message ?? "", variant: "error" })
    }
  }

  // ============ 启用/禁用（禁用需二次确认） ============

  const toggleDisable = (u: UserItem) => {
    if (u.disabled) {
      // 启用直接执行
      void doToggleDisable(u)
    } else {
      // 禁用需二次确认
      dialog.show(() => (
        <Dialog title="确认禁用" fit>
          <div class="flex flex-col gap-4 pl-6 pr-2.5 pb-3">
            <div class="text-14-regular text-text-base">
              确定要禁用用户 <span class="text-text-strong font-medium">{u.username}</span> 吗？
              <div class="mt-2 text-12-regular text-text-weak">
                禁用后该用户的所有登录会话将立即失效，无法继续操作。
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
                  await doToggleDisable(u)
                  dialog.close()
                }}
              >
                确认禁用
              </Button>
            </div>
          </div>
        </Dialog>
      ))
    }
  }

  const doToggleDisable = async (u: UserItem) => {
    const endpoint = u.disabled ? "enable" : "disable"
    const res = await fetch(`/api/admin/users/${u.id}/${endpoint}`, {
      method: "POST",
      credentials: "include",
    })
    if (res.ok) {
      showToast({
        title: u.disabled ? "用户已启用" : "用户已禁用",
        description: u.disabled ? `用户 ${u.username} 已启用` : `用户 ${u.username} 已被踢下线`,
        variant: "success",
      })
      refetch()
    } else {
      const data = await res.json().catch(() => ({}))
      showToast({ title: u.disabled ? "启用失败" : "禁用失败", description: data.message ?? "", variant: "error" })
    }
  }

  // ============ 踢人下线（二次确认） ============

  const confirmKickOffline = (u: UserItem) => {
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
                const res = await fetch(`/api/admin/users/${u.id}/sessions/revoke`, {
                  method: "POST",
                  credentials: "include",
                })
                if (res.ok) {
                  showToast({ title: "已踢下线", description: `用户 ${u.username} 需重新登录`, variant: "success" })
                  dialog.close()
                  refetch()
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

  // ============ 删除用户（二次确认） ============

  const confirmDelete = (u: UserItem) => {
    dialog.show(() => (
      <Dialog title="确认删除" fit>
        <div class="flex flex-col gap-4 pl-6 pr-2.5 pb-3">
          <div class="text-14-regular text-text-base">
            确定要删除用户 <span class="text-text-strong font-medium">{u.username}</span> 吗？
            <div class="mt-2 text-12-regular text-text-danger">
              此操作不可恢复，该用户的所有数据将被清除。
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
                const res = await fetch(`/api/admin/users/${u.id}`, {
                  method: "DELETE",
                  credentials: "include",
                })
                if (res.ok) {
                  showToast({ title: "用户已删除", description: u.username, variant: "success" })
                  dialog.close()
                  refetch()
                } else {
                  const data = await res.json().catch(() => ({}))
                  showToast({ title: "删除失败", description: data.message ?? "", variant: "error" })
                }
              }}
            >
              确认删除
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
          {/* 顶部：标题 + 新增用户按钮 */}
          <div class="flex justify-between items-center">
            <div class="flex flex-col gap-2">
              <h1 class="text-20-medium text-text-strong">用户管理</h1>
              <p class="text-14-regular text-text-base">管理公司用户账号（共 {users()?.length ?? 0} 人）</p>
            </div>
            <Button variant="primary" size="large" onClick={openCreate}>
              新增用户
            </Button>
          </div>

          <Show
            when={isAdmin()}
            fallback={<div class="text-14-regular text-text-danger">无权访问此页面</div>}
          >
            <Show when={!users.loading} fallback={<div class="text-14-regular text-text-base">加载中...</div>}>
              <div class="rounded-lg border border-border-weak-base overflow-hidden">
                <table class="w-full">
                  <thead class="bg-surface-raised-base-hover">
                    <tr>
                      <th class="px-4 py-2 text-left text-12-regular text-text-base">用户名</th>
                      <th class="px-4 py-2 text-left text-12-regular text-text-base">显示名</th>
                      <th class="px-4 py-2 text-left text-12-regular text-text-base">角色</th>
                      <th class="px-4 py-2 text-left text-12-regular text-text-base">状态</th>
                      <th class="px-4 py-2 text-left text-12-regular text-text-base">创建时间</th>
                      <th class="px-4 py-2 text-right text-12-regular text-text-base">操作</th>
                    </tr>
                  </thead>
                  <tbody>
                    <For each={users() ?? []}>
                      {(u) => {
                        const self = () => isSelf(u)
                        return (
                          <tr classList={{ "border-t border-border-weaker-base": true, "opacity-50": u.disabled }}>
                            <td class="px-4 py-2 text-14-regular text-text-strong">
                              {u.username}
                              <Show when={self()}>
                                <span class="ml-2 text-11-regular text-text-weak">（我）</span>
                              </Show>
                            </td>
                            <td class="px-4 py-2 text-14-regular text-text-base">
                              {u.display_name ?? "—"}
                            </td>
                            <td class="px-4 py-2 text-14-regular text-text-base">
                              {u.role === "admin" ? (
                                <span class="text-text-strong">管理员</span>
                              ) : (
                                <span>普通用户</span>
                              )}
                            </td>
                            <td class="px-4 py-2 text-12-regular">
                              <Show
                                when={!u.disabled}
                                fallback={<span class="text-text-danger">禁用</span>}
                              >
                                <Show
                                  when={!u.must_change_password}
                                  fallback={<span class="text-text-weak">需改密</span>}
                                >
                                  <span class="text-text-base">启用</span>
                                </Show>
                              </Show>
                            </td>
                            <td class="px-4 py-2 text-12-regular text-text-weak">
                              {formatTime(u.time_created)}
                            </td>
                            <td class="px-4 py-2 text-right">
                              <DropdownMenu>
                                <DropdownMenu.Trigger as={IconButton} icon="dot-grid" variant="ghost" aria-label="操作菜单" />
                                <DropdownMenu.Portal>
                                  <DropdownMenu.Content class="mt-1 min-w-[180px]">
                                    <DropdownMenu.Item
                                      onSelect={() => openResetPassword(u)}
                                      disabled={self()}
                                    >
                                      <DropdownMenu.ItemLabel>重置密码</DropdownMenu.ItemLabel>
                                    </DropdownMenu.Item>
                                    <DropdownMenu.Item onSelect={() => openEditDisplayName(u)}>
                                      <DropdownMenu.ItemLabel>修改显示名</DropdownMenu.ItemLabel>
                                    </DropdownMenu.Item>
                                    <DropdownMenu.Item onSelect={() => toggleRole(u)} disabled={self()}>
                                      <DropdownMenu.ItemLabel>
                                        {u.role === "admin" ? "降级为普通用户" : "升级为管理员"}
                                      </DropdownMenu.ItemLabel>
                                    </DropdownMenu.Item>
                                    <DropdownMenu.Item onSelect={() => confirmKickOffline(u)} disabled={self()}>
                                      <DropdownMenu.ItemLabel>踢下线</DropdownMenu.ItemLabel>
                                    </DropdownMenu.Item>
                                    <DropdownMenu.Item onSelect={() => toggleDisable(u)} disabled={self()}>
                                      <DropdownMenu.ItemLabel>
                                        {u.disabled ? "启用" : "禁用"}
                                      </DropdownMenu.ItemLabel>
                                    </DropdownMenu.Item>
                                    <DropdownMenu.Separator />
                                    <DropdownMenu.Item onSelect={() => confirmDelete(u)} disabled={self()}>
                                      <DropdownMenu.ItemLabel class="text-text-danger">删除用户</DropdownMenu.ItemLabel>
                                    </DropdownMenu.Item>
                                  </DropdownMenu.Content>
                                </DropdownMenu.Portal>
                              </DropdownMenu>
                            </td>
                          </tr>
                        )
                      }}
                    </For>
                  </tbody>
                </table>
              </div>
            </Show>
          </Show>
        </div>
      </div>
    </div>
  )
}

export default UsersAdminPage
