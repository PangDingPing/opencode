# Session 按 UserID 隔离实施计划（数据库层修复）

## 1. Summary

修复 `SessionTable.user_id` 写入链路，实现 session 按 userID 隔离。本次仅修改数据库层，不改动 session ID 格式，通过后端强制过滤 + 权限检查实现用户隔离。

**核心改动**：让 `user_id` 从 `session.create` handler → Core service → event projection → database 写入 → `session.get` 返回 全链路打通。

## 2. Current State Analysis

### 2.1 当前问题

| 环节 | 文件 | 现状 | 问题 |
|------|------|------|------|
| SessionInfo schema | `packages/core/src/v1/session.ts` | 无 `user_id` 字段 | 事件 payload 不携带 |
| session.create | `packages/core/src/session.ts` | 接收 `input.userID` | 未传入 `SessionInfo` |
| SessionProjector | `packages/core/src/session/projector.ts` | `sessionRow()` 无 `user_id` | 数据库 INSERT 不写 |
| fromRow | `packages/core/src/session/info.ts` | 无 `user_id` 映射 | `session.get` 返回缺少字段 |
| session.get handler | `packages/server/src/handlers/session.ts` | 检查 `session.userID` | 因 fromRow 缺失，永远为 undefined |
| workaround | `packages/core/src/session.ts:255-263` | UPDATE 写入 `user_id` | 与 INSERT 分离，存在竞态 |

### 2.2 关键发现

**当前状态：非 admin 用户完全无法访问任何 session**

```ts
// packages/server/src/handlers/session.ts:106
if (user.role !== "admin" && session.userID !== user.id) {
  return yield* new SessionNotFoundError({ sessionID, message: "Session not found" })
}
```

由于 `fromRow()` 未映射 `user_id`，`session.userID` 永远是 `undefined`，导致 `undefined !== user.id` 永远为 `true`，非 admin 用户访问任何 session 都会报错。

## 3. Implementation Steps

### Step 1：扩展 SessionInfo schema

**文件：** `packages/core/src/v1/session.ts`

**改动：**
- 在 `SessionInfo` 的 `Schema.Struct` 中增加 `user_id` 字段
- 位置：`workspaceID` 字段后，`directory` 字段前

```ts
export const SessionInfo = Schema.Struct({
  id: SessionSchema.ID,
  slug: Schema.String,
  projectID: ProjectV2.ID,
  workspaceID: optionalOmitUndefined(WorkspaceV2.ID),
  user_id: optionalOmitUndefined(UserID),  // 新增
  directory: Schema.String,
  ...
})
```

**注意：**
- 字段名使用 `user_id`（下划线命名），与数据库字段 `SessionTable.user_id` 保持一致
- 类型为 `optionalOmitUndefined(UserID)`，与 `workspaceID` 风格一致
- 需要 import `UserID`：`import { UserID } from "../user/sql"`

**验证：**
```bash
# 编译检查
pnpm --filter @opencode/core build
```

---

### Step 2：修改 session.create 传入 user_id

**文件：** `packages/core/src/session.ts`

**改动 1：在 SessionInfo.make() 中传入 user_id**

```ts
const info = SessionV1.SessionInfo.make({
  id: sessionID,
  slug: Slug.create(),
  version: InstallationVersion,
  projectID: project.id,
  directory: input.location.directory,
  user_id: input.userID,  // 新增
  path: path.relative(project.directory, input.location.directory).replaceAll("\\", "/"),
  workspaceID: input.location.workspaceID ? WorkspaceV2.ID.make(input.location.workspaceID) : undefined,
  ...
})
```

**改动 2：删除 workaround UPDATE 代码**

删除以下代码块（255-263 行）：

```ts
// 写入 user_id（owner），用于多用户隔离
if (input.userID) {
  yield* db
    .update(SessionTable)
    .set({ user_id: input.userID })
    .where(eq(SessionTable.id, sessionID))
    .run()
    .pipe(Effect.orDie)
}
```

**原因：** `user_id` 现在通过 `SessionInfo` → event → projector → INSERT 写入，不需要额外的 UPDATE。

**验证：**
```bash
# 编译检查
pnpm --filter @opencode/core build
```

---

### Step 3：修改 SessionProjector.sessionRow()

**文件：** `packages/core/src/session/projector.ts`

**改动：**
- 在 `sessionRow()` 返回的对象中增加 `user_id: info.user_id`

```ts
function sessionRow(info: SessionV1.SessionInfo): typeof SessionTable.$inferInsert {
  return {
    id: info.id,
    project_id: info.projectID,
    workspace_id: info.workspaceID ?? null,
    user_id: info.user_id,  // 新增
    parent_id: info.parentID,
    ...
  }
}
```

**验证：**
```bash
# 编译检查
pnpm --filter @opencode/core build
```

---

### Step 4：修改 fromRow() 映射 user_id

**文件：** `packages/core/src/session/info.ts`

**改动：**
- 在 `fromRow()` 返回的 `SessionSchema.Info.make()` 中增加 `user_id` 字段

```ts
export function fromRow(row: typeof SessionTable.$inferSelect): SessionSchema.Info {
  return SessionSchema.Info.make({
    id: SessionSchema.ID.make(row.id),
    projectID: ProjectV2.ID.make(row.project_id),
    userID: row.user_id ? UserID.make(row.user_id) : undefined,  // 新增
    title: row.title,
    ...
  })
}
```

