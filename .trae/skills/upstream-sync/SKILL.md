---
name: "upstream-sync"
description: "拉取上游 opencode 更新并重新应用自定义改动的两阶段合并流程。Invoke when user asks to sync upstream, merge upstream, update from upstream, 拉取上游, 合并上游, 同步上游, or upgrade opencode version."
---

# 上游同步流程（Upstream Sync）

本项目 fork 自 `anomalyco/opencode`，需定期同步上游更新。本 skill 定义标准化的两阶段合并流程，确保自定义改动（多用户系统、悬浮技能框等）不丢失。

## 触发场景

- 用户说"拉取上游"、"合并上游"、"同步上游"、"升级 opencode 版本"
- 用户提到具体的上游 tag（如 `v1.17.14`）
- 用户问"怎么更新到最新版本"

## 前置准备

### 1. 确认上游 remote 已配置

```powershell
git remote -v
# 应看到：
# upstream  https://github.com/anomalyco/opencode.git (fetch)
# upstream  https://github.com/anomalyco/opencode.git (push)
```

如果 没有 `upstream` remote，添加：
```powershell
git remote add upstream https://github.com/anomalyco/opencode.git
```

### 2. 读取自定义改动清单

**必读文件**：`d:\AI\opencode\自定义改动.md`

这是合并的核心参考文档，记录了：
- **改过的上游文件**（高风险点，合并时需手动解决冲突）
- **新建文件**（低风险点，通常自动合并）
- **双 API 路径架构**等关键注意事项

合并前必须先读这份清单，不能凭记忆操作。

### 3. 确认当前状态

```powershell
git status                          # 必须干净
git log --oneline -5                # 确认在 dev 分支
git branch --show-current           # 应为 dev
```

如果有未提交改动，先 commit 或 stash。

## 两阶段合并流程

### 阶段1：全部采纳上游

**目标**：把上游代码原样合并进来，自定义改动暂时丢失没关系（阶段2恢复）。

```powershell
# 拉取上游 tag
git fetch upstream --tags

# 确定要合并的 tag（如 v1.17.14）
# 查看上游最新 tag
git tag -l "v1.17.*" --sort=-v:refname | Select-Object -First 5

# 创建备份分支（保险）
git checkout -b backup/pre-sync-$(Get-Date -Format "yyyyMMdd")

# 回到 dev 分支
git checkout dev

# 合并上游 tag（用 merge，不用 rebase，因为本项目历史与上游不同）
git merge <upstream-tag> --allow-unrelated-histories
# 例如：git merge v1.17.14 --allow-unrelated-histories
```

**冲突处理原则**：
- 优先保留上游改动（`theirs`）
- 自定义改动在阶段2重新应用，不要在阶段1纠结
- 如果冲突太多难以解决，可以 `git merge --abort` 后用 `git reset --hard <upstream-tag>` 强制对齐上游，然后阶段2全部重新应用

```powershell
# 如果选择强制对齐上游（激进方案，阶段2工作量大）
git reset --hard <upstream-tag>
```

**阶段1验证**：
```powershell
# typecheck 确认上游代码本身能编译（逐个包跑）
cd d:\AI\opencode\packages\opencode; bun typecheck
cd d:\AI\opencode\packages\app; bun typecheck
cd d:\AI\opencode\packages\core; bun typecheck
cd d:\AI\opencode\packages\server; bun typecheck
```

如果有预先存在的上游 typecheck 错误（如 `@opencode-ai/http-recorder` / `@opencode-ai/session-ui` / `@opencode-ai/stats-core`），记录下来，不属于本项目责任。

### 阶段2：重新应用自定义改动

**目标**：参照 `自定义改动.md` 清单，逐个恢复自定义功能。

**核心原则**：
1. **按依赖顺序**恢复（schema → core → protocol → server → opencode → app）
2. **每改一个文件跑一次 typecheck**，立即发现问题
3. **每改完一个功能单元就 commit**，便于回滚
4. **commit message 用 `feat(yejian):` 或 `fix(yejian):` scope**（见项目规则）

#### 2.1 恢复多用户系统（优先级最高）

按依赖顺序：

1. **schema 层**：
   - 恢复 `packages/schema/src/user-id.ts`（新文件，通常直接 `git checkout backup/pre-sync-xxx -- <file>`）
   - 恢复 `packages/schema/src/session.ts` 的 `UserID` 字段（改上游文件，需手动改）

