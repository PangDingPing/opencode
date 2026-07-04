import { hash, verify } from "@node-rs/argon2"
import { and, eq } from "drizzle-orm"
import { Context, Effect, Layer } from "effect"
import { Database } from "../database/database"
import { UserTable, type Role, UserID } from "./sql"
export { UserID }
import { loadAllowedNames } from "./allowed-names"
import { makeGlobalNode } from "../effect/app-node"

// argon2id 参数（OWASP 2024 推荐）
const ARGON2_OPTIONS = {
  memoryCost: 19456,
  timeCost: 2,
  parallelism: 1,
} as const

// 密码强度校验：至少 8 位 + 含字母 + 含数字
export function validatePassword(pwd: string): boolean {
  return pwd.length >= 8 && /[a-zA-Z]/.test(pwd) && /[0-9]/.test(pwd)
}

// 用户信息（不含密码 hash）
export type UserInfo = {
  id: UserID
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
  verifyPassword: (username: string, password: string) => Effect.Effect<UserInfo | null>
  getUser: (id: UserID) => Effect.Effect<UserInfo, Error>
  getByUsername: (username: string) => Effect.Effect<UserInfo | null>
  listUsers: () => Effect.Effect<UserInfo[]>
  updateUser: (input: { id: UserID; role?: Role; display_name?: string | null }) => Effect.Effect<void, Error>
  changePassword: (userId: UserID, newPassword: string) => Effect.Effect<void, Error>
  resetPassword: (username: string, newPassword: string) => Effect.Effect<void, Error>
  setDisabled: (userId: UserID, disabled: boolean) => Effect.Effect<void>
  deleteUser: (userId: UserID) => Effect.Effect<void>
  getAllowedNames: () => Effect.Effect<string[]>
}

// Effect 4 beta class-style：class Service extends Context.Service<Service, Interface>()("Key") {}
export class Service extends Context.Service<Service, UserServiceIface>()("@opencode/UserService") {}

// Layer.effect 闭包模式：先拿 db，Effect.fn 内部用闭包 db，requirement 不泄漏
const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const { db } = yield* Database.Service

    // 创建用户（admin 操作，username 可自定义，不受白名单限制）
    const createUser = Effect.fn("User.createUser")(function* (input: { username: string; password: string; role: Role; displayName?: string }) {
      if (!validatePassword(input.password)) {
        return yield* Effect.fail(new Error("密码至少 8 位且必须包含字母和数字"))
      }
      const id = UserID.make("usr_" + input.username)
      const passwordHash = yield* Effect.promise(() => hash(input.password, ARGON2_OPTIONS))
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
    })

    // 验证密码（登录用）
    const verifyPassword = Effect.fn("User.verifyPassword")(function* (username: string, password: string) {
      const row = yield* db
        .select()
        .from(UserTable)
        .where(eq(UserTable.username, username))
        .get()
        .pipe(Effect.orDie)
      if (!row) return null
      if (row.disabled === 1) return null
      const valid = yield* Effect.promise(() => verify(row.password_hash, password))
      if (!valid) return null
      return toUserInfo(row)
    })

    // 获取用户
    const getUser = Effect.fn("User.getUser")(function* (id: UserID) {
      const row = yield* db
        .select()
        .from(UserTable)
        .where(eq(UserTable.id, id))
        .get()
        .pipe(Effect.orDie)
      if (!row) return yield* Effect.fail(new Error(`用户 ${id} 不存在`))
      return toUserInfo(row)
    })

    // 按 username 获取
    const getByUsername = Effect.fn("User.getByUsername")(function* (username: string) {
      const row = yield* db
        .select()
        .from(UserTable)
        .where(eq(UserTable.username, username))
        .get()
        .pipe(Effect.orDie)
      return row ? toUserInfo(row) : null
    })

    // 列出所有用户
    const listUsers = Effect.fn("User.listUsers")(function* () {
      const rows = yield* db.select().from(UserTable).all().pipe(Effect.orDie)
      return rows.map(toUserInfo)
    })

    // 修改用户（admin 操作：role / display_name）
    const updateUser = Effect.fn("User.updateUser")(function* (input: { id: UserID; role?: Role; display_name?: string | null }) {
      const set: { role?: Role; display_name?: string | null; time_updated: number } = { time_updated: Date.now() }
      if (input.role !== undefined) set.role = input.role
      if (input.display_name !== undefined) set.display_name = input.display_name
      yield* db.update(UserTable).set(set).where(eq(UserTable.id, input.id)).run().pipe(Effect.orDie)
    })

    // 改密码（用户自己改）
    const changePassword = Effect.fn("User.changePassword")(function* (id: UserID, newPassword: string) {
      if (!validatePassword(newPassword)) {
        return yield* Effect.fail(new Error("密码至少 8 位且必须包含字母和数字"))
      }
      const passwordHash = yield* Effect.promise(() => hash(newPassword, ARGON2_OPTIONS))
      yield* db
        .update(UserTable)
        .set({ password_hash: passwordHash, must_change_password: 0, time_updated: Date.now() })
        .where(eq(UserTable.id, id))
        .run()
        .pipe(Effect.orDie)
    })

    // admin 重置密码（强制下次改密）
    const resetPassword = Effect.fn("User.resetPassword")(function* (username: string, newPassword: string) {
      if (!validatePassword(newPassword)) {
        return yield* Effect.fail(new Error("密码至少 8 位且必须包含字母和数字"))
      }
      const passwordHash = yield* Effect.promise(() => hash(newPassword, ARGON2_OPTIONS))
      yield* db
        .update(UserTable)
        .set({ password_hash: passwordHash, must_change_password: 1, time_updated: Date.now() })
        .where(eq(UserTable.username, username))
        .run()
        .pipe(Effect.orDie)
    })

    // 禁用/启用用户
    const setDisabled = Effect.fn("User.setDisabled")(function* (id: UserID, disabled: boolean) {
      yield* db
        .update(UserTable)
        .set({ disabled: disabled ? 1 : 0, time_updated: Date.now() })
        .where(eq(UserTable.id, id))
        .run()
        .pipe(Effect.orDie)
    })

    // 删除用户
    const deleteUser = Effect.fn("User.deleteUser")(function* (id: UserID) {
      yield* db.delete(UserTable).where(eq(UserTable.id, id)).run().pipe(Effect.orDie)
    })

    // 获取白名单
    const getAllowedNames = Effect.fn("User.getAllowedNames")(function* () {
      return loadAllowedNames()
    })

    return Service.of({
      createUser,
      verifyPassword,
      getUser,
      getByUsername,
      listUsers,
      updateUser,
      changePassword,
      resetPassword,
      setDisabled,
      deleteUser,
      getAllowedNames,
    })
  }),
)

export const defaultLayer = layer
export const node = makeGlobalNode({ service: Service, layer, deps: [Database.node] })

// 让 `import { User }` 后能用 User.Service / .defaultLayer / .node
export const User = { Service, defaultLayer, node }
