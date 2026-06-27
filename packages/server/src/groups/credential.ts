import { Credential } from "@opencode-ai/core/credential"
import { IntegrationSchema } from "@opencode-ai/core/integration/schema"
import { Schema } from "effect"
import { HttpApiEndpoint, HttpApiGroup, HttpApiSchema, OpenApi } from "effect/unstable/httpapi"
import { RequireAdmin } from "../middleware/require-admin"

export const CredentialGroup = HttpApiGroup.make("server.credential")
  .add(
    HttpApiEndpoint.post("credential.create", "/api/credential", {
      payload: Schema.Struct({
        integrationID: IntegrationSchema.ID,
        value: Credential.Info,
        label: Schema.String.pipe(Schema.optional),
      }),
      success: Schema.Struct({ data: Credential.Stored }),
    })
      .middleware(RequireAdmin)
      .annotateMerge(
        OpenApi.annotations({
          identifier: "v2.credential.create",
          summary: "Create credential",
          description: "Create a stored credential (admin only).",
        }),
      ),
  )
  .add(
    HttpApiEndpoint.patch("credential.update", "/api/credential/:credentialID", {
      params: { credentialID: Credential.ID },
      payload: Schema.Struct({ label: Schema.String }),
      success: HttpApiSchema.NoContent,
    }).annotateMerge(
      OpenApi.annotations({
        identifier: "v2.credential.update",
        summary: "Update credential",
        description: "Update a stored credential label.",
      }),
    ),
  )
  .add(
    HttpApiEndpoint.delete("credential.remove", "/api/credential/:credentialID", {
      params: { credentialID: Credential.ID },
      success: HttpApiSchema.NoContent,
    }).annotateMerge(
      OpenApi.annotations({
        identifier: "v2.credential.remove",
        summary: "Remove credential",
        description: "Remove a stored integration credential.",
      }),
    ),
  )
