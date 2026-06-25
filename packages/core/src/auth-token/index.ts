export * as AuthToken from "./index"

import { randomBytes } from "crypto"
import { and, eq, isNull, gt } from "drizzle-orm"
import { Context, Effect, Layer } from "effect"
import { Database } from "../database/database"
import { SessionTokenTable } from "./sql"

// token 有效期：7 天
const TOKEN_TTL_MS = 7 * 24 * 60 * 60 * 1000
// 惰性续期间隔：5 分钟内不重复 UPDATE
const EXTEND_INTERVAL_MS = 5 * 60 * 1000

export type TokenInfo = {
  token: string
  userId: string
  expiresAt: number
}

function generateToken(): string {
  return randomBytes(32).toString("base64url")
}

export class Service extends Context.Service<Service>()("@opencode/AuthTokenService") {
  // 创建 token（登录成功后调用）
  create = Effect.fn("AuthToken.create")(function* (userId: string, userAgent?: string, ip?: string) {
    const { db } = yield* Database.Service
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
  verify = Effect.fn("AuthToken.verify")(function* (token: string) {
    const { db } = yield* Database.Service
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
  extend = Effect.fn("AuthToken.extend")(function* (token: string) {
    const { db } = yield* Database.Service
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
  revoke = Effect.fn("AuthToken.revoke")(function* (token: string) {
    const { db } = yield* Database.Service
    yield* db
      .update(SessionTokenTable)
      .set({ revoked_at: Date.now(), time_updated: Date.now() })
      .where(eq(SessionTokenTable.id, token))
      .run()
      .pipe(Effect.orDie)
  })

  // 撤销某用户的所有 token（改密/踢人）
  revokeAllForUser = Effect.fn("AuthToken.revokeAllForUser")(function* (userId: string) {
    const { db } = yield* Database.Service
    yield* db
      .update(SessionTokenTable)
      .set({ revoked_at: Date.now(), time_updated: Date.now() })
      .where(and(eq(SessionTokenTable.user_id, userId), isNull(SessionTokenTable.revoked_at)))
      .run()
      .pipe(Effect.orDie)
  })

  // 清理过期 token（启动时调用）
  cleanupExpired = Effect.fn("AuthToken.cleanupExpired")(function* () {
    const { db } = yield* Database.Service
    const now = Date.now()
    yield* db
      .delete(SessionTokenTable)
      .where(gt(SessionTokenTable.expires_at, now))
      .run()
      .pipe(Effect.orDie)
  })
}

export const defaultLayer = Layer.effect(
  Service,
  Effect.gen(function* () {
    return yield* Service.make
  }),
).pipe(Layer.provide(Database.defaultLayer))
