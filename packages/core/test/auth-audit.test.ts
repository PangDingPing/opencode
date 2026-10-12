import { describe, expect, test } from "bun:test"
import path from "path"
import fs from "fs/promises"
import { Effect, Layer, Scope } from "effect"
import { SqliteClient } from "@effect/sql-sqlite-bun"
import { EffectDrizzleSqlite } from "@opencode-ai/effect-drizzle-sqlite"
import type { SqlClient as SqlClientService } from "effect/unstable/sql/SqlClient"
import { AuthAudit } from "@opencode-ai/core/auth-audit"
import { AuthAuditTable } from "@opencode-ai/core/auth-audit/sql"
import { Database } from "@opencode-ai/core/database/database"
import { DatabaseMigration } from "@opencode-ai/core/database/migration"
import { migrations } from "@opencode-ai/core/database/migration.gen"
import { Path } from "@opencode-ai/core/global"

const makeDb = EffectDrizzleSqlite.makeWithDefaults()

// 注意：不能走 Database.layerFromPath 的 fresh-install 路径——该路径用 schema.up（仅上游表）
// 建库并标记全部迁移完成，fork 自定义表（user/session_token/auth_audit）不在其中。
// 测试里手动走 applyOnly 完整迁移链，与真实"老库升级"安装路径一致。
const databaseLayer = Layer.effect(
  Database.Service,
  Effect.gen(function* () {
    const db = yield* makeDb
    yield* DatabaseMigration.applyOnly(db, migrations).pipe(Effect.orDie)
    return { db }
  }),
)

// AuthAudit 服务层（依赖上面的完整迁移链数据库）
function layer() {
  return Layer.mergeAll(AuthAudit.layer.pipe(Layer.provide(databaseLayer)), databaseLayer)
}

// 组合层构建带 Scope 需求，provide SqliteClient + scoped 收尾后 as 收窄到 never
const run = <A, E>(effect: Effect.Effect<A, E, SqlClientService | Scope.Scope>) =>
  Effect.runPromise(
    effect.pipe(
      Effect.provide(SqliteClient.layer({ filename: ":memory:", disableWAL: true })),
      Effect.scoped,
    ) as Effect.Effect<A, E, never>,
  )

// 当天审计日志文件路径（Path.log/auth-YYYYMMDD.log）
function todayLogFile(): string {
  const now = new Date()
  const pad = (n: number) => String(n).padStart(2, "0")
  return path.join(Path.log, `auth-${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}.log`)
}

describe("AuthAudit", () => {
  test("record 写入 DB 并追加 JSONL 日志文件", async () => {
    // username 用唯一值，避免与其他运行留下的日志行混淆
    const username = `audit_test_${Date.now()}`
    await run(
      Effect.gen(function* () {
        const audit = yield* AuthAudit.Service
        yield* audit.record({ userId: "usr_test", username, action: "login", ip: "192.168.1.5", userAgent: "test-agent" })

        const result = yield* audit.list({})
        expect(result.total).toBe(1)
        expect(result.data[0]?.username).toBe(username)
        expect(result.data[0]?.action).toBe("login")
        expect(result.data[0]?.ip).toBe("192.168.1.5")
        expect(result.data[0]?.user_agent).toBe("test-agent")

        // 日志文件追加：找到含唯一 username 的 JSONL 行并解析校验
        const content = yield* Effect.promise(() => fs.readFile(todayLogFile(), "utf8"))
        const line = content.trimEnd().split("\n").find((l) => l.includes(username))
        expect(line).toBeDefined()
        const parsed = JSON.parse(line!)
        expect(parsed.action).toBe("login")
        expect(parsed.username).toBe(username)
        expect(parsed.ip).toBe("192.168.1.5")
      }).pipe(Effect.provide(layer())),
    )
  })

  test("record 的 user_id 可空（登录失败且用户不存在的场景）", async () => {
    await run(
      Effect.gen(function* () {
        const audit = yield* AuthAudit.Service
        yield* audit.record({ username: "不存在的用户", action: "login_failed", ip: "10.0.0.1" })

        const result = yield* audit.list({ action: "login_failed" })
        expect(result.total).toBe(1)
        expect(result.data[0]?.user_id).toBeNull()
        expect(result.data[0]?.username).toBe("不存在的用户")
      }).pipe(Effect.provide(layer())),
    )
  })

  test("list 按 username 模糊过滤、按 action 精确过滤、分页", async () => {
    await run(
      Effect.gen(function* () {
        const audit = yield* AuthAudit.Service
        yield* audit.record({ userId: "u1", username: "alice", action: "login" })
        yield* audit.record({ userId: "u2", username: "bob", action: "login" })
        yield* audit.record({ userId: "u3", username: "alice", action: "logout" })
        yield* audit.record({ userId: "u4", username: "carol", action: "login_failed" })
        yield* audit.record({ userId: "u5", username: "dave", action: "kicked", operator: "admin" })

        // username 模糊
        const byName = yield* audit.list({ username: "ali" })
        expect(byName.total).toBe(2)
        expect(byName.data.map((e) => e.action).sort()).toEqual(["login", "logout"])

        // action 精确
        const byAction = yield* audit.list({ action: "login" })
        expect(byAction.total).toBe(2)

        // operator 保留
        const kicked = yield* audit.list({ action: "kicked" })
        expect(kicked.data[0]?.operator).toBe("admin")

        // 分页（limit + offset，同毫秒 time_created 排序不保证顺序，只验证数量与 total）
        const page1 = yield* audit.list({ limit: 2, offset: 0 })
        expect(page1.data.length).toBe(2)
        expect(page1.total).toBe(5)
        const page2 = yield* audit.list({ limit: 2, offset: 2 })
        expect(page2.data.length).toBe(2)
        const page3 = yield* audit.list({ limit: 2, offset: 4 })
        expect(page3.data.length).toBe(1)

        // limit 上限 200（超限截断不报错）
        const capped = yield* audit.list({ limit: 999 })
        expect(capped.data.length).toBe(5)
      }).pipe(Effect.provide(layer())),
    )
  })

  test("record 惰性清理 180 天前的记录（24h 节流）", async () => {
    await run(
      Effect.gen(function* () {
        const db = (yield* Database.Service).db
        const audit = yield* AuthAudit.Service

        // 直接插入一条 181 天前的旧记录（模拟历史遗留）
        const old = Date.now() - 181 * 24 * 60 * 60 * 1000
        yield* db
          .insert(AuthAuditTable)
          .values({
            id: "old_row",
            user_id: "u_old",
            username: "旧记录",
            action: "login",
            time_created: old,
            time_updated: old,
          })
          .run()

        // 首次 record 触发惰性清理（lastCleanupAt 初始为 0）
        yield* audit.record({ userId: "u_new", username: "新记录", action: "login" })

        const result = yield* audit.list({})
        expect(result.total).toBe(1)
        expect(result.data[0]?.username).toBe("新记录")
      }).pipe(Effect.provide(layer())),
    )
  })
})
