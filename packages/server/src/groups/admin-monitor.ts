import { Schema } from "effect"
import { HttpApiEndpoint, HttpApiGroup, OpenApi } from "effect/unstable/httpapi"
import { ForbiddenError } from "../errors"
import { RequireAdmin } from "../middleware/require-admin"

// 在线用户信息（token 的 ip/user_agent 是登录时刻记录的，extend 不更新）
const OnlineUserSchema = Schema.Struct({
  user_id: Schema.String,
  username: Schema.String,
  display_name: Schema.NullOr(Schema.String),
  role: Schema.String,
  ip: Schema.NullOr(Schema.String),
  user_agent: Schema.NullOr(Schema.String),
  last_active_at: Schema.Number,
  session_count: Schema.Number,
})

const OnlineListResponse = Schema.Struct({ data: Schema.Array(OnlineUserSchema) })

// 登录审计查询参数（GET query：URL 参数均为字符串，数字用 NumberFromString 解码）
const AuthLogQuery = Schema.Struct({
  username: Schema.String.pipe(Schema.optional),
  action: Schema.String.pipe(Schema.optional),
  limit: Schema.NumberFromString.pipe(Schema.optional),
  offset: Schema.NumberFromString.pipe(Schema.optional),
})

// 审计记录
const AuthAuditEntrySchema = Schema.Struct({
  id: Schema.String,
  user_id: Schema.NullOr(Schema.String),
  username: Schema.String,
  action: Schema.String,
  ip: Schema.NullOr(Schema.String),
  user_agent: Schema.NullOr(Schema.String),
  operator: Schema.NullOr(Schema.String),
  time_created: Schema.Number,
})

const AuthLogListResponse = Schema.Struct({
  data: Schema.Array(AuthAuditEntrySchema),
  total: Schema.Number,
})

// Admin 监控路由组（在线用户 + 登录审计），独立成组不动现有 groups/admin.ts
export const AdminMonitorGroup = HttpApiGroup.make("server.admin.monitor")
  .add(
    HttpApiEndpoint.get("admin.online.list", "/api/admin/online", {
      success: OnlineListResponse,
      error: [ForbiddenError],
    })
      .middleware(RequireAdmin)
      .annotateMerge(
        OpenApi.annotations({
          identifier: "v2.admin.online.list",
          summary: "查看在线用户",
          description: "admin 查看最近 15 分钟内有请求活动的用户（基于 session token 活跃时间判定）",
        }),
      ),
  )
  .add(
    HttpApiEndpoint.get("admin.authlog.list", "/api/admin/auth-logs", {
      query: AuthLogQuery,
      success: AuthLogListResponse,
      error: [ForbiddenError],
    })
      .middleware(RequireAdmin)
      .annotateMerge(
        OpenApi.annotations({
          identifier: "v2.admin.authlog.list",
          summary: "查询登录审计日志",
          description: "admin 分页查询登录成功/登出/登录失败/踢下线/禁用五类审计事件",
        }),
      ),
  )
  .annotateMerge(OpenApi.annotations({ title: "admin-monitor", description: "Admin 监控路由（在线用户 + 登录审计）" }))
