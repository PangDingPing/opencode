# 项目规则

## 推送远程仓库规则

代码需经手动验证后，由用户确认后才能推送远程仓库。

- 修改完成后，先进行本地验证（如运行测试、启动服务检查等）
- 验证通过后，向用户展示改动摘要
- 等待用户明确确认后，再执行 `git push`

## 自定义改动统一 scope

本项目是 fork 自 anomalyco/opencode 的二次开发项目。所有**自定义改动**（非上游原生功能）的 commit message 统一使用 `yejian` 作为 scope，以便与上游改动区分。

- 格式：`type(yejian): summary`
- type 仍遵循 AGENTS.md 的约定（`feat` / `fix` / `docs` / `chore` / `refactor` / `test`）
- 仅上游原生功能的改动才用包名 scope（如 `fix(tui):`、`feat(core):`）
- 历史已提交的 `feat(multi-user):` / `feat(skills-panel):` 等不回溯改名，但**新提交**一律用 `yejian`

示例：
- `feat(yejian): add floating skills panel on session routes`
- `fix(yejian): isolate sessions by user_id in opencode handlers`
- `docs(yejian): update custom changes manifest`

## 模块化改动原则

新增自定义功能**优先放新文件/新目录**，少改上游已有文件。

- 新功能 → 新建独立文件或目录（如 `packages/app/src/components/skills-panel/`、`packages/server/src/handlers/admin.ts`）
- 必须修改上游文件时（如路由注入、类型扩展），改动尽量集中、可识别（用注释标明 `// yejian:` 或 `// 自定义：`）
- 避免"散弹枪修改"——一个功能散落在多个上游文件里
- 新建文件用中文或业务命名（如 `skills-panel`、`admin-users`），与上游 snake/camel 命名风格区分

**原因**：上游更新合并时，改过的上游文件是高风险点（需手动解决冲突），新文件是低风险点（通常自动合并）。模块化能最小化合并冲突面。

## 自定义改动清单维护

项目根目录维护一份 `自定义改动.md`（活文档，持续更新），记录所有对上游的修改。

**文件位置**：`d:\AI\opencode\自定义改动.md`

**必须记录的内容**：

1. **改过的上游文件**（高风险点）
   - 文件路径
   - 改了什么（简述）
   - 为什么改（业务原因）
   - 合并上游时需重点盯这些文件

2. **新建文件**（低风险点）
   - 文件路径
   - 用途

3. **删除/重命名的上游文件**（如果有）

**更新时机**：
- 每次提交自定义改动后，同步更新 `自定义改动.md`
- 每次合并上游后，检查清单是否仍然准确（上游可能重构导致文件路径变化）

**合并上游前必做**：
1. 打开 `自定义改动.md`
2. 重点盯"改过的上游文件"列表
3. 用 `git diff upstream-tag..HEAD -- <文件路径>` 逐个检查冲突

## 拉取上游更新流程

本项目 fork 自 anomalyco/opencode，需定期同步上游更新。完整流程见 skill `upstream-sync`（或同名 skill）。

核心步骤：
1. 添加上游 remote（一次性）：`git remote add upstream https://github.com/anomalyco/opencode.git`
2. 拉取上游 tag：`git fetch upstream --tags`
3. 阶段1（全部采纳上游）：`git merge upstream-tag`（或 rebase）
4. 阶段2（重新应用自定义改动）：参照 `自定义改动.md` 逐个恢复
5. typecheck + 冒烟测试
6. 打标签 `vX.Y.Z-yejian-多用户` 推送远程

**关键原则**：阶段2是高风险步骤，必须参照 `自定义改动.md` 清单逐个核对，不能遗漏。
