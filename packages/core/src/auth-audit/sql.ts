import { integer, sqliteTable, text, index } from "drizzle-orm/sqlite-core"
import { Timestamps } from "../database/schema.sql"

/**
 * 登录审计表 — 记录登录成功 / 登出 / 登录失败 / 管理员踢下线 / 管理员禁用五类事件
 * - user_id 可空（登录失败且用户不存在时为空），无外键：删除用户不级联删日志
 * - username 为登录时刻快照，用户被删除后日志仍可读
 * - action: 'login' | 'logout' | 'login_failed' | 'kicked' | 'disabled'
 * - operator: 操作管理员用户名（kicked / disabled 时记录）
 */
export const AuthAuditTable = sqliteTable(
  "auth_audit",
  {
    id: text().primaryKey(),
    user_id: text(),
    username: text().notNull(),
    action: text().$type<"login" | "logout" | "login_failed" | "kicked" | "disabled">().notNull(),
    ip: text(),
    user_agent: text(),
    operator: text(),
    ...Timestamps,
  },
  (table) => [index("auth_audit_user_idx").on(table.user_id), index("auth_audit_time_idx").on(table.time_created)],
)
