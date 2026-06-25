import { Show, type Component } from "solid-js"
import { DropdownMenu } from "@opencode-ai/ui/dropdown-menu"
import { IconButton } from "@opencode-ai/ui/icon-button"
import { Icon } from "@opencode-ai/ui/icon"
import { useDialog } from "@opencode-ai/ui/context/dialog"
import { useCurrentUser, logout } from "@/context/auth"
import { lazy } from "solid-js"

// 动态导入改密页和用户管理页（避免首屏加载）
const ChangePasswordDialog = lazy(() => import("./change-password-dialog"))

// 顶栏用户菜单：显示实名 + 退出登录 + 修改密码 + 用户管理入口（admin）
export const UserMenu: Component = () => {
  const { user, isAdmin } = useCurrentUser()
  const dialog = useDialog()

  const openChangePassword = () => {
    dialog.show(() => <ChangePasswordDialog />)
  }

  const openUsersAdmin = () => {
    // 用户管理页通过新窗口打开（避免路由冲突）
    window.open("/admin/users", "_blank")
  }

  const handleLogout = () => {
    void logout()
  }

  // 显示名优先 display_name，其次 username
  const displayName = () => user.display_name ?? user.username

  return (
    <DropdownMenu>
      <DropdownMenu.Trigger
        as={IconButton}
        icon="user"
        variant="ghost"
        class="titlebar-icon rounded-md"
        aria-label={displayName()}
      />
      <DropdownMenu.Portal>
        <DropdownMenu.Content class="mt-1 min-w-[180px]">
          {/* 当前用户信息 */}
          <div class="px-3 py-2 border-b border-border-weaker-base">
            <div class="text-14-medium text-text-strong truncate">{displayName()}</div>
            <div class="text-12-regular text-text-weak">
              {isAdmin() ? "管理员" : "普通用户"}
            </div>
          </div>

          {/* 修改密码 */}
          <DropdownMenu.Item onSelect={openChangePassword}>
            <DropdownMenu.ItemLabel>修改密码</DropdownMenu.ItemLabel>
          </DropdownMenu.Item>

          {/* 用户管理（仅 admin） */}
          <Show when={isAdmin()}>
            <DropdownMenu.Item onSelect={openUsersAdmin}>
              <DropdownMenu.ItemLabel>用户管理</DropdownMenu.ItemLabel>
            </DropdownMenu.Item>
          </Show>

          <DropdownMenu.Separator />

          {/* 退出登录 */}
          <DropdownMenu.Item onSelect={handleLogout}>
            <DropdownMenu.ItemLabel class="text-text-danger">退出登录</DropdownMenu.ItemLabel>
          </DropdownMenu.Item>
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu>
  )
}
