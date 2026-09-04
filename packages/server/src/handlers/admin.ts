import { Effect } from "effect"
import { HttpApiBuilder, HttpApiSchema } from "effect/unstable/httpapi"
import { Api } from "../api"
import { User, type UserInfo } from "@opencode-ai/core/user"
import { AuthToken } from "@opencode-ai/core/auth-token"
import { CurrentUser } from "../middleware/auth"
import { ForbiddenError, InvalidRequestError, ConflictError } from "../errors"

// UserInfo（disabled/must_change_password 是 number）→ 响应（boolean）
function toResponse(user: UserInfo) {
  return {
    id: user.id,
    username: user.username,
    role: user.role,
    display_name: user.display_name,
    disabled: user.disabled === 1,
    must_change_password: user.must_change_password === 1,
    time_created: user.time_created,
    time_updated: user.time_updated,
  }
}

export const AdminHandler = HttpApiBuilder.group(Api, "server.admin", (handlers) =>
  Effect.gen(function* () {
    const userSvc = yield* User.Service
    const tokenSvc = yield* AuthToken.Service

    // 自保护：不能对自己执行某操作
    const assertNotSelf = (targetId: string, action: string) =>
      Effect.gen(function* () {
        const me = yield* CurrentUser
        if (me.id === targetId) return yield* new ForbiddenError({ message: `不能对自己执行${action}` })
      })

    // 最后一个 admin 防护：若目标是 admin，确保还有其他启用的 admin
    const assertNotLastAdmin = (targetId: string) =>
      Effect.gen(function* () {
        const users = yield* userSvc.listUsers()
        const others = users.filter((u) => u.role === "admin" && u.disabled === 0 && u.id !== targetId)
        if (others.length === 0) return yield* new ConflictError({ message: "系统至少需保留一个启用的管理员" })
      })

    // 加载目标用户，不存在返回 400
    const loadUser = (id: string) =>
      userSvc.getUser(id).pipe(
        Effect.mapError((e) => new InvalidRequestError({ message: (e as Error).message })),
      )

    return handlers
      .handle("admin.user.list", () =>
        Effect.gen(function* () {
          const users = yield* userSvc.listUsers()
          return { data: users.map(toResponse) }
        }),
      )
      .handle("admin.user.create", (req) =>
        Effect.gen(function* () {
          const { username, password, role } = req.payload
          // 先查重，避免唯一约束冲突
          const existing = yield* userSvc.getByUsername(username)
          if (existing) return yield* new ConflictError({ message: `用户名 "${username}" 已存在` })
          // createUser 内部校验白名单 + 密码强度，失败转 400
          const user = yield* userSvc.createUser({ username, password, role }).pipe(
            Effect.mapError((e) => new InvalidRequestError({ message: (e as Error).message })),
          )
          return toResponse(user)
        }),
      )
      .handle("admin.user.update", (req) =>
        Effect.gen(function* () {
          const { id } = req.params
          const { role, display_name } = req.payload
          const target = yield* loadUser(id)
          // 角色变更：自保护 + 最后一个 admin 防护
          if (role !== undefined && role !== target.role) {
            yield* assertNotSelf(id, "角色变更")
            if (target.role === "admin" && role === "user") {
              yield* assertNotLastAdmin(id)
            }
          }
          // yejian: updateUser 失败为普通 Error，映射为 endpoint 声明的 InvalidRequestError
          yield* userSvc.updateUser({ id, role, display_name }).pipe(
            Effect.mapError((e) => new InvalidRequestError({ message: (e as Error).message })),
          )
          const updated = yield* loadUser(id)
          return toResponse(updated)
        }),
      )
      .handle("admin.user.reset-password", (req) =>
        Effect.gen(function* () {
          const { id } = req.params
          const { newPassword } = req.payload
          yield* assertNotSelf(id, "重置密码（请用修改密码）")
          const target = yield* loadUser(id)
          // resetPassword 按 username 重置，强制下次改密
          yield* userSvc.resetPassword(target.username, newPassword).pipe(
            Effect.mapError((e) => new InvalidRequestError({ message: (e as Error).message })),
          )
          return { ok: true as const }
        }),
      )
      .handle("admin.user.disable", (req) =>
        Effect.gen(function* () {
          const { id } = req.params
          yield* assertNotSelf(id, "禁用")
          const target = yield* loadUser(id)
          if (target.role === "admin") yield* assertNotLastAdmin(id)
          yield* userSvc.setDisabled(id, true)
          // 联动撤销该用户所有 session，防止已登录的禁用用户继续操作
          yield* tokenSvc.revokeAllForUser(id)
          return { ok: true as const }
        }),
      )
      .handle("admin.user.enable", (req) =>
        Effect.gen(function* () {
          const { id } = req.params
          yield* userSvc.setDisabled(id, false)
          return { ok: true as const }
        }),
      )
      .handle("admin.user.sessions.revoke", (req) =>
        Effect.gen(function* () {
          const { id } = req.params
          yield* assertNotSelf(id, "踢下线")
          yield* tokenSvc.revokeAllForUser(id)
          return { ok: true as const }
        }),
      )
      .handle("admin.user.delete", (req) =>
        Effect.gen(function* () {
          const { id } = req.params
          yield* assertNotSelf(id, "删除")
          const target = yield* loadUser(id)
          if (target.role === "admin") yield* assertNotLastAdmin(id)
          yield* userSvc.deleteUser(id)
          return HttpApiSchema.NoContent.make()
        }),
      )
  }),
)
