import { createOpencodeClient } from "@opencode-ai/sdk/v2/client"
import type { ServerConnection } from "@/context/server"
import { decode64 } from "@/utils/base64"

export function authTokenFromCredentials(input: { username?: string; password: string }) {
  return btoa(`${input.username ?? "opencode"}:${input.password}`)
}

export function authFromToken(token: string | null) {
  const decoded = decode64(token ?? undefined)
  if (!decoded) return
  const separator = decoded.indexOf(":")
  if (separator === -1) return
  return {
    username: decoded.slice(0, separator) || "opencode",
    password: decoded.slice(separator + 1),
  }
}

// 模块级标志：避免多个并发 401 触发重复跳转
let isRedirectingToLogin = false
// 记录本次页面加载期间 SDK 是否曾请求成功过。
//   - 未登录用户首次访问：从未成功 → 收到 401 不拦截，交给 AuthGate 显示登录页
//   - 已登录用户 cookie 失效：之前成功过 → 收到 401 拦截跳转登录页
//   - 跳转后页面重载，标志重置，不会死循环
let hasEverSucceeded = false

export function createSdkForServer({
  server,
  ...config
}: Omit<NonNullable<Parameters<typeof createOpencodeClient>[0]>, "baseUrl"> & {
  server: ServerConnection.HttpBase
}) {
  const auth = (() => {
    if (!server.password) return
    return {
      Authorization: `Basic ${authTokenFromCredentials({ username: server.username, password: server.password })}`,
    }
  })()

  // 包装 fetch：跨域请求（dev 模式 :3000 → :4098）必须带 cookie 才能完成会话认证
  //   拦截 401：仅在"已登录用户 cookie 失效"时跳转登录页，未登录用户首次访问不拦截
  const underlyingFetch = config.fetch ?? fetch
  const fetchWithCredentials = Object.assign(
    (req: any) => {
      const next = new Request(req, { credentials: "include" })
      return underlyingFetch(next).then((response: Response) => {
        if (response.ok) hasEverSucceeded = true
        if (response.status === 401 && hasEverSucceeded && !isRedirectingToLogin) {
          isRedirectingToLogin = true
          try { localStorage.removeItem("opencode.global.dat:tabs") } catch {}
          window.location.href = "/"
        }
        return response
      })
    },
    { preconnect: underlyingFetch.preconnect },
  )

  return createOpencodeClient({
    ...config,
    fetch: fetchWithCredentials,
    headers: {
      ...(config.headers instanceof Headers ? Object.fromEntries(config.headers.entries()) : config.headers),
      ...auth,
    },
    baseUrl: server.url,
  })
}
