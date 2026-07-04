# multi-user-system 分支合并至 dev 并打标签 v0.1

## 时间

2026-07-04

## 需求背景

`multi-user-system` 分支是实际开发使用的主分支，承载了多用户系统的全部功能（User/AuthToken 数据层、cookie 认证、会话所有权隔离、admin 用户管理、登录/改密/设置页面等）。但该分支与 `dev` 分支**没有共同历史**（早期 `.git` 目录丢失，最早提交为 `d420252d7 chore: recover workspace after .git directory loss`），导致无法用常规方式合并。需要将 `multi-user-system` 的内容合并到 `dev` 分支，并打标签 `v0.1` 标记版本。

## 备选方案

1. **常规合并 `git merge`**：失败，因两分支无共同祖先，git 报 `refusing to merge unrelated histories`
2. **`--allow-unrelated-histories` 强制合并**：产生 100+ 文件冲突，涵盖核心代码、图标资源（distinct types，符号链接 vs 普通文件）、脚本等，手动解决不现实
3. **用 multi-user-system 覆盖 dev**（用户选择）：用 `git read-tree --reset -u multi-user-system` 把工作区和索引替换为 multi-user-system 的文件树，但保留 dev 的 HEAD 历史血统，然后作为一个新提交提交。会丢失 dev 上有但 multi-user-system 没有的上游更新（那些是上游 sst/opencode 的历史，本项目不需要）
4. **放弃合并，保留两分支独立**：最简单，但完全丢弃 dev 的历史血统
5. **手动 cherry-pick 多用户系统相关改动**：由于历史不相关，cherry-pick 仍会冲突，需逐个手动移植

最终用户选择方案 3。

## 文件改动

本次合并是一个覆盖式提交，将 `multi-user-system` 的完整文件树覆盖到 `dev` 上。

**合并提交**：`859f44c3e`（`merge: overlay multi-user-system content onto dev (unrelated histories)`）

**变更规模**：204 个文件，+5968 / -1025 行

**主要新增内容**（来自 multi-user-system）：

- 数据层：
  - `packages/core/src/user/index.ts`（新建，User 实体和 CRUD）
  - `packages/core/src/user/sql.ts`（新建，User SQL 查询）
  - `packages/core/src/user/allowed-names.ts`（新建，用户名白名单）
  - `packages/core/src/auth-token/index.ts`（新建，AuthToken 实体）
  - `packages/core/src/auth-token/sql.ts`（新建，AuthToken SQL 查询）
  - `packages/core/src/database/migration/20260625120000_add_user_and_ownership.ts`（新建迁移）
  - `packages/core/src/database/migration/20260625120001_seed_initial_users.ts`（新建种子数据）

- 后端认证与权限：
  - `packages/server/src/middleware/auth.ts`（新建，cookie 认证中间件）
  - `packages/server/src/middleware/require-admin.ts`（新建，admin 权限校验）
  - `packages/server/src/groups/admin.ts`（新建，8 个 admin 端点）
  - `packages/server/src/groups/auth.ts`（新建，登录/登出/改密端点）
  - `packages/server/src/handlers/admin.ts`（新建，admin handler 实现）
  - `packages/server/src/handlers/auth.ts`（新建，auth handler 实现）

- 前端页面与组件：
  - `packages/app/src/pages/login.tsx`（新建，登录页）
  - `packages/app/src/pages/change-password.tsx`（新建，改密页）
  - `packages/app/src/pages/settings.tsx`（新建，账号设置页）
  - `packages/app/src/pages/admin/users.tsx`（新建，admin 用户管理页）
  - `packages/app/src/components/admin-user-create-dialog.tsx`（新建）
  - `packages/app/src/components/admin-reset-password-dialog.tsx`（新建）
  - `packages/app/src/components/admin-edit-user-dialog.tsx`（新建）
  - `packages/app/src/components/change-password-dialog.tsx`（新建）
  - `packages/app/src/components/user-menu.tsx`（新建）
  - `packages/app/src/context/auth.tsx`（新建，前端认证上下文）

