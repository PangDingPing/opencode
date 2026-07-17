import { type Component } from "solid-js"
import { IconButton } from "@opencode-ai/ui/icon-button"

// 顶栏帮助按钮：点击在新窗口打开 yejian_help.pdf 帮助文件
export const HelpButton: Component = () => {
  // 帮助文件路径（构建时由后端从 public/yejian/ 目录提供静态服务）
  const HELP_PDF_URL = "/yejian/yejian_help.pdf"

  const openHelp = () => {
    window.open(HELP_PDF_URL, "_blank", "noopener,noreferrer")
  }

  return (
    <IconButton
      icon="help"
      variant="ghost"
      class="titlebar-icon rounded-md"
      aria-label="帮助"
      onClick={openHelp}
    />
  )
}
