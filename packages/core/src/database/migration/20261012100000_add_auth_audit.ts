import { Effect } from "effect"
import type { DatabaseMigration } from "../migration"

// 登录审计表：记录登录成功 / 登出 / 登录失败 / 管理员踢下线 / 管理员禁用五类事件
// user_id 可空（登录失败且用户不存在时无主键可关联）；username 为快照，用户被删除后日志仍可读
export default {
  id: "20261012100000_add_auth_audit",
  up(tx) {
    return Effect.gen(function* () {
      yield* tx.run(`
        CREATE TABLE \`auth_audit\` (
          \`id\` text PRIMARY KEY,
          \`user_id\` text,
          \`username\` text NOT NULL,
          \`action\` text NOT NULL,
          \`ip\` text,
          \`user_agent\` text,
          \`operator\` text,
          \`time_created\` integer NOT NULL,
          \`time_updated\` integer NOT NULL
        );
      `)
      yield* tx.run(`CREATE INDEX \`auth_audit_user_idx\` ON \`auth_audit\` (\`user_id\`);`)
      yield* tx.run(`CREATE INDEX \`auth_audit_time_idx\` ON \`auth_audit\` (\`time_created\`);`)
    })
  },
} satisfies DatabaseMigration.Migration
