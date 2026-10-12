import { Effect, Option, Schema } from "effect"
import { HttpApiBuilder } from "effect/unstable/httpapi"
import { HttpServerResponse, HttpServerRequest, HttpEffect } from "effect/unstable/http"
import { Api } from "../api"
import { User } from "@opencode-ai/core/user"
import { AuthToken } from "@opencode-ai/core/auth-token"
// yejian: 登录审计服务（登录成功/登出/登录失败埋点）
import { AuthAudit } from "@opencode-ai/core/auth-audit"
import { CurrentUser, SESSION_COOKIE } from "../middleware/auth"
import { UnauthorizedError, InvalidRequestError } from "../errors"

// 登录限速：同 IP 5 次失败锁 15 分钟
const loginAttempts = new Map<string, { count: number; lockedUntil: number }>()
const MAX_ATTEMPTS = 5
const LOCK_DURATION = 15 * 60 * 1000

function checkRateLimit(ip: string): boolean {
  const now = Date.now()
  const record = loginAttempts.get(ip)
  if (record && record.lockedUntil > now) return false
  return true
}

function recordFailedAttempt(ip: string) {
  const now = Date.now()
  const record = loginAttempts.get(ip) ?? { count: 0, lockedUntil: 0 }
  record.count++
  if (record.count >= MAX_ATTEMPTS) {
    record.lockedUntil = now + LOCK_DURATION
    record.count = 0
  }
  loginAttempts.set(ip, record)
}

function clearFailedAttempts(ip: string) {
  loginAttempts.delete(ip)
}

// 设置 cookie
function setSessionCookie(response: HttpServerResponse.HttpServerResponse, token: string, maxAge: number) {
  return HttpServerResponse.setHeader(response, "set-cookie", `${SESSION_COOKIE}=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAge}`)
}

// 清除 cookie
function clearSessionCookie(response: HttpServerResponse.HttpServerResponse) {
  return HttpServerResponse.setHeader(response, "set-cookie", `${SESSION_COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`)
}

function parseCookie(cookieHeader: string): string | null {
  if (!cookieHeader) return null
  for (const part of cookieHeader.split(";")) {
    const [key, ...valueParts] = part.trim().split("=")
    if (key === SESSION_COOKIE) return valueParts.join("=")
  }
  return null
}

// yejian: 归一化 TCP 对端地址（IPv6 mapped IPv4 "::ffff:192.168.1.5" → "192.168.1.5"）
function normalizeRemoteIP(addr: string): string {
  if (addr.startsWith("::ffff:")) return addr.slice(7)
  return addr
}

// 客户端 IP 解析链：代理头优先 → TCP 对端地址（局域网直连无代理头时的兜底）→ unknown
function getRequestIP(request: HttpServerRequest.HttpServerRequest): string {
  const remote = request.remoteAddress
  const remoteIP = Option.isSome(remote) ? normalizeRemoteIP(remote.value) : undefined
  return request.headers["x-forwarded-for"] ?? request.headers["x-real-ip"] ?? remoteIP ?? "unknown"
}

