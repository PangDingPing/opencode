import { and, eq, gt, isNull } from "drizzle-orm"
import { Context, Effect, Layer } from "effect"
import { Database } from "../database/database"
import { SessionTokenTable } from "./sql"
import { randomBytes } from "crypto"
import { makeGlobalNode } from "../effect/app-node"

const TOKEN_TTL_MS = 7 * 24 * 60 * 60 * 1000 // 7 天
const EXTEND_INTERVAL_MS = 5 * 60 * 1000 // 5 分钟惰性续期

// 生成 32 字节随机 token（hex 64 字符）
function generateToken(): string {
  return randomBytes(32).toString("hex")
}

export type TokenInfo = {
  token: string
  userId: string
  expiresAt: number
}

interface AuthTokenServiceIface {
  create: (userId: string, userAgent?: string, ip?: string) => Effect.Effect<TokenInfo>
  verify: (token: string) => Effect.Effect<TokenInfo | null>
  extend: (token: string) => Effect.Effect<void>
  revoke: (token: string) => Effect.Effect<void>
  revokeAllForUser: (userId: string) => Effect.Effect<void>
  cleanupExpired: () => Effect.Effect<void>
}

export class Service extends Context.Service<Service, AuthTokenServiceIface>()("@opencode/AuthTokenService") {}

// Layer.effect 闭包模式：先拿 db，Effect.fn 内部用闭包 db，requirement 不泄漏
const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const { db } = yield* Database.Service

    // 创建 token（登录成功后调用）
    const create = Effect.fn("AuthToken.create")(function* (userId: string, userAgent?: string, ip?: string) {
      const token = generateToken()
      const now = Date.now()
      yield* db
        .insert(SessionTokenTable)
        .values({
          id: token,
          user_id: userId,
          expires_at: now + TOKEN_TTL_MS,
          last_extend_at: now,
          revoked_at: null,
          time_created: now,
          time_updated: now,
          user_agent: userAgent,
          ip,
        })
        .run()
        .pipe(Effect.orDie)
      return { token, userId, expiresAt: now + TOKEN_TTL_MS }
    })

    // 验证 token（中间件每请求调用）
    const verify = Effect.fn("AuthToken.verify")(function* (token: string) {
      const now = Date.now()
      const row = yield* db
        .select()
        .from(SessionTokenTable)
        .where(and(eq(SessionTokenTable.id, token), isNull(SessionTokenTable.revoked_at), gt(SessionTokenTable.expires_at, now)))
        .get()
        .pipe(Effect.orDie)
      if (!row) return null
      return { token: row.id, userId: row.user_id, expiresAt: row.expires_at }
    })

    // 惰性续期（5 分钟内不重复 UPDATE）
    const extend = Effect.fn("AuthToken.extend")(function* (token: string) {
      const now = Date.now()
      const row = yield* db
        .select({ last_extend_at: SessionTokenTable.last_extend_at })
        .from(SessionTokenTable)
        .where(eq(SessionTokenTable.id, token))
        .get()
        .pipe(Effect.orDie)
      if (!row) return
      if (now - row.last_extend_at < EXTEND_INTERVAL_MS) return
      yield* db
        .update(SessionTokenTable)
        .set({ expires_at: now + TOKEN_TTL_MS, last_extend_at: now, time_updated: now })
        .where(eq(SessionTokenTable.id, token))
        .run()
        .pipe(Effect.orDie)
    })

    // 撤销单个 token（登出）
    const revoke = Effect.fn("AuthToken.revoke")(function* (token: string) {
      yield* db
        .update(SessionTokenTable)
        .set({ revoked_at: Date.now(), time_updated: Date.now() })
        .where(eq(SessionTokenTable.id, token))
        .run()
        .pipe(Effect.orDie)
    })

    // 撤销某用户的所有 token（改密/踢人）
    const revokeAllForUser = Effect.fn("AuthToken.revokeAllForUser")(function* (userId: string) {
      yield* db
        .update(SessionTokenTable)
        .set({ revoked_at: Date.now(), time_updated: Date.now() })
        .where(and(eq(SessionTokenTable.user_id, userId), isNull(SessionTokenTable.revoked_at)))
        .run()
        .pipe(Effect.orDie)
    })

    // 清理过期 token（启动时调用）
    const cleanupExpired = Effect.fn("AuthToken.cleanupExpired")(function* () {
      const now = Date.now()
      yield* db
        .delete(SessionTokenTable)
        .where(gt(SessionTokenTable.expires_at, now))
        .run()
        .pipe(Effect.orDie)
    })

    return Service.of({ create, verify, extend, revoke, revokeAllForUser, cleanupExpired })
  }),
)

export const defaultLayer = layer
export const node = makeGlobalNode({ service: Service, layer, deps: [Database.node] })

// 让 `import { AuthToken }` 后能用 AuthToken.Service / .defaultLayer / .node
export const AuthToken = { Service, defaultLayer, node }
