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
    // 必须先 provide 中间件 layers，再 provide handlers
    // 因为 handlers 内部 .middleware(RequireAdmin) 引用 RequireAdmin key
    Layer.provide(authorizationLayer),
    Layer.provide(requireAdminLayer),
    Layer.provide(schemaErrorLayer),
    Layer.provide(handlers),
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