export const AuthHandler = HttpApiBuilder.group(Api, "server.auth", (handlers) =>
  Effect.gen(function* () {
    const userSvc = yield* User.Service
    const tokenSvc = yield* AuthToken.Service
    // yejian: 登录审计服务（best-effort 记录，失败不影响登录主流程）
    const auditSvc = yield* AuthAudit.Service

    return handlers
      .handle("auth.login", (req) =>
        Effect.gen(function* () {
          const { username, password } = req.payload
          const request = yield* HttpServerRequest.HttpServerRequest
          const ip = getRequestIP(request)
          const userAgent = request.headers["user-agent"]

          if (!checkRateLimit(ip)) {
            // yejian: 限速锁定拒绝也记审计——否则爆破时只见 5 条后沉默，看不出持续异常
            yield* auditSvc.record({ username, action: "login_failed", ip, userAgent })
            return yield* new InvalidRequestError({ message: "登录尝试过多，请 15 分钟后再试" })
          }

          const user = yield* userSvc.verifyPassword(username, password)
          if (!user) {
            recordFailedAttempt(ip)
            // yejian: 登录失败审计（username 为登录尝试的快照，无论用户是否存在）
            yield* auditSvc.record({ username, action: "login_failed", ip, userAgent })
            return yield* new UnauthorizedError({ message: "用户名或密码错误" })
          }
          clearFailedAttempts(ip)

          const tokenInfo = yield* tokenSvc.create(user.id, userAgent, ip)
          // yejian: 登录成功审计
          yield* auditSvc.record({ userId: user.id, username: user.username, action: "login", ip, userAgent })
          const maxAge = Math.floor((tokenInfo.expiresAt - Date.now()) / 1000)

          // 直接构造带 cookie 的 HttpServerResponse（appendPreResponseHandler 对 plain object 不生效）
          return setSessionCookie(
            HttpServerResponse.jsonUnsafe({
              user: {
                id: user.id,
                username: user.username,
                role: user.role,
                display_name: user.display_name ?? undefined,
                must_change_password: user.must_change_password === 1,
              },
            }),
            tokenInfo.token,
            maxAge,
          )
        }),
      )
      .handle("auth.logout", () =>
        Effect.gen(function* () {
          const request = yield* HttpServerRequest.HttpServerRequest
          const token = parseCookie(request.headers.cookie ?? "")
          // yejian: Authorization 全局中间件已注入 CurrentUser（logout 非公开路径），直接取当前用户记登出审计
          const user = yield* CurrentUser
          if (token) {
            yield* tokenSvc.revoke(token)
          }
          // yejian: 登出审计
          yield* auditSvc.record({
            userId: user.id,
            username: user.username,
            action: "logout",
            ip: getRequestIP(request),
            userAgent: request.headers["user-agent"],
          })
          // 直接构造带清除 cookie 的 HttpServerResponse（appendPreResponseHandler 对 plain object 不生效）
          return clearSessionCookie(HttpServerResponse.jsonUnsafe({ ok: true }))
        }),
      )
      .handle("auth.me", () =>
        Effect.gen(function* () {
          const user = yield* CurrentUser
          return {
            id: user.id,
            username: user.username,
            role: user.role,
            display_name: user.display_name ?? undefined,
            must_change_password: user.must_change_password === 1,
          }
        }),
      )
      .handle("auth.change-password", (req) =>
        Effect.gen(function* () {
          const user = yield* CurrentUser
          const { oldPassword, newPassword } = req.payload

          const verified = yield* userSvc.verifyPassword(user.username, oldPassword)
          if (!verified) {
            return yield* new InvalidRequestError({ message: "旧密码错误" })
          }

          // yejian: changePassword 失败为普通 Error，映射为 endpoint 声明的 InvalidRequestError（保留原始错误信息）
          yield* userSvc.changePassword(user.id, newPassword).pipe(
            Effect.mapError((e) => new InvalidRequestError({ message: e.message })),
          )

          // 撤销其他 session（保留当前）
          const request = yield* HttpServerRequest.HttpServerRequest
          const currentToken = parseCookie(request.headers.cookie ?? "")
          if (currentToken) {
            // 撤销该用户所有 token，然后重新创建当前 token
            yield* tokenSvc.revokeAllForUser(user.id)
            const newToken = yield* tokenSvc.create(user.id, request.headers["user-agent"], getRequestIP(request))
            const maxAge = Math.floor((newToken.expiresAt - Date.now()) / 1000)
            return setSessionCookie(HttpServerResponse.jsonUnsafe({ ok: true }), newToken.token, maxAge)
          }

          return HttpServerResponse.jsonUnsafe({ ok: true })
        }),
      )
      .handle("auth.allowed-names", () =>
        Effect.gen(function* () {
          const names = yield* userSvc.getAllowedNames()
          return { names }
        }),
      )
      .handle("auth.delete-account", () =>
        Effect.gen(function* () {
          const user = yield* CurrentUser
          yield* userSvc.deleteUser(user.id)
          // endpoint 成功响应定义为 { ok: true }（原误返回 HttpApiSchema.NoContent schema 对象，运行时也不正确）
          return { ok: true }
        }),
      )
  }),
)
