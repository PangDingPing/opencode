import { Workspace } from "@/control-plane/workspace"
import * as InstanceState from "@/effect/instance-state"
import { Session } from "@/session/session"
import { Service as DatabaseService } from "@opencode-ai/core/database/database"
import { EventV2 } from "@opencode-ai/core/event"
import { SessionTable } from "@opencode-ai/core/session/sql"
import { EventV2Bridge } from "@/event-v2-bridge"
import { EventTable } from "@opencode-ai/core/event/sql"
import { CurrentUser } from "@opencode-ai/server/middleware/auth"
import { asc } from "drizzle-orm"
import { and } from "drizzle-orm"
import { eq } from "drizzle-orm"
import { lte } from "drizzle-orm"
import { not } from "drizzle-orm"
import { or } from "drizzle-orm"
import { Effect, Option, Scope } from "effect"
import { HttpApiBuilder, HttpApiError } from "effect/unstable/httpapi"
import { InstanceHttpApi } from "../api"
import { HistoryPayload, ReplayPayload, SessionPayload } from "../groups/sync"

// yejian: 会话域事件前缀，与 handlers/event.ts 的过滤保持一致。
// sync.history / sync.replay 用同一集合做归属校验，防止跨用户读取/注入事件。
const SESSION_SCOPED_PREFIXES = ["session.", "message.", "todo.", "permission.", "question."]
function isSessionScoped(type: string): boolean {
  for (const prefix of SESSION_SCOPED_PREFIXES) {
    if (type.startsWith(prefix)) return true
  }
  return false
}

function ownerFromSessionInfo(type: string, data: unknown): string | undefined {
  if (!type.startsWith("session.")) return undefined
  if (!data || typeof data !== "object") return undefined
  const info = (data as Record<string, unknown>)["info"]
  if (!info || typeof info !== "object") return undefined
  const userID = (info as Record<string, unknown>)["user_id"]
  return typeof userID === "string" ? userID : undefined
}

// 解析当前登录用户。admin 放行；无 CurrentUser 时 myID 为 undefined → fail-closed。
function resolveCurrentUserID() {
  return Effect.gen(function* () {
    const user = (yield* Effect.serviceOption(CurrentUser)) as Option.Option<{
      id: string
      role?: string
    }>
    const isAdmin = Option.isSome(user) && user.value.role === "admin"
    const myID = Option.isSome(user) ? user.value.id : undefined
    return { isAdmin, myID }
  })
}

// 按会话归属过滤历史事件行。非会话域事件直接放行；会话域事件按当前用户过滤。
function filterHistoryByOwner(
  rows: (typeof EventTable)["$inferSelect"][],
  myID: string | undefined,
  isAdmin: boolean,
) {
  if (isAdmin) return rows
  return rows.filter((row) => {
    if (!isSessionScoped(row.type)) return true
    if (!myID) return false // fail-closed
    if (row.type.startsWith("session.")) {
      const owner = ownerFromSessionInfo(row.type, row.data)
      return !!owner && owner === myID
    }
    // 其余会话域事件：aggregate_id 即 sessionID，归属由发布时决定；
    // 历史事件无法在此处异步查库（filter 同步），统一 fail-closed 丢弃非 session.* 的会话域历史事件，
    // 这些事件的前端消费者（message.* 等）本就走 SSE 实时通道，历史回放非其主路径。
    return false
  })
}

