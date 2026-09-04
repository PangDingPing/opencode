import { defaultLayer as DatabaseDefaultLayer } from "@opencode-ai/core/database/database"
import { EventV2 } from "@opencode-ai/core/event"
import { LocationServiceMap } from "@opencode-ai/core/location-layer"
import { defaultLayer as UserDefaultLayer } from "@opencode-ai/core/user"
import { defaultLayer as AuthTokenDefaultLayer } from "@opencode-ai/core/auth-token"
import { FetchHttpClient, HttpRouter, HttpServer } from "effect/unstable/http"
import { HttpApiBuilder } from "effect/unstable/httpapi"
import { Layer, Option } from "effect"
import { Api } from "./api"
import { ServerAuth } from "./auth"
import { handlers } from "./handlers"
import { authorizationLayer } from "./middleware/authorization"
import { requireAdminLayer } from "./middleware/require-admin"
import { schemaErrorLayer } from "./middleware/schema-error"

export function createRoutes(password?: string) {
  return HttpApiBuilder.layer(Api, { openapiPath: "/openapi.json" }).pipe(
    // 与上游 httpapi/server.ts 组装顺序一致：先 provide handlers（引入 RequireAdmin 等 middleware key 依赖），
    // 再 provide 中间件实现层去满足这些依赖；若先 provide 中间件，后加入的 handlers 的依赖无人满足
    Layer.provide(handlers),
    Layer.provide(authorizationLayer),
    Layer.provide(requireAdminLayer),
    Layer.provide(schemaErrorLayer),
    Layer.provide(
      password
        ? ServerAuth.Config.layer({ username: "opencode", password: Option.some(password) })
        : ServerAuth.Config.defaultLayer,
    ),
    Layer.provide(LocationServiceMap.layer),
    Layer.provide(DatabaseDefaultLayer),
    Layer.provide(EventV2.defaultLayer),
    Layer.provide(Layer.merge(UserDefaultLayer, DatabaseDefaultLayer)),
    Layer.provide(Layer.merge(AuthTokenDefaultLayer, DatabaseDefaultLayer)),
    Layer.provide(FetchHttpClient.layer),
  )
}

export const routes = createRoutes()

export const webHandler = () =>
  HttpRouter.toWebHandler(routes.pipe(Layer.provide(HttpServer.layerServices)), { disableLogger: true })
