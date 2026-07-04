import { integer, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core"
import { Timestamps } from "../database/schema.sql"

// 用户 ID 品牌类型：定义在 schema 包，这里 re-export 保持单一来源
// UserID 既是值（Schema）也是类型（brand），单 export 即可同时导出两者
import { UserID } from "@opencode-ai/schema/user-id"
export { UserID }

// 用户角色
export type Role = "admin" | "user"

/**
 * 用户表 — 存储多用户系统的账号信息
 * - username 必须为实名，且在 allowed-names.txt 白名单内
 * - disabled=1 时禁止登录（verify 前先查此列）
 * - must_change_password=1 时首次登录强制改密
 */
export const UserTable = sqliteTable(
  "user",
  {
    id: text().$type<UserID>().primaryKey(),
    username: text().notNull().unique(),
    password_hash: text().notNull(),
    role: text().$type<Role>().notNull(),
    display_name: text(),
    disabled: integer().notNull().default(0),
    must_change_password: integer().notNull().default(0),
    ...Timestamps,
  },
  (table) => [uniqueIndex("user_username_idx").on(table.username)],
)
