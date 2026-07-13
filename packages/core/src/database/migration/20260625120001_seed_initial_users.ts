import { sql } from "drizzle-orm"
import { Effect } from "effect"
import type { DatabaseMigration } from "../migration"
import { loadAllowedNames } from "../../user/allowed-names"
import { hashPassword } from "../../user"

/**
 * 种子迁移：从 allowed-names.txt 白名单批量创建初始用户
 * - 读取白名单文件，为每个实名创建一个普通用户
 * - 初始密码统一为 OPENCODE_SERVER_PASSWORD 环境变量
 * - 首次登录强制改密（must_change_password=1）
 * - 幂等设计：INSERT OR IGNORE，已存在的用户名自动跳过
 * - 如果没设 OPENCODE_SERVER_PASSWORD，跳过种子（只建表不建用户）
 */
export default {
  id: "20260625120001_seed_initial_users",
  up(tx) {
    return Effect.gen(function* () {
      const password = process.env.OPENCODE_SERVER_PASSWORD
      if (!password) return

      const names = loadAllowedNames()
      if (names.length === 0) return

      const now = Date.now()
      const passwordHash = yield* Effect.promise(() => hashPassword(password))

      for (const username of names) {
        const id = "usr_" + username
        yield* tx.run(
          sql`INSERT OR IGNORE INTO \`user\` (\`id\`, \`username\`, \`password_hash\`, \`role\`, \`display_name\`, \`disabled\`, \`must_change_password\`, \`time_created\`, \`time_updated\`) VALUES (${id}, ${username}, ${passwordHash}, 'user', ${username}, 0, 1, ${now}, ${now})`,
        )
      }
    })
  },
} satisfies DatabaseMigration.Migration
