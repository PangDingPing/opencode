import { LayerNode } from "@opencode-ai/core/effect/layer-node"
import { GlobalBus } from "@/bus/global"
import { serviceUse } from "@opencode-ai/core/effect/service-use"
import { WorkspaceContext } from "@/control-plane/workspace-context"
import { InstanceRef } from "@/effect/instance-ref"
import { disposeInstance as runDisposers } from "@/effect/instance-registry"
import { FSUtil } from "@opencode-ai/core/fs-util"
import { Context, Deferred, Duration, Effect, Exit, Layer, Scope } from "effect"
import { type InstanceContext } from "./instance-context"
import { InstanceInitTimeoutError, instanceInitTimeout } from "./instance-init-timeout"
import { InstanceBootstrap } from "./bootstrap-service"
import { InstanceBootstrap as InstanceBootstrapGraph } from "./bootstrap"
import * as Project from "./project"

export interface LoadInput {
  directory: string
  worktree?: string
  project?: Project.Info
}

export interface Interface {
  // yejian: load/reload 错误通道含 InstanceInitTimeoutError——等待者超时（HTTP 边界映射 503）
  readonly load: (input: LoadInput) => Effect.Effect<InstanceContext, InstanceInitTimeoutError>
  readonly reload: (input: LoadInput) => Effect.Effect<InstanceContext, InstanceInitTimeoutError>
  readonly dispose: (ctx: InstanceContext) => Effect.Effect<void>
  readonly disposeDirectory: (directory: string) => Effect.Effect<void>
  readonly disposeAll: () => Effect.Effect<void>
  // yejian: provide 实现内部把等待者超时消化为 defect（后台/测试路径无人处理），
  // 错误通道不扩大——HTTP 路径直接调 load，由 instance-context.ts 中间件映射 503。
  readonly provide: <A, E, R>(
    input: LoadInput,
    effect: Effect.Effect<A, E, R>,
  ) => Effect.Effect<A, E, R>
}

export class Service extends Context.Service<Service, Interface>()("@opencode/InstanceStore") {}

export const use = serviceUse(Service)

interface Entry {
  readonly deferred: Deferred.Deferred<InstanceContext>
}

