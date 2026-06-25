import { Effect, Layer } from "effect"
import { HttpApiMiddleware } from "effect/unstable/httpapi"
import { CurrentUser } from "./auth"
import { ForbiddenError } from "../errors"

// admin 守卫中间件：非 admin 返回 403
export class RequireAdmin extends HttpApiMiddleware.Service<RequireAdmin>()("@opencode/RequireAdmin", {
  error: ForbiddenError,
}) {}

export const requireAdminLayer = Layer.succeed(
  RequireAdmin,
  RequireAdmin.of((effect) =>
    Effect.gen(function* () {
      const user = yield* CurrentUser
      if (user.role !== "admin") {
        return yield* new ForbiddenError({ message: "需要管理员权限" })
      }
      return yield* effect
    }),
  ),
)
