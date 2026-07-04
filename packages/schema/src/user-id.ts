import { Schema } from "effect"

// 用户 ID 品牌类型（多用户系统）
// 定义在 schema 包供 Session.Info 等跨包 schema 引用；
// core/src/user/sql.ts re-export 此类型保持单一来源
export const UserID = Schema.String.pipe(Schema.brand("UserID"))
export type UserID = typeof UserID.Type
