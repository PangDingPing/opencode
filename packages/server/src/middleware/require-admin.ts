import { Effect, Layer, Option } from "effect"
import { HttpApiMiddleware } from "effect/unstable/httpapi"
import { CurrentUser } from "./auth"
import { ForbiddenError } from "../errors"

// admin 守卫中间件：非 admin 返回 403
export class RequireAdmin extends HttpApiMiddleware.Service<RequireAdmin>()("@opencode/RequireAdmin", {
  error: ForbiddenError,
}) {}

export const requireAdminLayer = Layer.effect(
  RequireAdmin,
  Effect.succeed(
    RequireAdmin.of((effect) =>
      Effect.gen(function* () {
        // yejian: 用 serviceOption 读取（上游 handlers 同款模式），不往 middleware impl 的 R 通道加 CurrentUser 需求；
        // CurrentUser 缺失（未经过认证中间件）按非 admin 处理，fail-closed 返回 403
        const user = yield* Effect.serviceOption(CurrentUser)
        if (!Option.isSome(user) || user.value.role !== "admin") {
          return yield* new ForbiddenError({ message: "需要管理员权限" })
        }
        return yield* effect
      }),
    ),
  ),
)
