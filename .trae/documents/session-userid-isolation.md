# Session 按 UserID 隔离方案

## 1. Summary

当前 `SessionTable` 虽已有 `user_id` 字段，但 session 创建链路并未将其写入数据库，导致后端 `session.list` 的 `userID` 过滤始终不生效。本方案按用户选择，通过**修改 session ID 生成格式**，在 session 编号中嵌入 `userID`，实现按用户隔离会话列表。

## 2. Current State Analysis

| 组件 | 现状 |
|------|------|
| `SessionTable.user_id` | 字段存在，但 `SessionProjector.sessionRow()` 未写入，实际为空 |
| `session.create` | 接受 `input.userID`，但仅传递给事件 payload，未进入 `SessionInfo` 或数据库 |
| `session.list` | 支持 `userID` 过滤参数，但因数据库字段为空，过滤无效 |
| `SessionSchema.ID.create()` | 生成固定格式 `ses_` + `Identifier.descending()`，不包含用户信息 |
| 前端 `submit.ts` | 调用 `client.session.create()` 时不传任何参数 |
| 后端 `session.create` handler | 传了 `userID: user.id`，但 core service 未消费 |

## 3. Proposed Changes

### 3.1 修改 session ID 生成逻辑

**文件：** `packages/core/src/session/schema.ts`

**改动：**
- 将 `SessionSchema.ID.create()` 从无参改为接受可选的 `userID` 参数
- 当提供 `userID` 时，生成格式：`ses_<userID>_<timestamp>`
- 当不提供时，保持原有格式：`ses_<timestamp>`，保证向后兼容

```ts
create: (userID?: string) =>
  userID
    ? schema.make(`ses_${userID}_${Identifier.descending()}`)
    : schema.make("ses_" + Identifier.descending()),
```

### 3.2 在 session.create 中传入 userID

**文件：** `packages/core/src/session.ts`

**改动：**
- 在 `V2Session.create` 中，将 `input.userID` 传递给 `SessionSchema.ID.create(input.userID)`

```ts
const sessionID = input.id ?? SessionSchema.ID.create(input.userID)
```

### 3.3 前端创建 session 时传入 userID

**文件：** `packages/app/src/components/prompt-input/submit.ts`

**改动：**
- `client.session.create()` 调用时传入当前用户的 `userID`

需要通过 `useCurrentUser()` 或类似上下文获取当前用户 ID。

### 3.4 后端 session.create handler 确认 userID 传递

**文件：** `packages/server/src/handlers/session.ts`

**改动：**
- 确认 `session.create` 调用时 `userID: user.id` 被传递（当前代码已存在，保持）

### 3.5 过滤逻辑增强

**文件：** `packages/core/src/session.ts` 及 `packages/server/src/handlers/session.ts`

**改动：**
- `session.list` 的过滤逻辑可保留现有 `userID` 字段过滤
- 新增基于 session ID 前缀的过滤作为补充（可选，用于兜底）

## 4. Assumptions & Decisions

1. **session ID 格式变更仅影响新建 session**，已有 session 保持原 ID 不变（用户确认忽略历史数据）。
2. `userID` 在 `SessionTable.user_id` 中仍为空，隔离主要依赖 ID 前缀匹配。
3. `Identifier.descending()` 生成的字符串可安全嵌入 ID，不包含下划线以外的特殊字符。
4. 前端需确保创建 session 时能获取到当前登录用户的 `userID`。

## 5. Verification Steps

1. 以用户 A 登录，新建 session，确认 session ID 包含用户 A 的 userID
2. 以用户 B 登录，新建 session，确认 session ID 包含用户 B 的 userID
3. 用户 A 查看 session 列表，确认只能看到包含自己 userID 的 session
4. 用户 B 查看 session 列表，确认只能看到包含自己 userID 的 session
5. admin 查看 session 列表，应能看到所有 session（或按现有 admin 逻辑处理）