export const layer: Layer.Layer<Service, never, Project.Service | InstanceBootstrap.Service> = Layer.effect(
  Service,
  Effect.gen(function* () {
    const project = yield* Project.Service
    const bootstrap = yield* InstanceBootstrap.Service
    const scope = yield* Scope.Scope
    const cache = new Map<string, Entry>()

    const boot = (input: LoadInput & { directory: string }) =>
      Effect.gen(function* () {
        const ctx: InstanceContext =
          input.project && input.worktree
            ? {
                directory: input.directory,
                worktree: input.worktree,
                project: input.project,
              }
            : yield* project.fromDirectory(input.directory).pipe(
                Effect.map((result) => ({
                  directory: input.directory,
                  worktree: result.sandbox,
                  project: result.project,
                })),
              )
        yield* bootstrap.run.pipe(Effect.provideService(InstanceRef, ctx))
        return ctx
      }).pipe(Effect.withSpan("InstanceStore.boot"))

    const removeEntry = (directory: string, entry: Entry) =>
      Effect.sync(() => {
        if (cache.get(directory) !== entry) return false
        cache.delete(directory)
        return true
      })

    // yejian: 等待者侧超时——仅限制等待方，Deferred 本身与 bootstrap fork 不受影响；
    // 超时后缓存条目保留，重试命中同一 Deferred，初始化完成即成功。
    // 清理路径（dispose*）的 Deferred.await 不走这里：清理必须等真实结果。
    const waitWithTimeout = (deferred: Deferred.Deferred<InstanceContext>, directory: string) => {
      const started = Date.now()
      return Deferred.await(deferred).pipe(
        Effect.timeoutOrElse({
          duration: instanceInitTimeout(),
          orElse: () => Effect.fail(new InstanceInitTimeoutError({ directory, waitedMs: Date.now() - started })),
        }),
      )
    }

    const completeLoad = (directory: string, input: LoadInput, entry: Entry) =>
      Effect.gen(function* () {
        const exit = yield* Effect.exit(boot({ ...input, directory }))
        if (Exit.isFailure(exit)) yield* removeEntry(directory, entry)
        yield* Deferred.done(entry.deferred, exit).pipe(Effect.asVoid)
      })

    const emitDisposed = (input: { directory: string; project?: string }) =>
      Effect.sync(() =>
        GlobalBus.emit("event", {
          directory: input.directory,
          project: input.project,
          workspace: WorkspaceContext.workspaceID,
          payload: {
            type: "server.instance.disposed",
            properties: {
              directory: input.directory,
            },
          },
        }),
      )

    const disposeContext = Effect.fn("InstanceStore.disposeContext")(function* (ctx: InstanceContext) {
      yield* Effect.logInfo("disposing instance", { directory: ctx.directory })
      yield* Effect.promise(() => runDisposers(ctx.directory))
      yield* emitDisposed({ directory: ctx.directory, project: ctx.project.id })
    })

    const disposeEntry = Effect.fnUntraced(function* (directory: string, entry: Entry, ctx: InstanceContext) {
      if (cache.get(directory) !== entry) return false
      yield* disposeContext(ctx)
      if (cache.get(directory) !== entry) return false
      cache.delete(directory)
      return true
    })

    const load = (input: LoadInput): Effect.Effect<InstanceContext, InstanceInitTimeoutError> => {
      const directory = FSUtil.resolve(input.directory)
      return Effect.uninterruptibleMask((restore) =>
        Effect.gen(function* () {
          const existing = cache.get(directory)
          if (existing) return yield* restore(waitWithTimeout(existing.deferred, directory))

          const entry: Entry = { deferred: Deferred.makeUnsafe<InstanceContext>() }
          cache.set(directory, entry)
          yield* Effect.gen(function* () {
            yield* Effect.logInfo("creating instance", { directory: directory })
            yield* completeLoad(directory, input, entry)
          }).pipe(Effect.forkIn(scope, { startImmediately: true }))
          return yield* restore(waitWithTimeout(entry.deferred, directory))
        }),
      ).pipe(Effect.withSpan("InstanceStore.load"))
    }

    const reload = (input: LoadInput): Effect.Effect<InstanceContext, InstanceInitTimeoutError> => {
      const directory = FSUtil.resolve(input.directory)
      return Effect.uninterruptibleMask((restore) =>
        Effect.gen(function* () {
          const previous = cache.get(directory)
          const entry: Entry = { deferred: Deferred.makeUnsafe<InstanceContext>() }
          cache.set(directory, entry)
          yield* Effect.gen(function* () {
            yield* Effect.logInfo("reloading instance", { directory: directory })
            if (previous) {
              yield* Deferred.await(previous.deferred).pipe(Effect.ignore)
              yield* Effect.promise(() => runDisposers(directory))
              yield* emitDisposed({ directory, project: input.project?.id })
            }
            yield* completeLoad(directory, input, entry)
          }).pipe(Effect.forkIn(scope, { startImmediately: true }))
          return yield* restore(waitWithTimeout(entry.deferred, directory))
        }),
      ).pipe(Effect.withSpan("InstanceStore.reload"))
    }

    const dispose = Effect.fn("InstanceStore.dispose")(function* (ctx: InstanceContext) {
      const entry = cache.get(ctx.directory)
      if (!entry) return yield* disposeContext(ctx)

      const exit = yield* Deferred.await(entry.deferred).pipe(Effect.exit)
      if (Exit.isFailure(exit)) return yield* removeEntry(ctx.directory, entry).pipe(Effect.asVoid)
      if (exit.value !== ctx) return
      yield* disposeEntry(ctx.directory, entry, ctx).pipe(Effect.asVoid)
    })

    const disposeDirectory = Effect.fn("InstanceStore.disposeDirectory")(function* (input: string) {
      const directory = FSUtil.resolve(input)
      const entry = cache.get(directory)
      if (!entry) return
      const exit = yield* Deferred.await(entry.deferred).pipe(Effect.exit)
      if (Exit.isFailure(exit)) return yield* removeEntry(directory, entry).pipe(Effect.asVoid)
      yield* disposeEntry(directory, entry, exit.value).pipe(Effect.asVoid)
    })

    const disposeAllOnce = Effect.fnUntraced(function* () {
      yield* Effect.logInfo("disposing all instances")
      yield* Effect.forEach(
        [...cache.entries()],
        (item) =>
          Effect.gen(function* () {
            const exit = yield* Deferred.await(item[1].deferred).pipe(Effect.exit)
            if (Exit.isFailure(exit)) {
              yield* Effect.logWarning("instance dispose failed", { key: item[0], cause: exit.cause })
              yield* removeEntry(item[0], item[1])
              return
            }
            yield* disposeEntry(item[0], item[1], exit.value)
          }),
        { discard: true },
      )
    })

    const cachedDisposeAll = yield* Effect.cachedWithTTL(disposeAllOnce(), Duration.zero)
    const disposeAll = Effect.fn("InstanceStore.disposeAll")(function* () {
      return yield* cachedDisposeAll
    })

    // yejian: provide 走后台/测试路径，无人能处理超时失败——消化为 defect（泛型 E 不被扩大）；
    // HTTP 路径由 instance-context.ts 中间件直接调 load 并映射 503，不经过这里。
    const provide = <A, E, R>(input: LoadInput, effect: Effect.Effect<A, E, R>): Effect.Effect<A, E, R> =>
      load(input).pipe(
        Effect.catchTag("InstanceInitTimeoutError", (error) =>
          Effect.logError("instance init waiters timed out", error).pipe(Effect.andThen(Effect.die(error))),
        ),
        Effect.flatMap((ctx) => effect.pipe(Effect.provideService(InstanceRef, ctx))),
      )

    yield* Effect.addFinalizer(() => disposeAll().pipe(Effect.ignore))

    return Service.of({
      load,
      reload,
      dispose,
      disposeDirectory,
      disposeAll,
      provide,
    })
  }),
)

export const defaultLayer = layer.pipe(Layer.provide(Project.defaultLayer))

export const node = LayerNode.make(layer, [Project.node, InstanceBootstrapGraph.node])

export * as InstanceStore from "./instance-store"
