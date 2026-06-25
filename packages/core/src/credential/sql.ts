import { integer, sqliteTable, text } from "drizzle-orm/sqlite-core"
import { Timestamps } from "../database/schema.sql"
import type { IntegrationSchema } from "../integration/schema"
import type { Credential } from "../credential"
import type { UserID } from "../user/sql"

export const CredentialTable = sqliteTable("credential", {
  id: text().$type<Credential.ID>().primaryKey(),
  integration_id: text().$type<IntegrationSchema.ID>(),
  label: text().notNull(),
  value: text({ mode: "json" }).$type<Credential.Info>().notNull(),
  connector_id: text(),
  method_id: text(),
  active: integer({ mode: "boolean" }),
  user_id: text().$type<UserID>(),
  ...Timestamps,
})
