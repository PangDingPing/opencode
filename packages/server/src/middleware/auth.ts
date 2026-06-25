import { Context, Effect, Layer } from "effect"
import { HttpServerRequest, HttpServerResponse, HttpEffect } from "effect/unstable/http"
import { HttpApiMiddleware } from "effect/unstable/httpapi"
import { User } from "@opencode-ai/core/user"
import type { UserInfo } from "@opencode-ai/core/user"
import { AuthToken } from "@opencode-ai/core/auth-token"
import { UnauthorizedError } from "../errors"

// cookie 名称
export const SESSION_COOKIE = "oc_session"

// 当前用户上下文（被 require-admin 和业务 handler 使用）
export class CurrentUser extends Context.Tag("@opencode/CurrentUser")<CurrentUser, UserInfo>() {}

// 认证中间件：从 cookie 取 token → 验证 → 注入 CurrentUser
export class CookieAuth extends HttpApiMiddleware.Service<CookieAuth>()("@opencode/CookieAuth", {
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
  Effect.gen(function* () {
    const userSvc = yield* User.Service
    const tokenSvc = yield* AuthToken.Service

    return CookieAuth.of((effect) =>
      Effect.gen(function* () {
        const request = yield* HttpServerRequest.HttpServerRequest
        const token = parseCookie(request.headers.cookie)

        if (!token) {
          yield* HttpEffect.appendPreResponseHandler((_req, response) =>
            Effect.succeed(HttpServerResponse.setHeader(response, "www-authenticate", 'Bearer realm="opencode"')),
          )
          return yield* new UnauthorizedError({ message: "未登录" })
        }

        const tokenInfo = yield* tokenSvc.verify(token)
        if (!tokenInfo) {
          yield* HttpEffect.appendPreResponseHandler((_req, response) =>
            Effect.succeed(
              HttpServerResponse.setHeader(response, "www-authenticate", 'Bearer realm="opencode"'),
            ),
          )
          return yield* new UnauthorizedError({ message: "登录已过期" })
        }

        // 惰性续期（fire-and-forget，不阻塞请求）
        yield* tokenSvc.extend(token).pipe(Effect.catchAll(() => Effect.void))

        // 加载用户信息
        const user = yield* userSvc.getUser(tokenInfo.userId).pipe(
          Effect.catchAll(() =>
            Effect.gen(function* () {
              yield* HttpEffect.appendPreResponseHandler((_req, response) =>
                Effect.succeed(
                  HttpServerResponse.setHeader(response, "www-authenticate", 'Bearer realm="opencode"'),
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
      }),
    )
  }),
)
