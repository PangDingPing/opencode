import { base64Encode } from "@opencode-ai/core/util/encode"

// yejian: 默认打开的项目路径（容器内绝对路径）
// 对应宿主机的 D:\AI\AIworkbench\YEJIAN，由 docker/build.ps1 挂载
export const DEFAULT_PROJECT_PATH = "/YEJIAN"

// yejian: 默认项目的 URL 路径（base64 编码后的目录，与 :dir 路由匹配）
export const DEFAULT_PROJECT_HREF = `/${base64Encode(DEFAULT_PROJECT_PATH)}`

// yejian: 跳转到默认项目（用 window.location.href 触发整页刷新，确保项目状态完全重载）
export function navigateToDefaultProject() {
  window.location.href = DEFAULT_PROJECT_HREF
}
