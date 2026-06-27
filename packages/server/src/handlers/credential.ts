import { Credential } from "@opencode-ai/core/credential"
import { Effect } from "effect"
import { HttpApiBuilder, HttpApiSchema } from "effect/unstable/httpapi"
import { Api } from "../api"
import { CurrentUser } from "../middleware/auth"

// 对 credential value 中的敏感字段做脱敏
function maskCredentialValue(value: Credential.Info): Credential.Info {
  if (value.type === "key") {
    const masked = value.key.length > 6 ? `${value.key.slice(0, 6)}***` : "***"
    return { ...value, key: masked }
  }
  return value
}

export const CredentialHandler = HttpApiBuilder.group(Api, "server.credential", (handlers) =>
  handlers
    .handle(
      "credential.create",
      Effect.fn(function* (ctx) {
        const user = yield* CurrentUser
        const credential = yield* (yield* Credential.Service).create({
          integrationID: ctx.payload.integrationID,
          value: ctx.payload.value,
          label: ctx.payload.label,
          userID: user.id,
        })
        return { data: { ...credential, value: maskCredentialValue(credential.value) } }
      }),
    )
    .handle(
      "credential.update",
      Effect.fn(function* (ctx) {
        yield* (yield* Credential.Service).update(ctx.params.credentialID, { label: ctx.payload.label })
        return HttpApiSchema.NoContent.make()
      }),
    )
    .handle(
      "credential.remove",
      Effect.fn(function* (ctx) {
        yield* (yield* Credential.Service).remove(ctx.params.credentialID)
        return HttpApiSchema.NoContent.make()
      }),
    ),
  )
