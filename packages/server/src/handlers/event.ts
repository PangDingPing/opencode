import { EventV2 } from "@opencode-ai/core/event"
import { Location } from "@opencode-ai/core/location"
import { sessionEventGuard, type SessionEventOwner } from "@opencode-ai/core/session/ownership"
import { Effect, Stream } from "effect"
import { HttpServerResponse } from "effect/unstable/http"
import { HttpApiBuilder } from "effect/unstable/httpapi"
import * as Sse from "effect/unstable/encoding/Sse"
import { Api } from "../api"
import { CurrentUser } from "../middleware/auth"

function eventData(data: unknown): Sse.Event {
  return {
    _tag: "Event",
    event: "message",
    id: undefined,
    data: JSON.stringify(data),
  }
}

export const EventHandler = HttpApiBuilder.group(Api, "server.event", (handlers) =>
  Effect.gen(function* () {
    const events = yield* EventV2.Service
    return handlers.handleRaw("event.subscribe", () =>
      Effect.gen(function* () {
        const location = yield* Location.Service
        // yejian: 解析当前登录用户（Authorization 中间件 provides CurrentUser）+
        // 会话域事件归属过滤器。admin 放行；未鉴权 fail-closed 丢弃会话域事件。
        const currentUser = yield* CurrentUser
        const owner: SessionEventOwner = {
          userID: currentUser.id,
          isAdmin: currentUser.role === "admin",
        }
        const check = yield* sessionEventGuard()
        const connected = {
          id: EventV2.ID.create(),
          type: "server.connected",
          location: new Location.Info({
            directory: location.directory,
            workspaceID: location.workspaceID,
            project: location.project,
          }),
          data: {},
        }
        return HttpServerResponse.stream(
          Stream.make(connected).pipe(
            Stream.concat(
              events
                .all()
                .pipe(
                  Stream.filter(
                    (event) =>
                      event.location?.directory === location.directory &&
                      event.location.workspaceID === location.workspaceID,
                  ),
                  // yejian: 会话域事件按当前登录用户过滤，阻断跨用户泄露
                  Stream.filterEffect((event) =>
                    check({ type: event.type, data: event.data, owner }).pipe(
                      Effect.map((ok) => ok === true),
                    ),
                  ),
                ),
            ),
            Stream.map(eventData),
            Stream.pipeThroughChannel(Sse.encode()),
            Stream.encodeText,
          ),
          {
            contentType: "text/event-stream",
            headers: {
              "Cache-Control": "no-cache, no-transform",
              "X-Accel-Buffering": "no",
              "X-Content-Type-Options": "nosniff",
            },
          },
        )
      }),
    )
  }),
)
