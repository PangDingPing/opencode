import { Effect } from "effect"
import { effectCmd } from "../effect-cmd"
import { withNetworkOptions, resolveNetworkOptions } from "../network"
import { Flag } from "@opencode-ai/core/flag/flag"
import { Database } from "@opencode-ai/core/database/database"
import { User } from "@opencode-ai/core/user"
import { AuthToken } from "@opencode-ai/core/auth-token"
import { count } from "drizzle-orm"
import { UserTable } from "@opencode-ai/core/user/sql"

/**
 * 启动引导：首次启动时创建 admin 账号
 * - 如果 user 表已有用户（含迁移脚本创建的 29 人），跳过
 * - 没有用户且没设 OPENCODE_SERVER_PASSWORD → fail-fast
 * - 没有用户且设了密码 → 创建 admin 账号
 */
const bootstrapAdmin = Effect.fn("Cli.serve.bootstrapAdmin")(function* () {
  const { db } = yield* Database.Service
  const result = yield* db.select({ c: count() }).from(UserTable).get().pipe(Effect.orDie)
  if (result && result.c > 0) return

  const password = Flag.OPENCODE_SERVER_PASSWORD
  if (!password) {
    console.error("首次启动必须设置 OPENCODE_SERVER_PASSWORD 环境变量")
    process.exit(1)
  }

  const username = Flag.OPENCODE_SERVER_USERNAME ?? "admin"
  const userSvc = yield* User.Service
  yield* userSvc.createUser({ username, password, role: "admin" })
  console.log(`已创建初始 admin 账号: ${username}`)
})

export const ServeCommand = effectCmd({
  command: "serve",
  builder: (yargs) => withNetworkOptions(yargs),
  describe: "starts a headless opencode server",
  // Server loads instances per-request via x-opencode-directory header — no
  // need for an ambient project InstanceContext at startup.
  instance: false,
  handler: Effect.fn("Cli.serve")(function* (args) {
    const { Server } = yield* Effect.promise(() => import("../../server/server"))

    if (!Flag.OPENCODE_SERVER_PASSWORD) {
      console.log("Warning: OPENCODE_SERVER_PASSWORD is not set; server is unsecured.")
    }

    // 启动引导：确保 admin 账号存在
    yield* bootstrapAdmin.pipe(
      Effect.provide(Database.defaultLayer),
      Effect.provide(User.defaultLayer),
      Effect.provide(AuthToken.defaultLayer),
    )

    const opts = yield* resolveNetworkOptions(args)
    const server = yield* Effect.promise(() => Server.listen(opts))
    console.log(`opencode server listening on http://${server.hostname}:${server.port}`)

    yield* Effect.never
  }),
})
