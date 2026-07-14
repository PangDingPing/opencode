# Session 按 UserID 隔离方案（数据库层修复）

## 1. Summary

当前 `SessionTable` 已有 `user_id` 字段，但 session 创建链路未将其写入数据库，导致 `session.list` 的 `userID` 过滤始终不生效。本方案仅修复数据库层写入链路，不改动 session ID 格式，通过后端强制过滤实现用户隔离。

## 2. Current State Analysis

| 环节 | 现状 | 问题 |
|------|------|------|
| `SessionTable` | 已有 `user_id: text().$type<UserID>()` | 字段存在但从未写入 |
| `session.create` handler | 传了 `userID: user.id` | 传递正常 |
| Core `session.create` | 接收 `input.userID` | 接收正常 |
| `CreateInput` type | 已有 `userID?: UserID` | 定义正常 |
| `SessionInfo` schema | **没有 `user_id` 字段** | 事件 payload 不携带 |
| `SessionProjector.sessionRow()` | **没有写 `user_id`** | 数据库写入缺失 |
| `session.list` 过滤 | 支持 `userID` 参数 | 因数据库为空，过滤无效 |

**结论**：`user_id` 从 handler → core service 的传递已通，断在 `SessionInfo` schema → event projection → database 写入这一段。

## 3. Proposed Changes

### 3.1 扩展 `SessionInfo` schema，加入 `user_id`

**文件：** `packages/core/src/v1/session.ts`

**改动：**
- 在 `SessionInfo` 的 `Schema.Struct` 中增加 `user_id: UserID.pipe(Schema.optional)`
- 位置：在 `directory` 字段后或 `workspaceID` 字段后添加

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

**原因**：让 `session.created` 事件携带 `user_id`，使 projector 能将其写入数据库。

### 3.2 在 `session.create` 中构建 `SessionInfo` 时传入 `user_id`

**文件：** `packages/core/src/session.ts`

**改动：**
- 在 `V2Session.create` 构建 `SessionV1.SessionInfo.make({...})` 时，加入 `user_id: input.userID`

```ts
const info = SessionV1.SessionInfo.make({
  id: sessionID,
  slug: Slug.create(),
  projectID: project.id,
  directory: input.location.directory,
  user_id: input.userID,  // 新增
  ...
})
```

**原因**：将 handler 传来的 `userID` 注入到事件 payload。

### 3.3 在 `SessionProjector.sessionRow()` 中包含 `user_id`

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
    ...
  }
}
```

**原因**：将事件中的 `user_id` 写入 `SessionTable` 数据库字段。

### 3.4 确认后端 `session.list` 强制过滤 `userID`

**文件：** `packages/server/src/handlers/session.ts`

**改动：**
- 确认 `listSessions` 中已有 `userID: user.id` 过滤逻辑
- 如已有则保持不变，如缺失则补充

**原因**：后端安全边界，确保即使前端绕过，API 也只返回当前用户 session。

### 3.5 确认前端 `client.session.create()` 支持传参

**文件：** `packages/app/src/components/prompt-input/submit.ts`

**改动：**
- 确认 `client.session.create()` 调用时可传入参数
- 如需传参，传入当前用户的 `userID`

**原因**：保持前后端一致性，确保新建 session 时 `userID` 能传到后端。

## 4. Assumptions & Decisions

1. **不改动 session ID 格式**：保持 `ses_<timestamp>` 不变，避免兼容性问题
2. **忽略历史数据**：已有 session 的 `user_id` 保持为空，仅新建 session 写入
3. **`UserID` 类型可复用**：`packages/core/src/user/sql.ts` 已导出 `UserID`，可直接 import
4. **`optionalOmitUndefined` 可用**：`SessionInfo` 中其他可选字段已使用此工具，保持风格一致
5. **前端 SDK 传参能力待确认**：若 SDK 生成的 `create()` 不支持对象参数，需调整前端调用方式

## 5. Verification Steps

1. **数据库写入验证**
   - 以用户 A 登录，新建 session
   - 查询 `SessionTable`，确认 `user_id` 字段已写入用户 A 的 ID
   - 以用户 B 登录，新建 session
   - 查询 `SessionTable`，确认 `user_id` 字段已写入用户 B 的 ID

2. **列表过滤验证**
   - 用户 A 调用 `session.list`，确认只返回 `user_id = A` 的 session
   - 用户 B 调用 `session.list`，确认只返回 `user_id = B` 的 session
   - admin 调用 `session.list`，确认返回所有 session（或按现有 admin 逻辑）

3. **前端 UI 验证**
   - 登录用户 A，侧边栏 session 列表只显示用户 A 的 session
   - 登录用户 B，侧边栏 session 列表只显示用户 B 的 session
   - 直接访问其他用户的 session URL（如 `/:dir/session/:id`），确认无法加载或显示无权限

4. **兼容性验证**
   - 旧 session 链接（无 `user_id`）仍可访问
   - 新建 session 链接正常生成和路由
