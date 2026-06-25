import { Schema } from "effect"
import { HttpApiEndpoint, HttpApiGroup, OpenApi } from "effect/unstable/httpapi"
import { UnauthorizedError, InvalidRequestError } from "../errors"

// 登录请求
const LoginRequest = Schema.Struct({
  username: Schema.String,
  password: Schema.String,
})

// 用户信息响应
const UserResponse = Schema.Struct({
  id: Schema.String,
  username: Schema.String,
  role: Schema.Union([Schema.Literal("admin"), Schema.Literal("user")]),
  display_name: Schema.String.pipe(Schema.optional),
  must_change_password: Schema.Boolean,
})

// 改密请求
const ChangePasswordRequest = Schema.Struct({
  oldPassword: Schema.String,
  newPassword: Schema.String,
})

// 登录响应
const LoginResponse = Schema.Struct({
  user: UserResponse,
})

// 白名单响应
const AllowedNamesResponse = Schema.Struct({
  names: Schema.Array(Schema.String),
})

export const AuthGroup = HttpApiGroup.make("server.auth")
  .add(
    HttpApiEndpoint.post("auth.login", "/api/auth/login", {
      payload: LoginRequest,
      success: LoginResponse,
      error: [UnauthorizedError, InvalidRequestError],
    }).annotateMerge(
      OpenApi.annotations({
        identifier: "v2.auth.login",
        summary: "登录",
        description: "用户名密码登录，成功后设置 oc_session cookie",
      }),
    ),
  )
  .add(
    HttpApiEndpoint.post("auth.logout", "/api/auth/logout", {
      success: Schema.Struct({ ok: Schema.Literal(true) }),
      error: [UnauthorizedError],
    }).annotateMerge(
      OpenApi.annotations({
        identifier: "v2.auth.logout",
        summary: "登出",
        description: "撤销当前 session token，清除 cookie",
      }),
    ),
  )
  .add(
    HttpApiEndpoint.get("auth.me", "/api/auth/me", {
      success: UserResponse,
      error: [UnauthorizedError],
    }).annotateMerge(
      OpenApi.annotations({
        identifier: "v2.auth.me",
        summary: "获取当前用户",
        description: "返回当前登录用户信息",
      }),
    ),
  )
  .add(
    HttpApiEndpoint.post("auth.change-password", "/api/auth/change-password", {
      payload: ChangePasswordRequest,
      success: Schema.Struct({ ok: Schema.Literal(true) }),
      error: [UnauthorizedError, InvalidRequestError],
    }).annotateMerge(
      OpenApi.annotations({
        identifier: "v2.auth.change-password",
        summary: "修改密码",
        description: "修改当前用户密码，改密后撤销其他 session",
      }),
    ),
  )
  .add(
    HttpApiEndpoint.get("auth.allowed-names", "/api/auth/allowed-names", {
      success: AllowedNamesResponse,
      error: [UnauthorizedError],
    }).annotateMerge(
      OpenApi.annotations({
        identifier: "v2.auth.allowed-names",
        summary: "获取实名白名单",
        description: "返回 allowed-names.txt 中的实名列表（admin 创建用户时下拉选）",
      }),
    ),
  )
