import { type Component, lazy } from "solid-js"
import { Button } from "@opencode-ai/ui/button"
import { useDialog } from "@opencode-ai/ui/context/dialog"
import { useCurrentUser } from "@/context/auth"

// 动态导入改密对话框（避免首屏加载）
const ChangePasswordDialog = lazy(() => import("@/components/change-password-dialog"))

const UserSettingsPage: Component = () => {
  const { user, isAdmin } = useCurrentUser()
  const dialog = useDialog()

  const openChangePassword = () => {
    dialog.show(() => <ChangePasswordDialog />)
  }

  return (
    <div class="h-dvh w-screen flex flex-col items-center justify-center bg-background-base">
      <div class="flex flex-col items-center gap-8 w-full max-w-sm px-6">
        <h1 class="text-20-medium text-text-strong">账号设置</h1>

        <div class="w-full flex flex-col gap-4">
          <div class="flex flex-col gap-1.5">
            <label class="text-12-regular text-text-base">用户名</label>
            <div class="text-14-regular text-text-strong">{user?.username}</div>
          </div>

          <div class="flex flex-col gap-1.5">
            <label class="text-12-regular text-text-base">角色</label>
            <div class="text-14-regular text-text-strong">{isAdmin() ? "管理员" : "普通用户"}</div>
          </div>

          <div class="flex flex-col gap-2 pt-4">
            <Button variant="secondary" size="large" onClick={openChangePassword}>
              修改密码
            </Button>
          </div>
        </div>
      </div>
    </div>
  )
}

export default UserSettingsPage
