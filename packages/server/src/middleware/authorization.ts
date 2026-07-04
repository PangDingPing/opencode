import { ServerAuth } from "../auth"
import { UnauthorizedError } from "@opencode-ai/protocol/errors"
import { Authorization } from "@opencode-ai/protocol/middleware/authorization"
export { Authorization } from "@opencode-ai/protocol/middleware/authorization"
import { hasPtyConnectTicketURL } from "@opencode-ai/protocol/groups/pty"
import { Effect, Encoding, Layer, Redacted } from "effect"
import { HttpEffect, HttpServerRequest, HttpServerResponse } from "effect/unstable/http"
import { Service as UserService, UserID } from "@opencode-ai/core/user"
import { Service as AuthTokenService } from "@opencode-ai/core/auth-token"
import { CurrentUser, SESSION_COOKIE } from "./auth"

const AUTH_TOKEN_QUERY = "auth_token"
const WWW_AUTHENTICATE = 'Basic realm="Secure Area"'

// 公开路径：无需认证即可访问
const PUBLIC_PATHS = new Set(["/api/auth/login", "/api/auth/allowed-names", "/api/health"])

function emptyCredential() {
  return { username: "", password: Redacted.make("") }
}

// 从 cookie 头解析 oc_session token
function parseCookieToken(cookieHeader: string | undefined): string | null {
  if (!cookieHeader) return null
  for (const part of cookieHeader.split(";")) {
    const [key, ...valueParts] = part.trim().split("=")
    if (key === SESSION_COOKIE) return valueParts.join("=")
  }
  return null
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

function credentialFromRequest(request: HttpServerRequest.HttpServerRequest) {
  const url = new URL(request.url, "http://localhost")
  const token = url.searchParams.get(AUTH_TOKEN_QUERY)
  if (token) return decodeCredential(token)
  const match = /^Basic\s+(.+)$/i.exec(request.headers.authorization ?? "")
  if (match) return decodeCredential(match[1])
  return Effect.succeed(emptyCredential())
}

export const authorizationLayer = Layer.effect(
  Authorization,
  Effect.gen(function* () {
    const config = yield* ServerAuth.Config
    // 获取 User/AuthToken service 用于 cookie 认证
    const userSvc = yield* UserService
    const tokenSvc = yield* AuthTokenService

    return Authorization.of((effect) =>
      Effect.gen(function* () {
        const request = yield* HttpServerRequest.HttpServerRequest
        const url = new URL(request.url, "http://localhost")

        // 公开路径直接放行
        if (PUBLIC_PATHS.has(url.pathname)) return yield* effect

        // 1. 先检查 cookie（web 用户）
        const cookieToken = parseCookieToken(request.headers.cookie)
        if (cookieToken) {
          const tokenInfo = yield* tokenSvc.verify(cookieToken).pipe(
            Effect.catch(() => Effect.succeed(null)),
          )
          if (tokenInfo) {
            const user = yield* userSvc.getUser(UserID.make(tokenInfo.userId)).pipe(
              Effect.catch(() => Effect.succeed(null)),
            )
            if (user && user.disabled === 0) {
              // 惰性续期
              yield* tokenSvc.extend(cookieToken).pipe(Effect.catch(() => Effect.void))
              return yield* effect.pipe(Effect.provideService(CurrentUser, user))
            }
          }
        }

        // 2. 检查 Basic Auth（CLI 用户）—— 仅在设置了 OPENCODE_SERVER_PASSWORD 时生效
        if (ServerAuth.required(config)) {
          // Browsers cannot set headers on WebSocket upgrades, so a ticketed PTY connect skips
          // credential checks here; the connect handler consumes and validates the ticket.
          if (hasPtyConnectTicketURL(url)) return yield* effect
          const credential = yield* credentialFromRequest(request)
          if (ServerAuth.authorized(credential, config)) {
            const cliUser = {
              id: UserID.make("usr_cli"),
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
          yield* HttpEffect.appendPreResponseHandler((_request, response) =>
            Effect.succeed(HttpServerResponse.setHeader(response, "www-authenticate", WWW_AUTHENTICATE)),
          )
        }

        // 3. 都没有，返回 401
        return yield* new UnauthorizedError({ message: "Authentication required" })
      }),
    )
  }),
)
