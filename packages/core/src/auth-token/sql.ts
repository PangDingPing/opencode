import { integer, sqliteTable, text, index } from "drizzle-orm/sqlite-core"
import { UserTable } from "../user/sql"
import { Timestamps } from "../database/schema.sql"

/**
 * 会话令牌表 — 存储 DB session token（HttpOnly cookie 对应的 DB 记录）
 * - id 就是 token 本身（32 字节随机 base64url）
 * - revoked_at 非空时表示已撤销（admin 踢人 / 改密踢出其他设备）
 * - last_extend_at 用于惰性续期（5 分钟内不重复 UPDATE）
 */
export const SessionTokenTable = sqliteTable(
  "session_token",
  {
    id: text().primaryKey(),
    user_id: text()
      .notNull()
      .references(() => UserTable.id, { onDelete: "cascade" }),
    expires_at: integer().notNull(),
    last_extend_at: integer().notNull(),
    revoked_at: integer(),
    ...Timestamps,
    user_agent: text(),
    ip: text(),
  },
  (table) => [index("session_token_user_idx").on(table.user_id)],
)
