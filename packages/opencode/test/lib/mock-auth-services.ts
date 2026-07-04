import { Effect, Layer } from "effect"
import { Service as UserService } from "@opencode-ai/core/user"
import { Service as AuthTokenService } from "@opencode-ai/core/auth-token"

// 多用户改造后 authorizationLayer 依赖 User.Service / AuthToken.Service。
// 只覆盖 Basic Auth 路径的测试不需要真实 cookie 鉴权分支，提供 mock 让 layer 构造通过即可。
const never = Effect.die("not used in this test")

export const mockUserLayer = Layer.succeed(
  UserService,
  UserService.of({
    createUser: () => never,
    verifyPassword: () => Effect.succeed(null),
    getUser: () => never,
    getByUsername: () => Effect.succeed(null),
    listUsers: () => Effect.succeed([]),
    updateUser: () => never,
    changePassword: () => never,
    resetPassword: () => never,
    setDisabled: () => never,
    deleteUser: () => never,
    getAllowedNames: () => Effect.succeed([]),
  }),
)

export const mockAuthTokenLayer = Layer.succeed(
  AuthTokenService,
  AuthTokenService.of({
    create: () => never,
    verify: () => Effect.succeed(null),
    extend: () => Effect.void,
    revoke: () => Effect.void,
    revokeAllForUser: () => Effect.void,
    cleanupExpired: () => Effect.void,
  }),
)

export const mockAuthServicesLayer = Layer.mergeAll(mockUserLayer, mockAuthTokenLayer)
