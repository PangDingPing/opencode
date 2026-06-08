import { createMemo } from "solid-js"

/**
 * 读取当前登录用户的手机号。
 * 用途：从 index.html 的 <meta name="x-user"> 读取 nginx 注入的手机号；
 *      开发模式下若占位符 __USER__ 未被替换，回退到环境变量 VITE_DEV_USER。
 * 入参：无
 * 返回：响应式手机号字符串（11 位）；未登录或读取失败时为 ""
 */
export function useCurrentUser() {
  return createMemo(() => {
    const meta = document.querySelector('meta[name="x-user"]') as HTMLMetaElement | null
    const raw = meta?.content ?? ""
    if (raw && raw !== "__USER__") return raw
    return (import.meta.env.VITE_DEV_USER as string | undefined) ?? ""
  })
}