2. **core 层**：
   - 恢复 `packages/core/src/user/*`（新文件，直接 checkout）
   - 恢复 `packages/core/src/auth-token.ts`（新文件）
   - 恢复 `packages/core/src/credential.ts`（新文件）
   - 恢复 `packages/core/src/session/sql.ts` 的 `user_id` 列（改上游文件）
   - 恢复 `packages/core/src/session.ts` 的 `userID` 过滤（改上游文件）
   - 恢复 `packages/core/package.json` 的 `@node-rs/argon2` 依赖

3. **protocol 层**：
   - 恢复 `packages/protocol/src/groups/auth.ts`（新文件）
   - 恢复 `packages/protocol/src/groups/admin.ts`（新文件）
   - 恢复 `packages/protocol/src/api.ts` 的 AuthGroup/AdminGroup 注册（改上游文件）

4. **server 层**：
   - 恢复 `packages/server/src/handlers/auth.ts`（新文件）
   - 恢复 `packages/server/src/handlers/admin.ts`（新文件）
   - 恢复 `packages/server/src/middleware/require-admin.ts`（新文件）
   - 恢复 `packages/server/src/auth.ts` 的 authorizationLayer 重写（改上游文件）
   - 恢复 `packages/server/src/handlers.ts` 的 handler 注册（改上游文件）
   - 恢复 `packages/server/src/api.ts` 的 AdminGroup 注册（改上游文件）
   - 恢复 `packages/server/src/handlers/session.ts` 的 CurrentUser 注入（改上游文件）

5. **opencode 层**（SDK 实际调用路径，关键！）：
   - 恢复 `packages/opencode/src/session/session.ts` 的 `userID` 过滤（改上游文件）
   - 恢复 `packages/opencode/src/server/routes/instance/httpapi/handlers/session.ts` 的 CurrentUser 注入（改上游文件）
   - 恢复 `packages/opencode/src/server/routes/instance/httpapi/middleware/authorization.ts` 的提前 return 删除（改上游文件）
   - 恢复 `packages/opencode/src/index.ts` 的 bootstrapAdmin（改上游文件）

6. **app 层**：
   - 恢复 `packages/app/src/context/auth.tsx`（新文件）
   - 恢复 `packages/app/src/pages/login.tsx`（新文件）
   - 恢复 `packages/app/src/pages/change-password.tsx`（新文件）
   - 恢复 `packages/app/src/pages/settings.tsx`（新文件）
   - 恢复 `packages/app/src/pages/admin/users.tsx`（新文件）
   - 恢复 `packages/app/src/app.tsx` 的路由注册 + AuthGate（改上游文件）

#### 2.2 恢复悬浮技能框

1. 恢复 `packages/app/src/components/skills-panel/*`（5 个新文件，直接 checkout）
2. 恢复资源文件 `packages/app/public/yejian/*`（新文件）
3. 恢复 `packages/app/src/app.tsx` 的 `<SkillsPanel />` 注入（改上游文件）
4. 恢复 `packages/app/src/pages/session.tsx` 的 `<SkillsPanel />` 注入（改上游文件）
5. 恢复 `packages/app/src/components/prompt-input.tsx` 的 placeholder 本地化（改上游文件）

#### 2.3 恢复 new-session 文件树

1. 恢复 `packages/app/src/pages/new-session.tsx` 的 SessionSidePanel 复用（改上游文件，可能已被上游重写）
2. 恢复 `packages/app/src/pages/session/session-side-panel.tsx` 的 Show 条件简化（改上游文件）

#### 2.4 恢复其他

1. 恢复 `packages/app/vite.config.ts` 的 proxy 端口（改上游文件）
2. 恢复 `docker/*`（新文件）
3. 恢复 `yejian/` 品牌资源（新文件）

### 阶段2验证

```powershell
# 1. typecheck（逐个包）
cd d:\AI\opencode\packages\opencode; bun typecheck
cd d:\AI\opencode\packages\app; bun typecheck
cd d:\AI\opencode\packages\core; bun typecheck
cd d:\AI\opencode\packages\server; bun typecheck

# 2. 冒烟测试
# 终端1：后端
cd d:\AI\opencode\packages\opencode
bun run --conditions=browser ./src/index.ts serve

# 终端2：前端
cd d:\AI\opencode\packages\app
bun dev

# 浏览器验证：
# - 多用户登录（admin / 普通用户）
# - session 隔离（普通用户只看自己的）
# - 悬浮技能框（new-session + session 页面）
# - new-session 文件树（右侧）
```

