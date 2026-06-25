import { hash, verify } from "@node-rs/argon2"
import { and, eq } from "drizzle-orm"
import { Context, Effect, Layer, Schema } from "effect"
import { Database } from "../database/database"
import { UserTable, type Role } from "./sql"
import { isAllowedName, loadAllowedNames } from "./allowed-names"
import { LayerNode } from "../effect/layer-node"

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
  changePassword: (userId: string, newPassword: string) => Effect.Effect<void, Error>
  resetPassword: (username: string, newPassword: string) => Effect.Effect<void, Error>
  setDisabled: (userId: string, disabled: boolean) => Effect.Effect<void, never>
  getAllowedNames: () => Effect.Effect<string[], never>
}

// Effect 4 beta class-style：class Service extends Context.Service<Service, Interface>()("Key") {}
export class Service extends Context.Service<Service, UserServiceIface>()("@opencode/UserService") {}

function makeService(): UserServiceIface {
  // 创建用户（admin 操作，username 必须在白名单内）
  const createUser = Effect.fn("User.createUser")(function* (input: { username: string; password: string; role: Role; displayName?: string }) {
    if (!isAllowedName(input.username) && input.role !== "admin") {
      return yield* Effect.fail(new Error(`用户名 "${input.username}" 不在白名单内`))
    }
    if (!validatePassword(input.password)) {
      return yield* Effect.fail(new Error("密码至少 8 位且必须包含字母和数字"))
    }
    const { db } = yield* Database.Service
    const id = "usr_" + input.username
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
    const { db } = yield* Database.Service
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
  const getUser = Effect.fn("User.getUser")(function* (id: string) {
    const { db } = yield* Database.Service
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
    const { db } = yield* Database.Service
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
    const { db } = yield* Database.Service
    const rows = yield* db.select().from(UserTable).all().pipe(Effect.orDie)
    return rows.map(toUserInfo)
  })

  // 改密码（用户自己改）
  const changePassword = Effect.fn("User.changePassword")(function* (id: string, newPassword: string) {
    if (!validatePassword(newPassword)) {
      return yield* Effect.fail(new Error("密码至少 8 位且必须包含字母和数字"))
    }
    const { db } = yield* Database.Service
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
    const { db } = yield* Database.Service
    const passwordHash = yield* Effect.promise(() => hash(newPassword, ARGON2_OPTIONS))
    yield* db
      .update(UserTable)
      .set({ password_hash: passwordHash, must_change_password: 1, time_updated: Date.now() })
      .where(eq(UserTable.username, username))
      .run()
      .pipe(Effect.orDie)
  })

  // 禁用/启用用户
  const setDisabled = Effect.fn("User.setDisabled")(function* (id: string, disabled: boolean) {
    const { db } = yield* Database.Service
    yield* db
      .update(UserTable)
      .set({ disabled: disabled ? 1 : 0, time_updated: Date.now() })
      .where(eq(UserTable.id, id))
      .run()
      .pipe(Effect.orDie)
  })

  // 获取白名单
  const getAllowedNames = Effect.fn("User.getAllowedNames")(function* () {
    return loadAllowedNames()
  })

  return {
    createUser,
    verifyPassword,
    getUser,
    getByUsername,
    listUsers,
    changePassword,
    resetPassword,
    setDisabled,
    getAllowedNames,
  }
}

export const defaultLayer = Layer.succeed(
  Service,
  makeService(),
)

export const node = LayerNode.make(defaultLayer, [Database.node])

// 让 `import { User }` 后能用 User.Service / .defaultLayer / .node
export const User = { Service, defaultLayer, node }
