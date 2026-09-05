// yejian: 多用户会话事件归属过滤模块。
// 背景：多用户部署下 SSE 事件广播（/global/event、/event、/api/event）若不按
// 归属过滤，用户 A 的会话标题/消息正文会实时泄露给其他用户。本模块提供统一的
// 会话域事件归属判定，供上述三个 SSE 端点复用（packages/opencode 与
// packages/server 均依赖 core，故放在 core）。
import { eq } from "drizzle-orm"
import { Effect } from "effect"
import { Database } from "../database/database"
import type { SessionSchema } from "./schema"
import { SessionTable } from "./sql"

// 会话域事件类型前缀：这些事件携带会话数据（标题/消息/todo/权限/提问/状态），
// 必须按归属过滤；其余事件（server.*/project.*/installation.*/lsp.* 等）放行。
const SESSION_SCOPED_PREFIXES = ["session.", "message.", "todo.", "permission.", "question."]

export function isSessionScoped(type: unknown): boolean {
  if (typeof type !== "string") return false
  for (const prefix of SESSION_SCOPED_PREFIXES) {
    if (type.startsWith(prefix)) return true
  }
  return false
}

// 从事件数据提取 sessionID。绝大多数会话域事件顶层即有 sessionID；
// session.* 事件在 info 里（info.sessionID / info.id）；message.part.* 在 part 里。
// 提取失败返回 undefined（fail-closed 丢弃）。
function extractSessionID(data: unknown): string | undefined {
  if (!data || typeof data !== "object") return undefined
  const d = data as Record<string, unknown>
  const sessionID = d["sessionID"]
  if (typeof sessionID === "string") return sessionID
  const info = d["info"]
  if (info && typeof info === "object") {
    const i = info as Record<string, unknown>
    if (typeof i["sessionID"] === "string") return i["sessionID"]
    if (typeof i["id"] === "string") return i["id"]
  }
  const part = d["part"]
  if (part && typeof part === "object") {
    const p = part as Record<string, unknown>
    if (typeof p["sessionID"] === "string") return p["sessionID"]
  }
  return undefined
}

// session.* 事件数据里的 info 是 Session 信息，带 user_id，可直接比对，无需查库
// （会话删除后事件仍可判定归属）。
function ownerFromSessionEventData(type: string, data: unknown): string | undefined {
  if (!type.startsWith("session.")) return undefined
  if (!data || typeof data !== "object") return undefined
  const info = (data as Record<string, unknown>)["info"]
  if (!info || typeof info !== "object") return undefined
  const userID = (info as Record<string, unknown>)["user_id"]
  return typeof userID === "string" ? userID : undefined
}

export type SessionEventOwner = {
  // 当前登录用户 id；未鉴权时为 undefined（会话域事件全部丢弃，fail-closed）
  userID?: string
  // admin 放行全部会话域事件（与 session.list / requireSession 的 admin 语义一致）
  isAdmin: boolean
}

// 归属缓存：sessionID -> user_id（null 表示无主/已删除）。user_id 在会话生命
// 周期内不变，进程级缓存安全；上限防膨胀，超限整体清空。
const ownerCache = new Map<string, string | null>()

// 构建会话域事件归属判定函数：先解析 db 句柄再闭包捕获，避免 SSE 流运行期
// 携带服务依赖（流在响应返回后被平台消费，无法访问 handler 上下文）。
export const sessionEventGuard = Effect.fn("SessionOwnership.guard")(function* () {
  const { db } = yield* Database.Service
  return Effect.fn("SessionOwnership.check")(function* (input: {
    type: unknown
    data: unknown
    owner: SessionEventOwner
    // 调用方已知 sessionID 时透传（如 sync 事件的聚合 ID），仅作提取失败后的兜底
    sessionID?: string
  }) {
    if (!isSessionScoped(input.type)) return true
    if (input.owner.isAdmin) return true
    // session.* 事件：info.user_id 直接比对（无主会话对非 admin 一律拒绝）
    const eventOwner = ownerFromSessionEventData(input.type as string, input.data)
    if (eventOwner !== undefined) return eventOwner === input.owner.userID
    // 其余会话域事件：查库解析归属；提取不到 sessionID 或查无此会话则 fail-closed
    const sessionID = extractSessionID(input.data) ?? input.sessionID
    if (!sessionID) return false
    const cached = ownerCache.get(sessionID)
    if (cached !== undefined) return cached === input.owner.userID
    if (ownerCache.size > 10_000) ownerCache.clear()
    // 查询失败按无主处理（丢弃该事件），不中断 SSE 流
    const row = yield* db
      .select({ userID: SessionTable.user_id })
      .from(SessionTable)
      .where(eq(SessionTable.id, sessionID as SessionSchema.ID))
      .get()
      .pipe(Effect.catch(() => Effect.succeed(undefined)))
    const owner = row?.userID ?? null
    ownerCache.set(sessionID, owner)
    return owner === input.owner.userID
  })
})
