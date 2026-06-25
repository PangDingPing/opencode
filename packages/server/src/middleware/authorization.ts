import { ServerAuth } from "../auth"
import { UnauthorizedError } from "../errors"
import { Effect, Encoding, Layer, Redacted } from "effect"
import { HttpEffect, HttpServerRequest, HttpServerResponse } from "effect/unstable/http"
import { HttpApiMiddleware } from "effect/unstable/httpapi"
import { User } from "@opencode-ai/core/user"
import { AuthToken } from "@opencode-ai/core/auth-token"
import { CurrentUser, SESSION_COOKIE } from "./auth"

const AUTH_TOKEN_QUERY = "auth_token"
const WWW_AUTHENTICATE = 'Basic realm="Secure Area"'

// 不需要认证的路径（登录/登出/健康检查）
const PUBLIC_PATHS = new Set(["/api/auth/login", "/api/health"])

export class Authorization extends HttpApiMiddleware.Service<Authorization>()("@opencode/HttpApiAuthorization", {
  error: UnauthorizedError,
}) {}

function emptyCredential() {
  return { username: "", password: Redacted.make("") }
}

function decodeCredential(input: string) {
  return Effect.fromResult(Encoding.decodeBase64String(input)).pipe(
    Effect.match({
      onFailure: emptyCredential,
      onSuccess: (header) => {
        const separator = header.indexOf(":")
        if (separator === -1) return emptyCredential()
        return { username: header.slice(0, separator), password: Redacted.make(header.slice(separator + 1)) }
      },
    }),
  )
}

// 从 Basic Auth header 提取凭证（CLI 用）
function credentialFromRequest(request: HttpServerRequest.HttpServerRequest) {
  const url = new URL(request.url, "http://localhost")
  const token = url.searchParams.get(AUTH_TOKEN_QUERY)
  if (token) return decodeCredential(token)
  const match = /^Basic\s+(.+)$/i.exec(request.headers.authorization ?? "")
  if (match) return decodeCredential(match[1])
  return Effect.succeed(emptyCredential())
}

// 从 cookie 提取 session token（web 用）
function tokenFromCookie(request: HttpServerRequest.HttpServerRequest): string | null {
  const cookieHeader = request.headers.cookie
  if (!cookieHeader) return null
  for (const part of cookieHeader.split(";")) {
    const [key, ...valueParts] = part.trim().split("=")
    if (key === SESSION_COOKIE) return valueParts.join("=")
  }
  return null
}

export const authorizationLayer = Layer.effect(
  Authorization,
  Effect.gen(function* () {
    const config = yield* ServerAuth.Config
    const userSvc = yield* User.Service
    const tokenSvc = yield* AuthToken.Service
    const needsBasicAuth = ServerAuth.required(config)

    return Authorization.of((effect) =>
      Effect.gen(function* () {
        const request = yield* HttpServerRequest.HttpServerRequest
        const url = new URL(request.url, "http://localhost")

        // 公开路径直接放行
        if (PUBLIC_PATHS.has(url.pathname)) return yield* effect

        // 1. 尝试 cookie 认证（web 端）
        const cookieToken = tokenFromCookie(request)
        if (cookieToken) {
          const tokenInfo = yield* tokenSvc.verify(cookieToken)
          if (tokenInfo) {
            // 惰性续期
            yield* tokenSvc.extend(cookieToken).pipe(Effect.catchAll(() => Effect.void))
            // 加载用户
            const user = yield* userSvc.getUser(tokenInfo.userId).pipe(Effect.catchAll(() => Effect.succeed(null)))
            if (user && user.disabled === 0) {
              return yield* effect.pipe(Effect.provideService(CurrentUser, user))
            }
          }
          // cookie 存在但无效 → 拒绝（不回退到 Basic Auth）
          yield* HttpEffect.appendPreResponseHandler((_req, response) =>
            Effect.succeed(HttpServerResponse.setHeader(response, "www-authenticate", 'Bearer realm="opencode"')),
          )
          return yield* new UnauthorizedError({ message: "登录已过期" })
        }

        // 2. 尝试 Basic Auth（CLI 端）
        if (needsBasicAuth) {
          const credential = yield* credentialFromRequest(request)
          if (ServerAuth.authorized(credential, config)) {
            // Basic Auth 通过 → 注入一个 admin 用户（CLI 操作不区分用户）
            const cliUser = {
              id: "usr_cli",
              username: config.username,
              role: "admin" as const,
              display_name: "CLI",
              disabled: 0,
              must_change_password: 0,
              time_created: 0,
              time_updated: 0,
            }
            return yield* effect.pipe(Effect.provideService(CurrentUser, cliUser))
          }
          yield* HttpEffect.appendPreResponseHandler((_req, response) =>
            Effect.succeed(HttpServerResponse.setHeader(response, "www-authenticate", WWW_AUTHENTICATE)),
          )
          return yield* new UnauthorizedError({ message: "Authentication required" })
        }

        // 3. 无认证模式（开发环境）→ 注入默认 admin
        const defaultUser = {
          id: "usr_default",
          username: "default",
          role: "admin" as const,
          display_name: "Default",
          disabled: 0,
          must_change_password: 0,
          time_created: 0,
          time_updated: 0,
        }
        return yield* effect.pipe(Effect.provideService(CurrentUser, defaultUser))
      }),
    )
  }),
)
