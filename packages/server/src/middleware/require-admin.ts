import { Effect, Layer } from "effect"
import type { HttpServerResponse } from "effect/unstable/http"
import { RequireAdmin } from "@opencode-ai/protocol/middleware/require-admin"
export { RequireAdmin } from "@opencode-ai/protocol/middleware/require-admin"
import { ForbiddenError } from "@opencode-ai/protocol/errors"
import { CurrentUser } from "./auth"

// requireAdmin 实现：非 admin 返回 403
// class 定义在 protocol 包，实现 layer 留在 server 包（依赖 CurrentUser）
// as 断言：CurrentUser 由 CookieAuth 在运行时提供，类型上绕过 Provided 约束
export const requireAdminLayer = Layer.effect(
  RequireAdmin,
  Effect.succeed(
    RequireAdmin.of((effect) =>
      Effect.gen(function* () {
        const user = yield* CurrentUser
        if (user.role !== "admin") {
          return yield* new ForbiddenError({ message: "需要管理员权限" })
        }
        return yield* effect
      }) as Effect.Effect<HttpServerResponse.HttpServerResponse, ForbiddenError, never>,
    ),
  ),
)