**注意：**
- 这里使用 `userID`（驼峰），因为 `SessionSchema.Info` 的字段名是 `userID`
- 需要 import `UserID`：`import { UserID } from "./sql"`

**验证：**
```bash
# 编译检查
pnpm --filter @opencode/core build
```

---

### Step 5：确认后端 session.list 过滤

**文件：** `packages/server/src/handlers/session.ts`

**当前状态：**
```ts
// 已有 userID 过滤
if (input.userID) conditions.push(eq(SessionTable.user_id, input.userID))
```

**改动：** 无需修改，已有过滤逻辑。

**验证：**
- 确认 `listSessions` 中 `userID: user.id` 已传递（已有）

---

### Step 6：确认前端 SDK 传参能力

**文件：** `packages/app/src/components/prompt-input/submit.ts`

**当前状态：**
```ts
const created = await client.session
  .create()  // 无参数
```

**检查点：**
1. 确认 `client.session.create()` 的 TypeScript 类型签名
2. 如果支持传参，传入 `{ userID: currentUser.id }`
3. 如果不支持，保持后端注入方式（不影响功能）

**验证结果：**
- SDK 类型定义 `V2SessionCreateData.body` 仅支持：`id?`、`agent?`、`model?`、`location?`
- **前端 SDK 不支持传入 `userID`**
- 保持现状，依赖后端 handler 注入 `userID: user.id`

**结论：** 无需修改前端代码，后端注入方式已足够。

---

### Step 7：添加数据库索引（可选但建议）

**文件：** `packages/core/src/database/migration/20260625120000_add_user_and_ownership.ts`

**当前状态：**
```ts
// 3. session 表加 user_id 列
yield* tx.run(`ALTER TABLE \`session\` ADD COLUMN \`user_id\` text;`)
yield* tx.run(`CREATE INDEX \`session_user_id_idx\` ON \`session\` (\`user_id\`);`)
```

**结论：** 索引 `session_user_id_idx` 已存在于 stage3 多用户迁移中，无需额外操作。

---

## 4. 文件修改清单

| 文件 | 改动 | 类型 |
|------|------|------|
| `packages/core/src/v1/session.ts` | SessionInfo 加 `user_id` 字段 | 新增字段 |
| `packages/core/src/session.ts` | SessionInfo.make() 传 `user_id`，删除 workaround | 修改 + 删除 |
| `packages/core/src/session/projector.ts` | sessionRow() 写 `user_id` | 新增字段 |
| `packages/core/src/session/info.ts` | fromRow() 读 `user_id` | 新增映射 |
| `packages/server/src/handlers/session.ts` | 无需修改（已有过滤） | - |
| `packages/app/src/components/prompt-input/submit.ts` | 可选：前端传参 | 可选优化 |

## 5. Verification Steps

### 5.1 编译验证
```bash
pnpm --filter @opencode/core build
pnpm --filter @opencode/server build
pnpm --filter @opencode/app typecheck
```

### 5.2 数据库写入验证
1. 以用户 A 登录，新建 session
2. 查询数据库：
   ```sql
   SELECT id, user_id FROM session WHERE id = 'ses_xxx';
   ```
3. 确认 `user_id` 字段已写入用户 A 的 ID

### 5.3 权限检查验证
1. 以用户 A 登录，访问自己的 session → 应成功
2. 以用户 B 登录，访问用户 A 的 session URL → 应返回 "Session not found"
3. admin 访问任意 session → 应成功

### 5.4 列表过滤验证
1. 用户 A 调用 `session.list` → 只返回 `user_id = A` 的 session
2. 用户 B 调用 `session.list` → 只返回 `user_id = B` 的 session

### 5.5 前端 UI 验证
1. 登录用户 A，侧边栏 session 列表只显示用户 A 的 session
2. 登录用户 B，侧边栏 session 列表只显示用户 B 的 session
3. 直接访问其他用户的 session URL → 显示无权限或重定向

## 6. 回滚方案

如果实施后出现问题，回滚步骤：

1. 恢复 `packages/core/src/session.ts` 的 workaround UPDATE 代码
2. 删除 `SessionInfo` 中的 `user_id` 字段
3. 删除 `sessionRow()` 中的 `user_id`
4. 删除 `fromRow()` 中的 `user_id` 映射
5. 重建 core 包

## 7. 注意事项

1. **字段名一致性**：数据库用 `user_id`，`SessionInfo` schema 用 `user_id`，`SessionSchema.Info` 用 `userID`，`fromRow()` 做映射
2. **Effect Schema 兼容性**：新增可选字段不会影响已有事件的序列化/反序列化
3. **历史数据**：已有 session 的 `user_id` 为空，不影响功能，新 session 会写入
4. **并发安全**：删除 workaround 后，`user_id` 通过 event projection 原子写入，不存在竞态

## 8. 预期结果

- 新建 session 时，`user_id` 正确写入数据库
- `session.list` 的 `userID` 过滤生效，用户只能看到自己的 session
- `session.get` 的权限检查正常工作，非 admin 用户无法访问他人的 session
- 多用户系统对普通用户完全可用
