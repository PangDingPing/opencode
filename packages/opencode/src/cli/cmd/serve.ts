import { Effect, Layer } from "effect"
import { effectCmd } from "../effect-cmd"
import { withNetworkOptions, resolveNetworkOptions } from "../network"
import { Flag } from "@opencode-ai/core/flag/flag"
import { Database } from "@opencode-ai/core/database/database"
import { User } from "@opencode-ai/core/user"
import { AuthToken } from "@opencode-ai/core/auth-token"
import { count } from "drizzle-orm"
import { UserTable } from "@opencode-ai/core/user/sql"
import { readFile } from "node:fs/promises"

/**
 * 启动引导：首次启动时创建 admin 账号
 * - 如果 user 表已有用户（含迁移脚本创建的 29 人），跳过
 * - 没有用户且没设 OPENCODE_SERVER_PASSWORD → fail-fast
 * - 没有用户且设了密码 → 创建 admin 账号
 */
function bootstrapAdmin() {
  return Effect.gen("Cli.serve.bootstrapAdmin", function* () {
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
}

/**
 * 启动引导：从 OPENCODE_SEED_USERS_FILE 预置多用户
 * - 文件格式：[{ "username": "...", "password": "...", "role": "admin" | "user", "displayName": "..." }, ...]
 * - 已存在的 username 跳过（保留原密码 / role）
 * - 未设环境变量 / 文件不存在 / 文件格式错 → 静默跳过（不阻塞启动）
 */
function bootstrapUsers() {
  return Effect.gen("Cli.serve.bootstrapUsers", function* () {
    const seedFile = process.env.OPENCODE_SEED_USERS_FILE
    if (!seedFile) return

    let raw: string
    try {
      raw = yield* Effect.promise(() => readFile(seedFile, "utf-8"))
    } catch (e) {
      console.warn(`[bootstrapUsers] 跳过：读取种子文件失败 ${seedFile} (${(e as Error).message})`)
      return
    }

    let seedUsers: Array<{ username: string; password: string; role: "admin" | "user"; displayName?: string }>
    try {
      seedUsers = JSON.parse(raw)
    } catch (e) {
      console.warn(`[bootstrapUsers] 跳过：种子文件 JSON 解析失败 (${(e as Error).message})`)
      return
    }

    const userSvc = yield* User.Service
    for (const u of seedUsers) {
      const exists = yield* userSvc.getByUsername(u.username)
      if (exists) {
        console.log(`[bootstrapUsers] 用户已存在，跳过: ${u.username}`)
        continue
      }
      try {
        yield* userSvc.createUser({
          username: u.username,
          password: u.password,
          role: u.role,
          displayName: u.displayName,
        })
        console.log(`[bootstrapUsers] 已创建预置用户: ${u.username} (${u.role})`)
      } catch (e) {
        console.error(`[bootstrapUsers] 创建用户失败 ${u.username}: ${(e as Error).message}`)
      }
    }
  })
}

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
    yield* bootstrapAdmin().pipe(
      Effect.provide(Database.defaultLayer),
      Effect.provide(Layer.merge(User.defaultLayer, Database.defaultLayer)),
      Effect.provide(Layer.merge(AuthToken.defaultLayer, Database.defaultLayer)),
    )

    // 启动引导：从种子文件预置多用户（admin 创建后跑，便于多用户场景）
    yield* bootstrapUsers().pipe(
      Effect.provide(Database.defaultLayer),
      Effect.provide(Layer.merge(User.defaultLayer, Database.defaultLayer)),
    )

    const opts = yield* resolveNetworkOptions(args)
    const server = yield* Effect.promise(() => Server.listen(opts))
    console.log(`opencode server listening on http://${server.hostname}:${server.port}`)

    yield* Effect.never
  }),
})
