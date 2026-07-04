import { Schema } from "effect"
import { HttpApiEndpoint, HttpApiGroup, HttpApiSchema, OpenApi } from "effect/unstable/httpapi"
import { ForbiddenError, InvalidRequestError, ConflictError } from "../errors"
import { RequireAdmin } from "../middleware/require-admin"

// 用户角色
const Role = Schema.Union([Schema.Literal("admin"), Schema.Literal("user")])

// 用户信息（admin 视图，含完整字段）
const UserInfoSchema = Schema.Struct({
  id: Schema.String,
  username: Schema.String,
  role: Role,
  display_name: Schema.NullOr(Schema.String),
  disabled: Schema.Boolean,
  must_change_password: Schema.Boolean,
  time_created: Schema.Number,
  time_updated: Schema.Number,
})

// 创建用户请求
const CreateUserRequest = Schema.Struct({
  username: Schema.String,
  password: Schema.String,
  role: Role,
})

// 更新用户请求（role / display_name 均可选；display_name 传 null 表示清空）
const UpdateUserRequest = Schema.Struct({
  role: Role.pipe(Schema.optional),
  display_name: Schema.NullOr(Schema.String).pipe(Schema.optional),
})

// 重置密码请求
const ResetPasswordRequest = Schema.Struct({
  newPassword: Schema.String,
})

// 通用 ok 响应
const OkResponse = Schema.Struct({ ok: Schema.Literal(true) })

// 列表响应
const ListUsersResponse = Schema.Struct({ data: Schema.Array(UserInfoSchema) })

export const AdminGroup = HttpApiGroup.make("server.admin")
  .add(
    HttpApiEndpoint.get("admin.user.list", "/api/admin/users", {
      success: ListUsersResponse,
      error: [ForbiddenError],
    })
      .middleware(RequireAdmin)
      .annotateMerge(
        OpenApi.annotations({
          identifier: "v2.admin.user.list",
          summary: "列出所有用户",
          description: "admin 列出全部用户（含禁用、强制改密状态）",
        }),
      ),
  )
  .add(
    HttpApiEndpoint.post("admin.user.create", "/api/admin/users", {
      payload: CreateUserRequest,
      success: UserInfoSchema,
      error: [ForbiddenError, InvalidRequestError, ConflictError],
    })
      .middleware(RequireAdmin)
      .annotateMerge(
        OpenApi.annotations({
          identifier: "v2.admin.user.create",
          summary: "创建用户",
          description: "admin 创建新用户，username 必须在白名单内",
        }),
      ),
  )
  .add(
    HttpApiEndpoint.patch("admin.user.update", "/api/admin/users/:id", {
      params: { id: Schema.String },
      payload: UpdateUserRequest,
      success: UserInfoSchema,
      error: [ForbiddenError, InvalidRequestError, ConflictError],
    })
      .middleware(RequireAdmin)
      .annotateMerge(
        OpenApi.annotations({
          identifier: "v2.admin.user.update",
          summary: "修改用户",
          description: "admin 修改用户角色或显示名；不能降级自己；不能降级最后一个 admin",
        }),
      ),
  )
  .add(
    HttpApiEndpoint.post("admin.user.reset-password", "/api/admin/users/:id/reset-password", {
      params: { id: Schema.String },
      payload: ResetPasswordRequest,
      success: OkResponse,
      error: [ForbiddenError, InvalidRequestError],
    })
      .middleware(RequireAdmin)
      .annotateMerge(
        OpenApi.annotations({
          identifier: "v2.admin.user.reset-password",
          summary: "重置用户密码",
          description: "admin 重置某用户密码，强制该用户下次登录改密；不能重置自己密码",
        }),
      ),
  )
  .add(
    HttpApiEndpoint.post("admin.user.disable", "/api/admin/users/:id/disable", {
      params: { id: Schema.String },
      success: OkResponse,
      error: [ForbiddenError, ConflictError],
    })
      .middleware(RequireAdmin)
      .annotateMerge(
        OpenApi.annotations({
          identifier: "v2.admin.user.disable",
          summary: "禁用用户",
          description: "admin 禁用某用户并撤销其所有登录 session；不能禁用自己；不能禁用最后一个 admin",
        }),
      ),
  )
  .add(
    HttpApiEndpoint.post("admin.user.enable", "/api/admin/users/:id/enable", {
      params: { id: Schema.String },
      success: OkResponse,
      error: [ForbiddenError],
    })
      .middleware(RequireAdmin)
      .annotateMerge(
        OpenApi.annotations({
          identifier: "v2.admin.user.enable",
          summary: "启用用户",
          description: "admin 启用某用户",
        }),
      ),
  )
  .add(
    HttpApiEndpoint.post("admin.user.sessions.revoke", "/api/admin/users/:id/sessions/revoke", {
      params: { id: Schema.String },
      success: OkResponse,
      error: [ForbiddenError],
    })
      .middleware(RequireAdmin)
      .annotateMerge(
        OpenApi.annotations({
          identifier: "v2.admin.user.sessions.revoke",
          summary: "踢用户下线",
          description: "撤销某用户所有登录 session，强制其重新登录；不能踢自己",
        }),
      ),
  )
  .add(
    HttpApiEndpoint.delete("admin.user.delete", "/api/admin/users/:id", {
      params: { id: Schema.String },
      success: HttpApiSchema.NoContent,
      error: [ForbiddenError, ConflictError],
    })
      .middleware(RequireAdmin)
      .annotateMerge(
        OpenApi.annotations({
          identifier: "v2.admin.user.delete",
          summary: "删除用户",
          description: "admin 删除某用户；不能删除自己；不能删除最后一个 admin",
        }),
      ),
  )
  .annotateMerge(OpenApi.annotations({ title: "admin", description: "Admin 用户管理路由" }))
