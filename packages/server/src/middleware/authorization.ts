import { UnauthorizedError } from "../errors"
import { Effect, Layer } from "effect"
import { HttpEffect, HttpServerRequest } from "effect/unstable/http"
import type { HttpServerResponse } from "effect/unstable/http"
import * as HttpServerResponseModule from "effect/unstable/http"
import { HttpApiMiddleware } from "effect/unstable/httpapi"
import { Service as UserService } from "@opencode-ai/core/user"
import { Service as AuthTokenService } from "@opencode-ai/core/auth-token"
import { CurrentUser, SESSION_COOKIE } from "./auth"

// 不需要认证的路径（登录/登出/健康检查）
const PUBLIC_PATHS = new Set([
  "/api/auth/login",
  "/api/auth/allowed-names",
  "/api/health",
])

export class Authorization extends HttpApiMiddleware.Service<Authorization, { provides: CurrentUser }>()(
  "@opencode/HttpApiAuthorization",
  {
    error: UnauthorizedError,
  },
) {}

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
  Effect.succeed(
    Authorization.of((effect) =>
      Effect.gen(function* () {
        const userSvc = yield* UserService
        const tokenSvc = yield* AuthTokenService

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
            yield* tokenSvc.extend(cookieToken).pipe(Effect.catch(() => Effect.void))
            // 加载用户
            const user = yield* userSvc.getUser(tokenInfo.userId).pipe(Effect.catch(() => Effect.succeed(null)))
            if (user && user.disabled === 0) {
              return yield* effect.pipe(Effect.provideService(CurrentUser, user))
            }
          }
          // cookie 存在但无效 → 拒绝（不回退到其他认证方式）
          yield* HttpEffect.appendPreResponseHandler((_req, response) =>
            Effect.succeed(HttpServerResponseModule.HttpServerResponse.setHeader(response, "www-authenticate", 'Bearer realm="opencode"')),
          )
          return yield* new UnauthorizedError({ message: "登录已过期" })
        }

        // 2. 无 cookie → 拒绝（不再支持 Basic Auth）
        yield* HttpEffect.appendPreResponseHandler((_req, response) =>
          Effect.succeed(HttpServerResponseModule.HttpServerResponse.setHeader(response, "www-authenticate", 'Bearer realm="opencode"')),
        )
        return yield* new UnauthorizedError({ message: "Authentication required" })
      }) as Effect.Effect<HttpServerResponse.HttpServerResponse, never, never>,
    ),
  ),
)
