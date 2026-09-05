import { SessionV2 } from "@opencode-ai/core/session"
import { UserID } from "@opencode-ai/core/user/sql"
import { DateTime, Effect } from "effect"
import { HttpApiBuilder, HttpApiSchema } from "effect/unstable/httpapi"
import { Api } from "../api"
import { SessionsCursor } from "../groups/session"
import {
  ConflictError,
  InvalidCursorError,
  ServiceUnavailableError,
  SessionNotFoundError,
  UnknownError,
} from "../errors"
import { AbsolutePath } from "@opencode-ai/core/schema"
import { CurrentUser } from "../middleware/auth"
import { mkdir } from "node:fs/promises"
import path from "path"

const DefaultSessionsLimit = 50

// yejian: V2 端点归属校验。非 admin 用户只能操作自己会话；
// 与 session.get 的检查语义一致（admin 放行，user_id 不匹配 → 404，避免泄露会话存在性）。
function assertSessionOwnership(sessionID: SessionV2.ID) {
  return Effect.gen(function* () {
    const session = yield* SessionV2.Service
    const user = yield* CurrentUser
    const info = yield* session.get(sessionID).pipe(
      Effect.catchTag(
        "Session.NotFoundError",
        (error) =>
          new SessionNotFoundError({
            sessionID: error.sessionID,
            message: `Session not found: ${error.sessionID}`,
          }),
      ),
    )
    if (user.role !== "admin" && info.userID !== user.id) {
      return yield* new SessionNotFoundError({ sessionID, message: "Session not found" })
    }
    return info
  })
}

