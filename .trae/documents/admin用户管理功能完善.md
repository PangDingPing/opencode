# Admin 用户管理功能完善（续）

## 摘要

为 admin 账户的"用户管理"页面（`/admin/users`）补充完整的用户管理功能。**后端已基本完成（API 路由、handler、UserService 方法均已就位），但有 3 处类型错误待修复；前端 4 项工作完全未做（1 个页面重写 + 3 个新增弹窗）**。本计划聚焦于剩余工作。

## 当前状态分析

### 后端已完成（5/5）

| 项 | 文件 | 状态 |
|---|---|---|
| AdminGroup 路由组（8 个端点） | [packages/server/src/groups/admin.ts](file:///d:/AI/opencode/packages/server/src/groups/admin.ts) | ✅ 已声明，全部带 `RequireAdmin` |
| AdminHandler（8 个 handler） | [packages/server/src/handlers/admin.ts](file:///d:/AI/opencode/packages/server/src/handlers/admin.ts) | ✅ 含 `assertNotSelf` + `assertNotLastAdmin` |
| 注册 AdminGroup | [packages/server/src/api.ts](file:///d:/AI/opencode/packages/server/src/api.ts) | ✅ 第 22/27 行 |
| 注册 AdminHandler | [packages/server/src/handlers.ts](file:///d:/AI/opencode/packages/server/src/handlers.ts) | ✅ 第 30/35 行 |
| UserService.updateUser | [packages/core/src/user/index.ts](file:///d:/AI/opencode/packages/core/src/user/index.ts) | ✅ 接口 + 实现 |
| AuthTokenService.revokeAllForUser | [packages/core/src/auth-token/index.ts](file:///d:/AI/opencode/packages/core/src/auth-token/index.ts#L27) | ✅ 第 27 行 |

### 后端待修复（3 处类型错误）

| 文件 | 行号 | 当前代码（错误） | 修复为 |
|---|---|---|---|
| [groups/admin.ts](file:///d:/AI/opencode/packages/server/src/groups/admin.ts#L31) | 31 | `display_name: Schema.String.pipe(Schema.nullable, Schema.optional)` | `display_name: Schema.NullOr(Schema.String).pipe(Schema.optional)` |
| [handlers/admin.ts](file:///d:/AI/opencode/packages/server/src/handlers/admin.ts#L46) | 46 | `Effect.catchAll((e) => Effect.fail(new InvalidRequestError(...)))` | `Effect.mapError((e) => new InvalidRequestError({ message: (e as Error).message }))` |
| [handlers/admin.ts](file:///d:/AI/opencode/packages/server/src/handlers/admin.ts#L64) | 64 | 同上 | 同上 |
| [handlers/admin.ts](file:///d:/AI/opencode/packages/server/src/handlers/admin.ts#L94) | 94 | 同上 | 同上 |

**修复依据**：
- `Schema.nullable` 在 effect 4 中不存在；项目已用 `Schema.NullOr` 模式（参考 [packages/core/src/account.ts:28](file:///d:/AI/opencode/packages/core/src/account.ts#L28)）
- `Effect.catchAll` 在 effect 4 中不存在；项目已用 `Effect.mapError` 模式（参考 [packages/llm/src/tool-runtime.ts:39](file:///d:/AI/opencode/packages/llm/src/tool-runtime.ts#L39)）

### 前端待完成（4 项）

| 项 | 文件 | 状态 |
|---|---|---|
| 重写用户管理页 | [packages/app/src/pages/admin/users.tsx](file:///d:/AI/opencode/packages/app/src/pages/admin/users.tsx) | ❌ 当前仅占位（72 行只显示白名单） |
| 新增用户弹窗 | `packages/app/src/components/admin-user-create-dialog.tsx` | ❌ 未创建 |
| 重置密码弹窗 | `packages/app/src/components/admin-reset-password-dialog.tsx` | ❌ 未创建 |
| 改显示名弹窗 | `packages/app/src/components/admin-edit-user-dialog.tsx` | ❌ 未创建 |

## 约定与决策（沿用原计划）

| 项 | 决策 |
|---|---|
| API 路径前缀 | `/api/admin/users` |
| 鉴权 | 每个端点 `.middleware(RequireAdmin)` |
| 分页 | 不分页（30 人规模） |
| 重置密码 | admin 输入新密码；强制下次改密 |
| 禁用联动 | `disable` 时同时 `revokeAllForUser` |
| 自保护 | 不能对自己执行：删除 / 禁用 / 降级 / 重置密码 / 踢下线 |
| 最后一个 admin | 删除 admin 或 admin→user 降级前查启用 admin 数 ≤1 则拒绝 |
| 前端 UI 形态 | 表格内联操作（每行末尾操作菜单） |
| 反馈方式 | 操作后 refetch 列表 + toast 提示 |
| 二次确认 | 危险操作（删除/踢下线/禁用）用 `useDialog().show()`，不新建组件 |

## 改动文件清单（剩余工作）

### 改动 1：修复后端类型错误（3 处）

**文件 1**：[packages/server/src/groups/admin.ts](file:///d:/AI/opencode/packages/server/src/groups/admin.ts) 第 31 行

```ts
// Before:
display_name: Schema.String.pipe(Schema.nullable, Schema.optional),
// After:
display_name: Schema.NullOr(Schema.String).pipe(Schema.optional),
```

**文件 2**：[packages/server/src/handlers/admin.ts](file:///d:/AI/opencode/packages/server/src/handlers/admin.ts) 3 处 `Effect.catchAll` → `Effect.mapError`

第 46 行（`loadUser` 内）：
```ts
// Before:
userSvc.getUser(id).pipe(
  Effect.catchAll((e) => Effect.fail(new InvalidRequestError({ message: (e as Error).message }))),
)
// After:
userSvc.getUser(id).pipe(
  Effect.mapError((e) => new InvalidRequestError({ message: (e as Error).message })),
)
```

第 64 行（`admin.user.create` 内）和第 94 行（`admin.user.reset-password` 内）同样改法。

### 改动 2：重写 `packages/app/src/pages/admin/users.tsx`

**参照**：现有 [change-password-dialog.tsx](file:///d:/AI/opencode/packages/app/src/components/change-password-dialog.tsx) 的 fetch + Dialog 模式，[useDialog](file:///d:/AI/opencode/packages/ui/src/context/dialog.tsx) 的 `show()` 用法，[showToast](file:///d:/AI/opencode/packages/app/src/utils/toast.tsx) 反馈。

**页面结构**：
```
<div h-dvh w-screen flex flex-col>
  <div flex-1 overflow-y-auto p-8>
    <div max-w-5xl mx-auto flex flex-col gap-6>
      {/* 顶部：标题 + 新增用户按钮 */}
      <div flex justify-between>
        <h1>用户管理</h1>
        <Button onClick={() => dialog.show(() => <AdminUserCreateDialog onDone={refetch} />)}>新增用户</Button>
      </div>

      {/* 用户列表表格 */}
      <table>
        <thead>
          <tr>
            <th>用户名</th><th>显示名</th><th>角色</th><th>状态</th><th>创建时间</th><th>操作</th>
          </tr>
        </thead>
        <tbody>
          <For each={users()}>
            {(user) => (
              <tr classList={{ "opacity-50": user.disabled }}>
                <td>{user.username}</td>
                <td>{user.display_name ?? "—"}</td>
                <td>{user.role === "admin" ? "管理员" : "用户"}</td>
                <td>
                  {user.disabled ? "禁用" : user.must_change_password ? "需改密" : "启用"}
                </td>
                <td>{formatTime(user.time_created)}</td>
                <td>
                  <DropdownMenu>
                    {/* 自己所在行：禁用/降级/删除/重置密码/踢下线 五项灰显 */}
                    <Item onClick={resetPassword} disabled={isSelf}>重置密码</Item>
                    <Item onClick={editDisplayName}>改显示名</Item>
                    <Item onClick={toggleRole} disabled={isSelf}>切换角色</Item>
                    <Item onClick={kickOffline} disabled={isSelf}>踢下线</Item>
                    <Item onClick={toggleDisable} disabled={isSelf}>
                      {user.disabled ? "启用" : "禁用"}
                    </Item>
                    <Item onClick={confirmDelete} disabled={isSelf} danger>删除</Item>
                  </DropdownMenu>
                </td>
              </tr>
            )}
          </For>
        </tbody>
      </table>
    </div>
  </div>
</div>
```

**数据来源**：`GET /api/admin/users` 返回 `{ data: UserInfo[] }`，refetch 在所有操作后调用。

**危险操作二次确认**（删除/踢下线/禁用）：
```ts
const confirmDelete = (user: UserItem) => {
  dialog.show(() => (
    <Dialog title="确认删除" fit>
      <div>确定要删除用户 "{user.username}" 吗？此操作不可恢复。</div>
      <div flex justify-end gap-2>
        <Button variant="ghost" onClick={() => dialog.close()}>取消</Button>
        <Button variant="danger" onClick={async () => {
          const res = await fetch(`/api/admin/users/${user.id}`, { method: "DELETE", credentials: "include" })
          if (res.ok) { showToast({ title: "删除成功" }); dialog.close(); refetch() }
          else { showToast({ title: "删除失败", variant: "error" }) }
        }}>确认删除</Button>
      </div>
    </Dialog>
  ))
}
```

### 新增 3：`packages/app/src/components/admin-user-create-dialog.tsx`

**字段**：
- 用户名：从 `GET /api/auth/allowed-names` 拉白名单下拉，过滤掉已注册的（用 `users` 列表对比）
- 密码：复用 `validatePassword`（8位+字母+数字），从 change-password-dialog 抄过来
- 确认密码
- 角色：admin / user 单选

**提交**：`POST /api/admin/users` `{ username, password, role }`
**成功**：关闭弹窗 + toast + refetch
**失败**：显示错误信息（如"用户名已存在"→409，"密码强度不足"→400）

### 新增 4：`packages/app/src/components/admin-reset-password-dialog.tsx`

**字段**：
- 新密码（带强度校验）
- 确认新密码
- 提示文字："用户下次登录需修改密码"

**提交**：`POST /api/admin/users/:id/reset-password` `{ newPassword }`
**成功**：关闭弹窗 + toast + refetch

### 新增 5：`packages/app/src/components/admin-edit-user-dialog.tsx`

**字段**：
- 显示名（display_name，可清空，传 null 表示清空）
- 当前值作为初始值

**提交**：`PATCH /api/admin/users/:id` `{ display_name }`
**成功**：关闭弹窗 + toast + refetch

## 自保护与安全规则（前端体现）

| 操作 | 自己所在行 |
|---|---|
| 删除用户 | 灰显 + 不可点 |
| 禁用用户 | 灰显 + 不可点 |
| 切换角色（admin→user） | 灰显 + 不可点 |
| 重置密码 | 灰显 + 不可点 |
| 踢人下线 | 灰显 + 不可点 |
| 改显示名 | 允许 |
| 启用用户 | 允许（自己本来就是启用状态，无意义但不禁用） |

## 验证步骤

### 后端验证

1. 从 `packages/opencode` 运行 `bun typecheck`，确认仅剩 effect 版本冲突的预存错误（非本次改动引入）
2. 启动 dev 服务器：`bun run --conditions=browser ./src/index.ts serve`
3. 用 admin cookie 测试：
   - `GET /api/admin/users` → 200 + 用户列表
   - `POST /api/admin/users` 创建新用户 → 200
   - `DELETE /api/admin/users/<自己id>` → 403
   - `POST /api/admin/users/:id/disable` → 该用户原 cookie 立即失效

### 前端验证

1. 从 `packages/app` 运行 `bun dev`
2. admin 登录后访问 `/admin/users`：
   - 看到完整用户列表表格
   - 点"新增用户" → 弹窗 → 选白名单用户名 + 填密码 + 选角色 → 提交成功 → 列表刷新
   - 点"重置密码" → 弹窗 → 填新密码 → 提交成功 → toast 提示
   - 点"禁用" → 二次确认 → 该用户状态变"禁用"
   - 点"踢人下线" → 二次确认 → toast 提示
   - 点"删除" → 二次确认 → 列表移除该用户
   - 自己所在行：5 项危险操作灰显不可点
3. 切换为普通用户登录 → 访问 `/admin/users` → 显示"无权访问"
4. 禁用某用户后，该用户原浏览器标签刷新 → 被踢回登录页

## 假设

- 不做操作审计日志（可作为后续扩展）
- 不做批量操作（30 人规模不需要）
- 不做搜索/筛选（30 人一屏可显示完）
- 不做用户详情页（表格内联操作已足够）
- 复用现有 `useDialog` 机制做二次确认，不引入新弹窗组件库
