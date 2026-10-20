# 开发日志：迁移快照补齐——修复 fresh-install 缺表（no such table: auth_audit）

**日期**：2026-10-20
**分支**：`v.1.17.6多用户`
**关联**：自定义改动.md 1.26 节（auth_audit 功能）、1.28 节（本次修复）

---

## 1. 背景与根因

本机源码直跑后端（`bun run --no-cache --conditions=browser ./src/index.ts serve`）后登录报错：

```
SQLiteError: no such table: auth_audit
  at AuthAudit.record (packages/server/src/handlers/auth.ts:103)   ← 登录成功审计埋点
  at AuthAudit.record (packages/core/src/auth-audit/index.ts:92)
```

### 根因链

1. fork 的 m35/m36（user/session_token）、m37（auth_audit）均为**手写迁移**，未走官方 `script/migration.ts` 生成流程
2. `packages/core/schema.json`（drizzle-kit 增量基线快照）停在 m34，缺 user/session_token/auth_audit；`schema.gen.ts`（fresh-install 全量建表 SQL）只手工补过 user/session_token，**漏了 auth_audit**
3. `DatabaseMigration.apply()`（[migration.ts](file:///d:/AI/opencode/packages/core/src/database/migration.ts)）对两种库走不同路径：
   - **老库**（有 `session` 表）→ `applyOnly()`：按 journal 差量执行迁移 → m37 正常建表 ✅（Docker 生产一直没报错的原因）
   - **全新空库** → 用 schema.gen.ts 一次建表，然后把**全部 38 个迁移 ID 直接写入 journal，不执行任何迁移 up** → 缺 auth_audit 且 journal 已标记 m37 完成，永不补建 ❌
4. 本机 `opencode-local.db` 是全新库 → 首次登录即触发

这正是 1.26 节记录的已知限制（"本 fork 只支持老库升级路径"）——本次把它修掉了。

## 2. 实施内容（先 A 后 B）

### A. 本地库解锁（不改代码）

删掉本地库 journal 中的 m37 行，重启后 applyOnly 自动补建表：

```js
// 临时脚本（bun:sqlite），执行后删除
db.run("DELETE FROM migration WHERE id = '20261012100000_add_auth_audit'")
```

执行前后核对：本地 22 张表与旧 schema.gen 完全一致（唯一漂移就是 auth_audit），journal 38 条含 m37 → 删除后 37 条。

### B. 快照补齐（根治，三步法）

1. `packages/core` 下 `bun script/migration.ts` → 生成一个"重复"增量迁移 + 更新 snapshot.json / schema.gen.ts / migration.gen.ts
2. **删除**生成的重复迁移文件（其 DDL 与手写 m35+m37 等价；若保留，老库启动时 `CREATE TABLE auth_audit` 会报 already exists）
3. 手工修复 migration.gen.ts（去掉对已删文件的引用）→ 重跑脚本 → 增量零差异，registry 重渲染为 m00–m37

改动文件（5 个，详见自定义改动.md 1.28 节）：

| 文件 | 改动 |
| --- | --- |
| `packages/core/schema.json` / `schema.gen.ts` | 脚本重新生成，补齐三表 + credential.user_id / session.user_id |
| `packages/core/src/database/migration.gen.ts` | 脚本重渲染为规范格式（m00–m37） |
| `packages/core/script/migration.ts` | Windows 兼容：`Bun.Glob.scan` 返回反斜杠路径，`generatedMigrations` 的 `split("/")` 切不开目录名 → 改 `split(/[\\/]/)` |
| `packages/core/package.json` | `drizzle-kit` 恢复上游 `"catalog:"`（1.0.0-rc.2） |

## 3. 踩坑记录

1. **overlay 合并时误钉了旧版 drizzle-kit**：`packages/core/package.json` 的 `drizzle-kit: "0.31.10"`（git blame 指向 859f44c3e 合并提交）与 drizzle-orm 1.0.0-rc.2 的 compatibilityVersion=14 不匹配，drizzle-kit 直接退出报 "This version of drizzle-kit is outdated"——**报文有误导性**，实为 API 版本检查（`assertOrmCoreVersion`），不是 npm 版本过旧也不是网络问题
2. **`bun install` 无法在本机完成**：ghostty-web（GitHub tarball 依赖）TLS 叶子证书校验失败（`UNABLE_TO_VERIFY_LEAF_SIGNATURE`），与本次改动无关。绕过：手动删除 `packages/core/node_modules/drizzle-kit`（0.31.10 嵌套副本）及其 .bin shim，让 `bun drizzle-kit` 解析到根目录的 1.0.0-rc.2
3. **官方脚本有 Windows bug**：`Bun.Glob.scan` 在 Windows 返回反斜杠路径，`file.split("/")[0]` 切不开目录名，导致把 `20261020…\migration.sql` 当目录名拼接路径后 ENOENT
4. **drizzle-kit 加载 schema 会连带 import migration.gen.ts**：删掉重复迁移后、registry 还引用着它时重跑脚本，drizzle-kit 内部 jiti 加载即崩（MODULE_NOT_FOUND）——**先修 registry 再跑脚本**，鸡生蛋只能手工破一次
5. **生成文件不能手工加注释**：`script/migration.ts --check` 对 registry / schema.gen 做字节级比对，手写的 `// yejian:` 注释会让 check 永远失败。自定义标记记在 自定义改动.md，不进生成文件
6. **PowerShell 5.1 给 bun -e 传参会吞 JS 双引号**（`require("bun:sqlite")` 变成 `require(bun:sqlite)`）——复杂内联脚本一律落临时文件再执行

## 4. 验证

- `bun script/migration.ts --check` 三项全过：无未生成差异 / schema.gen 与全量 SQL 一致 / registry 与目录扫描一致
- `packages/core` `bun typecheck`（tsgo）全绿
- A 步：journal 删除前后均打印核对（38→37 条，表清单不含 auth_audit 确认漂移唯一性）
- 待办：用户重启 serve 后登录一次，确认 applyOnly 自动建表、登录恢复正常（代码路径 `DatabaseMigration.apply` → applyOnly → m37.up）

## 5. 遗留清单

- [ ] 用户重启后端验证登录（A 步生效确认）
- [ ] 网络恢复后跑一次 `bun install`，同步 `bun.lock`（drizzle-kit 0.31.10 → catalog 1.0.0-rc.2；当前 lockfile 未动）
- [ ] 改动未提交：5 个代码文件 + 自定义改动.md + 本日志，待确认后按 `fix(yejian)` / `docs(yejian)` 提交
- [ ] Docker 生产（老库）不受影响、无需急重建；下次构建镜像自然带上快照修复