export const SessionHandler = HttpApiBuilder.group(Api, "server.session", (handlers) =>
  Effect.gen(function* () {
    const session = yield* SessionV2.Service

    return handlers
      .handle(
        "session.list",
        Effect.fn(function* (ctx) {
          const user = yield* CurrentUser
          const query =
            ctx.query.cursor !== undefined
              ? yield* SessionsCursor.parse(ctx.query.cursor).pipe(
                  Effect.mapError(() => new InvalidCursorError({ message: "Invalid cursor" })),
                )
              : ctx.query
          // 普通用户只能看自己的 session，admin 看全部
          const userID = user.role === "admin" ? undefined : UserID.make(user.id)
          const sessions = yield* session.list({
            ...query,
            workspaceID: query.workspace,
            limit: ctx.query.limit ?? DefaultSessionsLimit,
            ...(userID ? { userID } : {}),
          })
          const first = sessions[0]
          const last = sessions.at(-1)
          return {
            data: sessions,
            cursor: {
              previous: first
                ? SessionsCursor.make({
                    ...query,
                    anchor: {
                      id: first.id,
                      time: DateTime.toEpochMillis(first.time.created),
                      direction: "previous",
                    },
                  })
                : undefined,
              next: last
                ? SessionsCursor.make({
                    ...query,
                    anchor: {
                      id: last.id,
                      time: DateTime.toEpochMillis(last.time.created),
                      direction: "next",
                    },
                  })
                : undefined,
            },
          }
        }),
      )
      .handle(
        "session.create",
        Effect.fn(function* (ctx) {
          const user = yield* CurrentUser
          // 未指定 location 时，按实名设工作目录（如 /workspace/上官兵/）
          const directory =
            ctx.payload.location?.directory ?? AbsolutePath.make(path.join(process.cwd(), user.username))
          // 确保用户工作目录存在
          yield* Effect.promise(() => mkdir(path.join(process.cwd(), user.username), { recursive: true }))
          return {
            data: yield* session.create({
              id: ctx.payload.id,
              agent: ctx.payload.agent,
              model: ctx.payload.model,
              location: ctx.payload.location ?? { directory },
              userID: UserID.make(user.id),
            }),
          }
        }),
      )
      .handle(
        "session.get",
        Effect.fn(function* (ctx) {
          const user = yield* CurrentUser
          // yejian: 原 `const session = ...` 遮蔽外层 SessionV2.Service 且初始化时自引用（TDZ），
          // 调用 session.get 接口会抛 ReferenceError，改名修复
          const info = yield* session.get(ctx.params.sessionID).pipe(
            Effect.catchTag(
              "Session.NotFoundError",
              (error) =>
                new SessionNotFoundError({
                  sessionID: error.sessionID,
                  message: `Session not found: ${error.sessionID}`,
                }),
            ),
          )
          if (user.role !== "admin" && info.userID !== user.id) {
            return yield* new SessionNotFoundError({
              sessionID: ctx.params.sessionID,
              message: "Session not found",
            })
          }
          return { data: info }
        }),
      )
      .handle(
        "session.prompt",
        Effect.fn(function* (ctx) {
          // yejian: 校验会话归属
          yield* assertSessionOwnership(ctx.params.sessionID)
          return {
            data: yield* session
              .prompt({
                sessionID: ctx.params.sessionID,
                id: ctx.payload.id,
                prompt: ctx.payload.prompt,
                delivery: ctx.payload.delivery,
                resume: ctx.payload.resume,
              })
              .pipe(
                Effect.catchTag("Session.NotFoundError", (error) =>
                  Effect.fail(
                    new SessionNotFoundError({
                      sessionID: error.sessionID,
                      message: `Session not found: ${error.sessionID}`,
                    }),
                  ),
                ),
                Effect.catchTag("Session.PromptConflictError", (error) =>
                  Effect.fail(
                    new ConflictError({
                      message: `Prompt message ID conflicts with an existing durable record: ${error.messageID}`,
                      resource: error.messageID,
                    }),
                  ),
                ),
              ),
          }
        }),
      )
      .handle(
        "session.compact",
        Effect.fn(function* (ctx) {
          // yejian: 校验会话归属
          yield* assertSessionOwnership(ctx.params.sessionID)
          yield* session.compact({ sessionID: ctx.params.sessionID }).pipe(
            Effect.catchTag("Session.NotFoundError", (error) =>
              Effect.fail(
                new SessionNotFoundError({
                  sessionID: error.sessionID,
                  message: `Session not found: ${error.sessionID}`,
                }),
              ),
            ),
            Effect.catchTag("Session.OperationUnavailableError", (error) =>
              Effect.fail(
                new ServiceUnavailableError({
                  message: `Session ${error.operation} is not available yet`,
                  service: `session.${error.operation}`,
                }),
              ),
            ),
          )
          return HttpApiSchema.NoContent.make()
        }),
      )
      .handle(
        "session.wait",
        Effect.fn(function* (ctx) {
          // yejian: 校验会话归属
          yield* assertSessionOwnership(ctx.params.sessionID)
          yield* session.wait(ctx.params.sessionID).pipe(
            Effect.catchTag("Session.NotFoundError", (error) =>
              Effect.fail(
                new SessionNotFoundError({
                  sessionID: error.sessionID,
                  message: `Session not found: ${error.sessionID}`,
                }),
              ),
            ),
            Effect.catchTag("Session.OperationUnavailableError", (error) =>
              Effect.fail(
                new ServiceUnavailableError({
                  message: `Session ${error.operation} is not available yet`,
                  service: `session.${error.operation}`,
                }),
              ),
            ),
          )
          return HttpApiSchema.NoContent.make()
        }),
      )
      .handle(
        "session.context",
        Effect.fn(function* (ctx) {
          // yejian: 校验会话归属
          yield* assertSessionOwnership(ctx.params.sessionID)
          return {
            data: yield* session.context(ctx.params.sessionID).pipe(
              Effect.catchTag("Session.NotFoundError", (error) =>
                Effect.fail(
                  new SessionNotFoundError({
                    sessionID: error.sessionID,
                    message: `Session not found: ${error.sessionID}`,
                  }),
                ),
              ),
              Effect.catchTag("Session.MessageDecodeError", (error) => {
                const ref = `err_${crypto.randomUUID().slice(0, 8)}`
                return Effect.logError("failed to decode session message").pipe(
                  Effect.annotateLogs({ ref, sessionID: error.sessionID, messageID: error.messageID }),
                  Effect.andThen(
                    Effect.fail(
                      new UnknownError({
                        message: "Unexpected server error. Check server logs for details.",
                        ref,
                      }),
                    ),
                  ),
                )
              }),
            ),
          }
        }),
      )
  }),
)
