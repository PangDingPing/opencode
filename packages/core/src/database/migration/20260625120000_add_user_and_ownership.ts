import { Effect } from "effect"
import type { DatabaseMigration } from "../migration"

export default {
  id: "20260625120000_add_user_and_ownership",
  up(tx) {
    return Effect.gen(function* () {
      // 1. 新建 user 表
      yield* tx.run(`
        CREATE TABLE \`user\` (
          \`id\` text PRIMARY KEY,
          \`username\` text NOT NULL,
          \`password_hash\` text NOT NULL,
          \`role\` text NOT NULL,
          \`display_name\` text,
          \`disabled\` integer DEFAULT 0 NOT NULL,
          \`must_change_password\` integer DEFAULT 0 NOT NULL,
          \`time_created\` integer NOT NULL,
          \`time_updated\` integer NOT NULL
        );
      `)
      yield* tx.run(`CREATE UNIQUE INDEX \`user_username_idx\` ON \`user\` (\`username\`);`)

      // 2. 新建 session_token 表
      yield* tx.run(`
        CREATE TABLE \`session_token\` (
          \`id\` text PRIMARY KEY,
          \`user_id\` text NOT NULL,
          \`expires_at\` integer NOT NULL,
          \`last_extend_at\` integer NOT NULL,
          \`revoked_at\` integer,
          \`time_created\` integer NOT NULL,
          \`time_updated\` integer NOT NULL,
          \`user_agent\` text,
          \`ip\` text,
          CONSTRAINT \`fk_session_token_user_id_user_id_fk\` FOREIGN KEY (\`user_id\`) REFERENCES \`user\`(\`id\`) ON DELETE CASCADE
        );
      `)
      yield* tx.run(`CREATE INDEX \`session_token_user_idx\` ON \`session_token\` (\`user_id\`);`)

      // 3. session 表加 user_id 列
      yield* tx.run(`ALTER TABLE \`session\` ADD COLUMN \`user_id\` text;`)
      yield* tx.run(`CREATE INDEX \`session_user_id_idx\` ON \`session\` (\`user_id\`);`)

      // 4. credential 表加 user_id 列（审计用）
      yield* tx.run(`ALTER TABLE \`credential\` ADD COLUMN \`user_id\` text;`)

      // 5. 插入 _legacy_system 虚拟用户（disabled=1，不能登录，用于归属老数据）
      const now = Date.now()
      yield* tx.run(`
        INSERT INTO \`user\` (\`id\`, \`username\`, \`password_hash\`, \`role\`, \`display_name\`, \`disabled\`, \`must_change_password\`, \`time_created\`, \`time_updated\`)
        VALUES ('usr_legacy_system', '_legacy_system', '!disabled!', 'admin', 'Legacy Data (pre-multitenant)', 1, 0, ${now}, ${now});
      `)

      // 6. 老 session 全部划给 _legacy_system
      yield* tx.run(`UPDATE \`session\` SET \`user_id\` = 'usr_legacy_system' WHERE \`user_id\` IS NULL;`)
    })
  },
} satisfies DatabaseMigration.Migration