- 会话所有权隔离（修改）：
  - `packages/core/src/session/info.ts`、`schema.ts`、`projector.ts`、`sql.ts`、`session.ts` 增加 user_id 字段和过滤
  - `packages/opencode/src/server/routes/instance/httpapi/handlers/session.ts`、`sync.ts` 增加所有权校验
  - `packages/server/src/middleware/authorization.ts`、`session-location.ts` 增加用户校验

- 开发日志：`日志/` 目录下 12 个日志文件 + `日志.md` 更新

**主要文件类型变更**：

- 大量图标文件从符号链接（mode 120000）变为普通文件（mode 100644）：favicon、apple-touch-icon、social-share 等。这是 multi-user-system 分支原本的状态（.git 丢失后重建时符号链接被解析成了实体文件），不是本次合并引入的问题。

**删除的文件**：

- `.opencode/.gitignore`、`.opencode/themes/.gitignore`
- `.vscode/launch.example.json`、`.vscode/settings.example.json`
- `packages/opencode/script/build-node.ts`

**新增的临时文件**（需后续清理）：

- `admin_cookie.txt`、`cookie.txt`（测试 cookie 文件，被跟踪，建议清理）

## 影响范围

- **dev 分支内容**：与 `multi-user-system` 完全一致（`git diff dev multi-user-system` 无差异）
- **dev 分支历史**：保留 dev 的历史血统，multi-user-system 的内容作为一个合并提交 `859f44c3e` 叠加在 dev 之上
- **远程仓库**：dev 分支和 v0.1 标签已推送到 `origin`
- **multi-user-system 分支**：保持不变，可继续作为开发分支使用，或后续删除

## 踩坑记录

1. **`git merge` 失败**：两分支无共同历史，git 默认拒绝合并，报 `fatal: refusing to merge unrelated histories`
2. **`--allow-unrelated-histories` 产生大量冲突**：100+ 文件冲突，包括：
   - `add/add` 冲突：两边都新增了同名文件但内容不同
   - `distinct types` 冲突：一边是符号链接（120000），一边是普通文件（100644），git 无法自动合并，会把两边都保留并改名
3. **PowerShell 不支持 heredoc**：`git commit -m "$(cat <<'EOF' ... EOF)"` 在 PowerShell 下报 `Missing file specification after redirection operator`，改用多个 `-m` 参数解决
4. **`git push` 输出 `Everything up-to-date`**：实际已成功推送，通过 `git ls-remote` 验证远程 refs 已更新。可能是这个 git 版本在 `.husky/pre-push` 钩子作用下的输出行为

## 验证步骤

1. `git diff dev multi-user-system --stat`：无差异，确认 dev 内容与 multi-user-system 完全一致
2. `git status`：工作区干净，dev 领先 origin/dev 1 个提交
3. `git log --oneline -5 dev`：合并提交 `859f44c3e` 在最顶部
4. `git show v0.1 --no-patch`：标签 v0.1 指向 `859f44c3e`，备注"数智办公系统-多用户版 opencode v1.17.6"
5. `git ls-remote --tags origin v0.1`：远程已存在 `refs/tags/v0.1` → `292ae9d9`
6. `git ls-remote --heads origin dev`：远程 dev 指向 `859f44c3e`

## 标签信息

- **标签名**：`v0.1`（annotated tag）
- **备注**：数智办公系统-多用户版 opencode v1.17.6
- **指向提交**：`859f44c3e`（merge: overlay multi-user-system content onto dev）
- **创建时间**：2026-07-04 16:44:06 +0800
- **Tagger**：Pang Dingping

## commit hash

- 合并提交：`859f44c3e3ec8ea76c96690d70f845c5d1dfb2d6`
- 标签对象：`292ae9d933041d27ee5eda50d201d20faf794a31`（v0.1）

## 已知遗留

- `admin_cookie.txt` 和 `cookie.txt` 两个测试 cookie 文件被跟踪，建议后续从版本控制中移除（`git rm` + 提交）
- 大量图标文件从符号链接变成了普通文件，是 multi-user-system 分支原本的状态，本次合并未修复
- dev 分支历史血统保留了上游 sst/opencode 的历史，但内容上丢失了 dev 上有而 multi-user-system 没有的上游更新（本项目不需要那些更新）
- 未做合并后的功能回归测试（建议启动前后端服务测试多用户功能）
