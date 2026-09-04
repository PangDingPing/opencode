import { Context, Effect, Layer } from "effect"
import { HttpServerRequest, HttpEffect } from "effect/unstable/http"
import type { HttpServerResponse } from "effect/unstable/http"
import * as HttpServerResponseModule from "effect/unstable/http"
import { HttpApiMiddleware } from "effect/unstable/httpapi"
import { Service as UserService } from "@opencode-ai/core/user"
import type { UserInfo } from "@opencode-ai/core/user"
import { Service as AuthTokenService } from "@opencode-ai/core/auth-token"
import { UnauthorizedError } from "../errors"

// cookie 名称
export const SESSION_COOKIE = "oc_session"

// 当前用户上下文（被 require-admin 和业务 handler 使用）
// Effect 4 class-style：class Service extends Context.Service<Service, 接口>()("Key") {}
export class CurrentUser extends Context.Service<CurrentUser, UserInfo>()("@opencode/CurrentUser") {}

// 认证中间件：从 cookie 取 token → 验证 → 注入 CurrentUser
// yejian: 声明 provides: CurrentUser（上游 WorkspaceRoutingMiddleware 同款），
// 让 handler 里 `yield* CurrentUser` 的请求级依赖在类型层可满足
export class CookieAuth extends HttpApiMiddleware.Service<CookieAuth, { provides: CurrentUser }>()("@opencode/CookieAuth", {
  error: UnauthorizedError,
}) {}

function parseCookie(cookieHeader: string | undefined): string | null {
  if (!cookieHeader) return null
  for (const part of cookieHeader.split(";")) {
    const [key, ...valueParts] = part.trim().split("=")
    if (key === SESSION_COOKIE) return valueParts.join("=")
  }
  return null
}

export const cookieAuthLayer = Layer.effect(
  CookieAuth,
  Effect.succeed(
    CookieAuth.of((effect) =>
      Effect.gen(function* () {
        const userSvc = yield* UserService
        const tokenSvc = yield* AuthTokenService

        const request = yield* HttpServerRequest.HttpServerRequest
        const url = new URL(request.url, "http://localhost")
        // 公开路径直接放行
        const PUBLIC_PATHS = new Set(["/api/auth/login", "/api/auth/allowed-names", "/api/health"])
        if (PUBLIC_PATHS.has(url.pathname)) return yield* effect

        const token = parseCookie(request.headers.cookie)

        if (!token) {
          yield* HttpEffect.appendPreResponseHandler((_req, response) =>
            Effect.succeed(HttpServerResponseModule.HttpServerResponse.setHeader(response, "www-authenticate", 'Bearer realm="opencode"')),
          )
          return yield* new UnauthorizedError({ message: "未登录" })
        }

        const tokenInfo = yield* tokenSvc.verify(token)
        if (!tokenInfo) {
          yield* HttpEffect.appendPreResponseHandler((_req, response) =>
            Effect.succeed(
              HttpServerResponseModule.HttpServerResponse.setHeader(response, "www-authenticate", 'Bearer realm="opencode"'),
            ),
          )
          return yield* new UnauthorizedError({ message: "登录已过期" })
        }

        // 惰性续期（fire-and-forget，不阻塞请求）
        yield* tokenSvc.extend(token).pipe(Effect.catch(() => Effect.void))

        // 加载用户信息
        const user = yield* userSvc.getUser(tokenInfo.userId).pipe(
          Effect.catch(() =>
            Effect.gen(function* () {
              yield* HttpEffect.appendPreResponseHandler((_req, response) =>
                Effect.succeed(
                  HttpServerResponseModule.HttpServerResponse.setHeader(response, "www-authenticate", 'Bearer realm="opencode"'),
                ),
              )
              return yield* new UnauthorizedError({ message: "用户不存在" })
            }),
          ),
        )

        if (user.disabled === 1) {
          return yield* new UnauthorizedError({ message: "账号已禁用" })
        }

        // 注入 CurrentUser 到上下文
        return yield* effect.pipe(Effect.provideService(CurrentUser, user))
      }) as Effect.Effect<HttpServerResponse.HttpServerResponse, never, never>,
    ),
  ),
)