export const syncHandlers = HttpApiBuilder.group(InstanceHttpApi, "sync", (handlers) =>
  Effect.gen(function* () {
    const workspace = yield* Workspace.Service
    const session = yield* Session.Service
    const scope = yield* Scope.Scope
    const events = yield* EventV2Bridge.Service
    const { db } = yield* DatabaseService

    const start = Effect.fn("SyncHttpApi.start")(function* () {
      yield* workspace
        .startWorkspaceSyncing((yield* InstanceState.context).project.id)
        .pipe(Effect.ignore, Effect.forkIn(scope))
      return true
    })

    const replay = Effect.fn("SyncHttpApi.replay")(function* (ctx: { payload: typeof ReplayPayload.Type }) {
      const payload: EventV2.SerializedEvent[] = ctx.payload.events.map((event) => ({
        id: event.id,
        aggregateID: event.aggregateID,
        seq: event.seq,
        type: event.type,
        data: { ...event.data },
      }))
      const source = payload[0].aggregateID
      yield* Effect.logInfo("sync replay requested", {
        sessionID: source,
        events: payload.length,
        first: payload[0]?.seq,
        last: payload.at(-1)?.seq,
        directory: ctx.payload.directory,
      })
      // yejian: 校验回放事件的会话归属。非 admin 用户只能回放属于自己会话的事件，
      // 防止伪造/注入他人会话的事件（如篡改消息、伪造权限响应）。
      const { isAdmin, myID } = yield* resolveCurrentUserID()
      if (!isAdmin) {
        for (const ev of payload) {
          if (!isSessionScoped(ev.type)) continue
          if (!myID) return yield* new HttpApiError.BadRequest({})
          if (ev.type.startsWith("session.")) {
            const owner = ownerFromSessionInfo(ev.type, ev.data)
            if (!owner || owner !== myID) return yield* new HttpApiError.BadRequest({})
            continue
          }
          // 其余会话域事件：aggregateID 即 sessionID，查库解析归属
          const ownerRow = yield* db
            .select({ userID: SessionTable.user_id })
            .from(SessionTable)
            .where(eq(SessionTable.id, ev.aggregateID as never))
            .get()
            .pipe(Effect.orDie)
          if (!ownerRow?.userID || ownerRow.userID !== myID) return yield* new HttpApiError.BadRequest({})
        }
      }
      const ownerID = yield* InstanceState.workspaceID
      yield* events.replayAll(payload, { ownerID, strictOwner: true })
      yield* Effect.logInfo("sync replay complete", {
        sessionID: source,
        events: payload.length,
        first: payload[0]?.seq,
        last: payload.at(-1)?.seq,
      })
      return { sessionID: source }
    })

    const steal = Effect.fn("SyncHttpApi.steal")(function* (ctx: { payload: typeof SessionPayload.Type }) {
      const workspaceID = yield* InstanceState.workspaceID
      if (!workspaceID) return yield* new HttpApiError.BadRequest({})

      // yejian: 校验会话归属，非 admin 用户只能迁移自己的会话
      const { isAdmin, myID } = yield* resolveCurrentUserID()
      if (!isAdmin) {
        const ownerRow = yield* db
          .select({ userID: SessionTable.user_id })
          .from(SessionTable)
          .where(eq(SessionTable.id, ctx.payload.sessionID as never))
          .get()
          .pipe(Effect.orDie)
        if (!ownerRow?.userID || ownerRow.userID !== (myID as never)) return yield* new HttpApiError.BadRequest({})
      }

      yield* session.setWorkspace({ sessionID: ctx.payload.sessionID, workspaceID })

      yield* Effect.logInfo("sync session stolen", { sessionID: ctx.payload.sessionID, workspaceID })

      return { sessionID: ctx.payload.sessionID }
    })

    const history = Effect.fn("SyncHttpApi.history")(function* (ctx: { payload: typeof HistoryPayload.Type }) {
      const exclude = Object.entries(ctx.payload)
      const rows = yield* db
        .select()
        .from(EventTable)
        .where(
          exclude.length > 0
            ? not(or(...exclude.map(([id, seq]) => and(eq(EventTable.aggregate_id, id), lte(EventTable.seq, seq))))!)
            : undefined,
        )
        .orderBy(asc(EventTable.seq))
        .all()
        .pipe(Effect.orDie)
      // yejian: 按当前登录用户过滤会话域历史事件，阻断跨用户历史读取
      const { isAdmin, myID } = yield* resolveCurrentUserID()
      return filterHistoryByOwner(rows, myID, isAdmin)
    })

    return handlers.handle("start", start).handle("replay", replay).handle("steal", steal).handle("history", history)
  }),
)
