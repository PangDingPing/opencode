import { Effect } from "effect"
import { HttpApiBuilder } from "effect/unstable/httpapi"
import { Api } from "../api"
import { AuthToken } from "@opencode-ai/core/auth-token"
import { AuthAudit } from "@opencode-ai/core/auth-audit"

// 在线判定窗口：最近 15 分钟内有请求活动（基于 token last_extend_at 惰性续期机制）
const ACTIVE_WINDOW_MS = 15 * 60 * 1000

// Admin 监控 handler：在线用户列表 + 登录审计日志查询
export const AdminMonitorHandler = HttpApiBuilder.group(Api, "server.admin.monitor", (handlers) =>
  Effect.gen(function* () {
    const tokenSvc = yield* AuthToken.Service
    const auditSvc = yield* AuthAudit.Service

    return handlers
      .handle("admin.online.list", () =>
        Effect.gen(function* () {
          const data = yield* tokenSvc.listActive(ACTIVE_WINDOW_MS)
          return { data }
        }),
      )
      .handle("admin.authlog.list", (ctx) =>
        Effect.gen(function* () {
          return yield* auditSvc.list(ctx.query)
        }),
      )
  }),
)