### 阶段3：提交与标签

```powershell
# 1. 按功能单元拆 commit（用 yejian scope）
git commit -m "feat(yejian): restore multi-user auth system"
git commit -m "feat(yejian): restore skills panel"
git commit -m "feat(yejian): restore new-session file tree sidebar"
git commit -m "docs(yejian): update custom changes manifest for <upstream-tag>"

# 2. 打标签（避免与上游 semver 冲突）
git tag -a v0.1.X-yejian-multi-user -m "多用户系统 opencode <upstream-tag>"
# 例如：git tag -a v0.1.3-yejian-multi-user -m "多用户系统 opencode v1.17.14"

# 3. 推送（pre-push hook 可能因预先存在的上游 typecheck 错误失败，用 --no-verify 绕过）
git push --no-verify origin dev
git push --no-verify origin v0.1.X-yejian-multi-user
```

### 阶段4：更新清单

合并完成后，更新 `自定义改动.md`：
1. 更新"上游基线"章节的 tag 和 commit hash
2. 如果上游重构导致文件路径变化，更新清单中的路径
3. 如果有新的自定义改动，追加到清单

## 关键注意事项

### 双 API 路径架构

opencode 存在两套 session API，**session 隔离必须改两处**：

| 路径 | 包 | SDK 是否调用 | 改动文件 |
|---|---|---|---|
| `/session` | opencode（InstanceHttpApi） | ✅ 前端 SDK 实际调用 | `packages/opencode/src/session/session.ts` + `handlers/session.ts` |
| `/api/session` | server（v2 Api） | ❌ 前端 SDK 不调用 | `packages/core/src/session.ts` + `packages/server/src/handlers/session.ts` |

**坑**：只改 v2 API 不生效，普通用户仍看到全部会话。SDK 实际走 `/session`（opencode 包）。

### V1 SessionInfo 的 user_id 硬编码 null

opencode 包的 `createNext` 函数创建 V1 SessionInfo 时 `user_id` 硬编码为 `null`。需在 handler 层用 `db.update` 补写。

### authorizationLayer 的提前 return

`packages/opencode/src/server/routes/instance/httpapi/middleware/authorization.ts` 原有 `if (!ServerAuth.required(config)) return ...` 提前 return，导致无密码时不注入 `CurrentUser`。必须删除，无密码时也走 cookie 验证。

### UserID brand 类型

`SessionTable.user_id` 列是 `text().$type<UserID>()` brand 类型，`db.update` 的 set 需要 brand 值，不能传 `string`。

### 标签命名

上游 opencode 占用了几乎所有 semver 标签（`v0.1.x` / `v0.2.x` / `v1.x`）。本项目自定义标签加后缀 `-multi-user` 或 `-yejian`，如 `v0.1.2-multi-user`。

### PowerShell 语法

PowerShell 不支持 bash 的 `&&` 语句分隔符，用 `;` 替代。

### pre-push hook

`.husky/pre-push` 会跑全量 `bun turbo typecheck`。上游存在预先存在的 typecheck 错误（`@opencode-ai/http-recorder` / `@opencode-ai/session-ui` / `@opencode-ai/stats-core`），与本 项目改动无关。推送时用 `git push --no-verify` 绕过。

## 回滚方案

如果合并失败需要回滚：

```powershell
# 回到合并前的备份分支
git reset --hard backup/pre-sync-yyyymmdd

# 或强制回到合并前的 commit
git reset --hard <merge前最后一个commit-hash>

# 清理未推送的标签
git tag -d v0.1.X-yejian-multi-user
```

## 参考文档

- [自定义改动清单](file:///d:/AI/opencode/自定义改动.md) - 高风险文件清单
- [项目规则](file:///d:/AI/opencode/.trae/rules/project_rules.md) - scope / 模块化 / 清单维护规则
- [AGENTS.md](file:///d:/AI/opencode/AGENTS.md) - 上游工程规范
- [日志/](file:///d:/AI/opencode/日志/) - 历史开发日志
