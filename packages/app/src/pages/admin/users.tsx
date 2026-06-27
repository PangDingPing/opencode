import { createResource, createSignal, For, Show, type Component } from "solid-js"
import { Button } from "@opencode-ai/ui/button"
import { useCurrentUser } from "@/context/auth"

// 用户信息（从后端 /api/auth/me 等获取，后续阶段 5 补充完整用户列表 API）
type UserItem = {
  id: string
  username: string
  role: "admin" | "user"
  display_name?: string
  disabled: boolean
  must_change_password: boolean
}

// 用户管理页（admin-only）：显示白名单 + 用户列表占位
// 完整的用户管理功能（重置密码、禁用、踢人）需要后端补充 API，阶段 5 实现
const UsersAdminPage: Component = () => {
  const { isAdmin } = useCurrentUser()
  const [allowedNames] = createResource(async () => {
    const res = await fetch("/api/auth/allowed-names", { credentials: "include" })
    if (!res.ok) return [] as string[]
    const data = await res.json()
    return data.names as string[]
  })

  return (
    <div class="h-dvh w-screen flex flex-col bg-background-base">
      <div class="flex-1 overflow-y-auto p-8">
        <div class="max-w-4xl mx-auto flex flex-col gap-6">
          <div class="flex flex-col gap-2">
            <h1 class="text-20-medium text-text-strong">用户管理</h1>
            <p class="text-14-regular text-text-base">管理公司 30 人用户账号</p>
          </div>

          <Show when={isAdmin()} fallback={<div class="text-14-regular text-text-danger">无权访问此页面</div>}>
            {/* 白名单列表 */}
            <div class="flex flex-col gap-3">
              <h2 class="text-16-medium text-text-strong">实名白名单（{allowedNames()?.length ?? 0} 人）</h2>
              <div class="rounded-lg border border-border-weak-base overflow-hidden">
                <table class="w-full">
                  <thead class="bg-surface-raised-base-hover">
                    <tr>
                      <th class="px-4 py-2 text-left text-12-regular text-text-base">序号</th>
                      <th class="px-4 py-2 text-left text-12-regular text-text-base">实名</th>
                      <th class="px-4 py-2 text-left text-12-regular text-text-base">状态</th>
                    </tr>
                  </thead>
                  <tbody>
                    <For each={allowedNames() ?? []}>
                      {(name, index) => (
                        <tr class="border-t border-border-weaker-base">
                          <td class="px-4 py-2 text-14-regular text-text-base">{index() + 1}</td>
                          <td class="px-4 py-2 text-14-regular text-text-strong">{name}</td>
                          <td class="px-4 py-2 text-12-regular text-text-weak">已注册</td>
                        </tr>
                      )}
                    </For>
                  </tbody>
                </table>
              </div>
              <p class="text-12-regular text-text-weak">
                提示：完整的用户管理功能（重置密码、禁用、踢人下线）将在阶段 5 后端 API 完善后启用。
              </p>
            </div>
          </Show>
        </div>
      </div>
    </div>
  )
}

export default UsersAdminPage
