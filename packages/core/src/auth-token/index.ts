// 自引用命名空间导出必须放在文件最顶部，避免模块体执行时 AuthToken binding 处于 TDZ
// （binary 编译模式与源码直跑模式都兼容，与上游 dev 分支 database.ts 模式一致）
export * as AuthToken from "./index"

import { and, eq, gt, isNull, lt } from "drizzle-orm"
import { Context, Effect, Layer } from "effect"
import { Database } from "../database/database"
import { SessionTokenTable } from "./sql"
import { UserTable } from "../user/sql"
import { randomBytes } from "crypto"
import { LayerNode } from "../effect/layer-node"

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

// yejian: 活跃用户信息（在线用户页用；ip/user_agent 是登录时刻记录的，extend 不更新）
export type ActiveUserInfo = {
  user_id: string
  username: string
  display_name: string | null
  role: string
  ip: string | null
  user_agent: string | null
  last_active_at: number
  session_count: number
}

interface AuthTokenServiceIface {
  create: (userId: string, userAgent?: string, ip?: string) => Effect.Effect<TokenInfo, never>
  verify: (token: string) => Effect.Effect<TokenInfo | null, never>
  extend: (token: string) => Effect.Effect<void, never>
  revoke: (token: string) => Effect.Effect<void, never>
  revokeAllForUser: (userId: string) => Effect.Effect<void, never>
  cleanupExpired: () => Effect.Effect<void, never>
  // yejian: 查询最近 activeWithinMs 内有请求活动的用户（按 user_id 聚合，返回每个用户的会话数与最近活跃时间）
  listActive: (activeWithinMs: number) => Effect.Effect<ActiveUserInfo[], never>
}

export class Service extends Context.Service<Service, AuthTokenServiceIface>()("@opencode/AuthTokenService") {}

// 上游 session/store.ts 模式：Layer.effect 在构建时捕获 db，各方法 R=never（类型与实现一致）
export const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const { db } = yield* Database.Service

    return Service.of({
      // 创建 token（登录成功后调用）
      create: Effect.fn("AuthToken.create")(function* (userId: string, userAgent?: string, ip?: string) {
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
      }),

      // 验证 token（中间件每请求调用）
      verify: Effect.fn("AuthToken.verify")(function* (token: string) {
        const now = Date.now()
        const row = yield* db
          .select()
          .from(SessionTokenTable)
          .where(and(eq(SessionTokenTable.id, token), isNull(SessionTokenTable.revoked_at), gt(SessionTokenTable.expires_at, now)))
          .get()
          .pipe(Effect.orDie)
        if (!row) return null
        return { token: row.id, userId: row.user_id, expiresAt: row.expires_at }
      }),

      // 惰性续期（5 分钟内不重复 UPDATE）
      extend: Effect.fn("AuthToken.extend")(function* (token: string) {
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
      }),

      // 撤销单个 token（登出）
      revoke: Effect.fn("AuthToken.revoke")(function* (token: string) {
        yield* db
          .update(SessionTokenTable)
          .set({ revoked_at: Date.now(), time_updated: Date.now() })
          .where(eq(SessionTokenTable.id, token))
          .run()
          .pipe(Effect.orDie)
      }),

      // 撤销某用户的所有 token（改密/踢人）
      revokeAllForUser: Effect.fn("AuthToken.revokeAllForUser")(function* (userId: string) {
        yield* db
          .update(SessionTokenTable)
          .set({ revoked_at: Date.now(), time_updated: Date.now() })
          .where(and(eq(SessionTokenTable.user_id, userId), isNull(SessionTokenTable.revoked_at)))
          .run()
          .pipe(Effect.orDie)
      }),

      // 清理过期 token（启动时调用）。yejian: 修正原 gt 为 lt——原写法会误删尚未过期的 token
      cleanupExpired: Effect.fn("AuthToken.cleanupExpired")(function* () {
        const now = Date.now()
        yield* db
          .delete(SessionTokenTable)
          .where(lt(SessionTokenTable.expires_at, now))
          .run()
          .pipe(Effect.orDie)
      }),

      // yejian: 查询最近 activeWithinMs 内活跃的用户（在线判定），按 user_id 聚合
      listActive: Effect.fn("AuthToken.listActive")(function* (activeWithinMs: number) {
        const now = Date.now()
        const rows = yield* db
          .select({
            user_id: SessionTokenTable.user_id,
            username: UserTable.username,
            display_name: UserTable.display_name,
            role: UserTable.role,
            ip: SessionTokenTable.ip,
            user_agent: SessionTokenTable.user_agent,
            last_extend_at: SessionTokenTable.last_extend_at,
          })
          .from(SessionTokenTable)
          .innerJoin(UserTable, eq(SessionTokenTable.user_id, UserTable.id))
          .where(
            and(
              isNull(SessionTokenTable.revoked_at),
              gt(SessionTokenTable.expires_at, now),
              gt(SessionTokenTable.last_extend_at, now - activeWithinMs),
            ),
          )
          .all()
          .pipe(Effect.orDie)

        // JS 侧按 user_id 聚合（活跃 token 行数少，无需 SQL GROUP BY）
        // last_active_at = MAX(last_extend_at)，ip/ua 取最近活跃 token 的值
        const byUser = new Map<string, ActiveUserInfo>()
        for (const row of rows) {
          const existing = byUser.get(row.user_id)
          if (!existing) {
            byUser.set(row.user_id, {
              user_id: row.user_id,
              username: row.username,
              display_name: row.display_name,
              role: row.role,
              ip: row.ip,
              user_agent: row.user_agent,
              last_active_at: row.last_extend_at,
              session_count: 1,
            })
            continue
          }
          existing.session_count++
          if (row.last_extend_at > existing.last_active_at) {
            existing.last_active_at = row.last_extend_at
            existing.ip = row.ip
            existing.user_agent = row.user_agent
          }
        }
        return Array.from(byUser.values())
      }),
    })
  }),
)

export const defaultLayer = layer.pipe(Layer.provide(Database.defaultLayer))

export const node = LayerNode.make(layer, [Database.node])
