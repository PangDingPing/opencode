// 自引用命名空间导出必须放在文件最顶部，避免模块体执行时 User binding 处于 TDZ
// （binary 编译模式与源码直跑模式都兼容，与上游 dev 分支 database.ts 模式一致）
export * as User from "./index"

import { eq } from "drizzle-orm"
import { Context, Effect, Layer } from "effect"
import { Database } from "../database/database"
import { UserTable, type Role } from "./sql"
import { loadAllowedNames } from "./allowed-names"
import { LayerNode } from "../effect/layer-node"
import { hashPassword, verifyPasswordHash, validatePassword } from "./password"

// 从独立模块 re-export，保持 `import { hashPassword } from "@opencode-ai/core/user"` 外部 API 不变
export { hashPassword, validatePassword } from "./password"

// 用户信息（不含密码 hash）
export type UserInfo = {
  id: string
  username: string
  role: Role
  display_name: string | null
  disabled: number
  must_change_password: number
  time_created: number
  time_updated: number
}

function toUserInfo(row: typeof UserTable.$inferSelect): UserInfo {
  return {
    id: row.id,
    username: row.username,
    role: row.role,
    display_name: row.display_name,
    disabled: row.disabled,
    must_change_password: row.must_change_password,
    time_created: row.time_created,
    time_updated: row.time_updated,
  }
}

interface UserServiceIface {
  createUser: (input: { username: string; password: string; role: Role; displayName?: string }) => Effect.Effect<UserInfo, Error>
  verifyPassword: (username: string, password: string) => Effect.Effect<UserInfo | null, never>
  getUser: (id: string) => Effect.Effect<UserInfo, Error>
  getByUsername: (username: string) => Effect.Effect<UserInfo | null, never>
  listUsers: () => Effect.Effect<UserInfo[], never>
  updateUser: (input: { id: string; role?: Role; display_name?: string | null }) => Effect.Effect<void, Error>
  changePassword: (userId: string, newPassword: string) => Effect.Effect<void, Error>
  resetPassword: (username: string, newPassword: string) => Effect.Effect<void, Error>
  setDisabled: (userId: string, disabled: boolean) => Effect.Effect<void, never>
  deleteUser: (userId: string) => Effect.Effect<void, never>
  getAllowedNames: () => Effect.Effect<string[], never>
}

// Effect 4 beta class-style：class Service extends Context.Service<Service, Interface>()("Key") {}
export class Service extends Context.Service<Service, UserServiceIface>()("@opencode/UserService") {}

// 上游 session/store.ts 模式：Layer.effect 在构建时捕获 db，各方法 R=never（类型与实现一致）
export const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const { db } = yield* Database.Service

    return Service.of({
      // 创建用户（admin 操作，username 可自定义，不受白名单限制）
      createUser: Effect.fn("User.createUser")(function* (input: { username: string; password: string; role: Role; displayName?: string }) {
        if (!validatePassword(input.password)) {
          return yield* Effect.fail(new Error("密码至少 8 位且必须包含字母和数字"))
        }
        const id = "usr_" + input.username
        const passwordHash = yield* Effect.promise(() => hashPassword(input.password))
        const now = Date.now()
        yield* db
          .insert(UserTable)
          .values({
            id,
            username: input.username,
            password_hash: passwordHash,
            role: input.role,
            display_name: input.username,
            disabled: 0,
            must_change_password: 1,
            time_created: now,
            time_updated: now,
          })
          .run()
          .pipe(Effect.orDie)
        const row = yield* db
          .select()
          .from(UserTable)
          .where(eq(UserTable.id, id))
          .get()
          .pipe(Effect.orDie)
        return toUserInfo(row!)
      }),

      // 验证密码（登录用）
      verifyPassword: Effect.fn("User.verifyPassword")(function* (username: string, password: string) {
        const row = yield* db
          .select()
          .from(UserTable)
          .where(eq(UserTable.username, username))
          .get()
          .pipe(Effect.orDie)
        if (!row) return null
        if (row.disabled === 1) return null
        const valid = yield* Effect.promise(() => verifyPasswordHash(row.password_hash, password))
        if (!valid) return null
        return toUserInfo(row)
      }),

      // 获取用户
      getUser: Effect.fn("User.getUser")(function* (id: string) {
        const row = yield* db
          .select()
          .from(UserTable)
          .where(eq(UserTable.id, id))
          .get()
          .pipe(Effect.orDie)
        if (!row) return yield* Effect.fail(new Error(`用户 ${id} 不存在`))
        return toUserInfo(row)
      }),

      // 按 username 获取
      getByUsername: Effect.fn("User.getByUsername")(function* (username: string) {
        const row = yield* db
          .select()
          .from(UserTable)
          .where(eq(UserTable.username, username))
          .get()
          .pipe(Effect.orDie)
        return row ? toUserInfo(row) : null
      }),

      // 列出所有用户
      listUsers: Effect.fn("User.listUsers")(function* () {
        const rows = yield* db.select().from(UserTable).all().pipe(Effect.orDie)
        return rows.map(toUserInfo)
      }),

      // 修改用户（admin 操作：role / display_name）
      updateUser: Effect.fn("User.updateUser")(function* (input: { id: string; role?: Role; display_name?: string | null }) {
        const set: { role?: Role; display_name?: string | null; time_updated: number } = { time_updated: Date.now() }
        if (input.role !== undefined) set.role = input.role
        if (input.display_name !== undefined) set.display_name = input.display_name
        yield* db.update(UserTable).set(set).where(eq(UserTable.id, input.id)).run().pipe(Effect.orDie)
      }),

      // 改密码（用户自己改）
      changePassword: Effect.fn("User.changePassword")(function* (id: string, newPassword: string) {
        if (!validatePassword(newPassword)) {
          return yield* Effect.fail(new Error("密码至少 8 位且必须包含字母和数字"))
        }
        const passwordHash = yield* Effect.promise(() => hashPassword(newPassword))
        yield* db
          .update(UserTable)
          .set({ password_hash: passwordHash, must_change_password: 0, time_updated: Date.now() })
          .where(eq(UserTable.id, id))
          .run()
          .pipe(Effect.orDie)
      }),

      // admin 重置密码（强制下次改密）
      resetPassword: Effect.fn("User.resetPassword")(function* (username: string, newPassword: string) {
        if (!validatePassword(newPassword)) {
          return yield* Effect.fail(new Error("密码至少 8 位且必须包含字母和数字"))
        }
        const passwordHash = yield* Effect.promise(() => hashPassword(newPassword))
        yield* db
          .update(UserTable)
          .set({ password_hash: passwordHash, must_change_password: 1, time_updated: Date.now() })
          .where(eq(UserTable.username, username))
          .run()
          .pipe(Effect.orDie)
      }),

      // 禁用/启用用户
      setDisabled: Effect.fn("User.setDisabled")(function* (id: string, disabled: boolean) {
        yield* db
          .update(UserTable)
          .set({ disabled: disabled ? 1 : 0, time_updated: Date.now() })
          .where(eq(UserTable.id, id))
          .run()
          .pipe(Effect.orDie)
      }),

      // 删除用户
      deleteUser: Effect.fn("User.deleteUser")(function* (id: string) {
        yield* db.delete(UserTable).where(eq(UserTable.id, id)).run().pipe(Effect.orDie)
      }),

      // 获取白名单
      getAllowedNames: Effect.fn("User.getAllowedNames")(function* () {
        return loadAllowedNames()
      }),
    })
  }),
)

export const defaultLayer = layer.pipe(Layer.provide(Database.defaultLayer))

export const node = LayerNode.make(layer, [Database.node])
