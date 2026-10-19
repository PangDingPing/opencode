import { InstanceRef, WorkspaceRef } from "@/effect/instance-ref"
import { InstanceStore } from "@/project/instance-store"
import { InstanceInitTimeoutError } from "@/project/instance-init-timeout"
import { Effect, Layer } from "effect"
import { HttpServerResponse } from "effect/unstable/http"
import { HttpApiMiddleware } from "effect/unstable/httpapi"
import { WorkspaceRouteContext } from "./workspace-routing"

export class InstanceContextMiddleware extends HttpApiMiddleware.Service<
  InstanceContextMiddleware,
  {
    requires: WorkspaceRouteContext
  }
>()("@opencode/ExperimentalHttpApiInstanceContext") {}

function decode(input: string): string {
  try {
    return decodeURIComponent(input)
  } catch {
    return input
  }
}

function provideInstanceContext<E>(
  effect: Effect.Effect<HttpServerResponse.HttpServerResponse, E>,
  store: InstanceStore.Interface,
): Effect.Effect<HttpServerResponse.HttpServerResponse, E, WorkspaceRouteContext> {
  return Effect.gen(function* () {
    const route = yield* WorkspaceRouteContext
    return yield* store.load({ directory: decode(route.directory) }).pipe(
      Effect.flatMap((ctx) =>
        effect.pipe(
          Effect.provideService(InstanceRef, ctx),
          Effect.provideService(WorkspaceRef, route.workspaceID),
        ),
      ),
      // yejian: 等待者超时映射 503——body 的 message 字段会被前端 wrapClientError
      // 提取并显示在 toast；必须用 jsonUnsafe 保证 application/json content-type，
      // 否则前端拿到裸状态码。
      Effect.catch((error) => {
        if (!(error instanceof InstanceInitTimeoutError)) return Effect.fail(error)
        return Effect.succeed(
          HttpServerResponse.jsonUnsafe(
            {
              message: `环境正在初始化（已等待 ${Math.round(error.waitedMs / 1000)} 秒），请稍后重试；输入已恢复。`,
            },
            { status: 503, headers: { "Retry-After": "10" } },
          ),
        )
      }),
    )
  })
}

export const instanceContextLayer = Layer.effect(
  InstanceContextMiddleware,
  Effect.gen(function* () {
    const store = yield* InstanceStore.Service
    return InstanceContextMiddleware.of((effect) => provideInstanceContext(effect, store))
  }),
)
