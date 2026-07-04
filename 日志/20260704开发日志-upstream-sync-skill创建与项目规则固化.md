# 2026.07.04 upstream-sync skill 创建与项目规则固化 - 修改说明

## 一、前置操作

本轮无代码改动，纯文档/skill 固化工作。承接上一轮 session 隔离修复 + 技能框注入（commit `43085bbc2` 已推送），用户提出 4 项固化要求：

1. 将拉取上游更新并重新应用自定义改动的流程固化为 skill
2. 统一 commit scope 为 `yejian`，写入项目规则
3. 改动尽量模块化（新功能优先新文件），写入项目规则
4. 维护一份"自定义改动清单"文档，作为合并上游前的高风险点核对清单，写入项目规则

## 二、需求背景

本项目 fork 自 `anomalyco/opencode`，已完成多用户系统 + 悬浮技能框 + new-session 文件树等自定义功能。每次上游更新（如 v1.17.13 → v1.17.14）都需要"两阶段合并"：阶段1全部采纳上游，阶段2重新应用自定义改动。

**痛点**：
- 阶段2 是高风险步骤，凭记忆操作容易遗漏（上一轮就改错了包：SDK 走 `/session` 不走 `/api/session`）
- commit scope 不统一（历史有 `feat(multi-user):` / `feat(skills-panel):` / `fix(app):` 混用）
- 自定义改动散落在多个上游文件里，合并冲突点不清晰
- 没有标准化的合并上游流程文档

**目标**：把经验固化成 skill + 项目规则 + 改动清单，让下次合并上游时有据可依。

## 三、修改文件清单

### 3.1 新建文件

#### 1. `.trae/skills/upstream-sync/SKILL.md`（新文件）

**用途**：标准化上游同步流程的 skill。

**触发词**：拉取上游 / 合并上游 / 同步上游 / 升级 opencode 版本 / sync upstream / merge upstream

**核心内容**：
- 前置准备：确认 upstream remote、读取 `自定义改动.md`、确认当前状态
- 阶段1（全部采纳上游）：`git merge <tag> --allow-unrelated-histories`，冲突时优先 `theirs`，typecheck 验证
- 阶段2（重新应用自定义改动）：按依赖顺序逐个恢复（schema → core → protocol → server → opencode → app），每改一个文件跑一次 typecheck
- 阶段3（提交与标签）：`feat(yejian):` scope + `-yejian-multi-user` 标签后缀，`--no-verify` 绕过 pre-push hook
- 阶段4（更新清单）：同步更新 `自定义改动.md`
- 关键注意事项：双 API 路径架构、V1 user_id 硬编码 null、authorizationLayer 提前 return、UserID brand 类型、标签命名、PowerShell 语法、pre-push hook
- 回滚方案：`git reset --hard backup/pre-sync-yyyymmdd`

**注意**：`.trae/` 被 gitignore 排除，不纳入版本控制，但对 TRAE IDE 工作环境生效（自动加载）。

#### 2. `自定义改动.md`（新文件，项目根目录）

**用途**：合并上游时的高风险点核对清单（活文档，持续更新）。

**核心内容**（5 节）：

1. **上游基线**：当前 `v1.17.13`，最近一次同步 commit `6f91258cf`
2. **改过的上游文件**（高风险点 ⚠️）：
   - 多用户认证系统：12 个后端文件（schema/core/protocol/server/opencode 五层），每个标注改了什么、为什么改
   - 网页端 UI：6 个前端文件（app.tsx/session.tsx/new-session.tsx/session-side-panel.tsx/prompt-input.tsx/vite.config.ts）
   - 依赖：2 个（core/package.json 加 argon2、bun.lock）
   - 测试：3 个（opencode/test/* 加 mock auth）
3. **新建文件**（低风险点 ✅）：
   - 多用户后端：11 个（user/*、auth-token.ts、credential.ts、groups/*、handlers/*、middleware/*）
   - 多用户前端：5 个（auth.tsx、login.tsx、change-password.tsx、settings.tsx、admin/users.tsx）
   - 悬浮技能框：5 个（skills-panel/*）
   - 资源文件：skills.json、skills-panel-icon.png、LOGO.png 等
   - Docker：7 个（Dockerfile、build.ps1、run.ps1 等）
   - 文档：日志.md、自定义改动.md、project_rules.md 等
4. **合并上游检查清单**：合并前/中/后操作步骤，阶段2 按依赖顺序逐个恢复
5. **关键注意事项**：双 API 路径、user_id 硬编码、authorizationLayer、UserID brand、标签命名、PowerShell

#### 3. `.trae/rules/project_rules.md`（修改，新增 4 节）

**新增章节**：

1. **自定义改动统一 scope**：
   - 新 commit 一律用 `feat(yejian):` / `fix(yejian):` / `docs(yejian):`
   - 仅上游原生功能用包名 scope（如 `fix(tui):`）
   - 历史 commit 不回溯改名

2. **模块化改动原则**：
   - 新功能 → 新建独立文件/目录
   - 必须改上游文件时用 `// yejian:` 注释标明
   - 避免"散弹枪修改"

3. **自定义改动清单维护**：
   - 文件位置：`d:\AI\opencode\自定义改动.md`
   - 必须记录：改过的上游文件（高风险）+ 新建文件（低风险）+ 删除/重命名文件
   - 更新时机：每次提交自定义改动后同步更新
   - 合并上游前必做：打开清单 → 重点盯高风险文件 → `git diff upstream-tag..HEAD -- <文件>`

4. **拉取上游更新流程**：
   - 核心 6 步：add remote → fetch tags → merge → 重新应用 → typecheck → 打标签推送
   - 引用 skill `upstream-sync`

**注意**：`.trae/` 被 gitignore 排除，不纳入版本控制，但对 TRAE IDE 工作环境生效。

## 四、踩坑记录

### 坑1：`.trae/` 被 gitignore 排除

- **现象**：`git status` 只显示 `自定义改动.md`，不显示 `.trae/rules/project_rules.md` 和 `.trae/skills/upstream-sync/SKILL.md`
- **验证**：`git check-ignore .trae/rules/project_rules.md` 返回该路径，确认被忽略
- **原因**：`.trae/` 是 TRAE IDE 本地配置目录，被 `.gitignore` 排除
- **影响**：项目规则和 skill 不纳入版本控制，团队其他成员拉取后看不到
- **权衡**：`.trae/` 包含大量 IDE 个人配置（如 `.trae/rules/`、`.trae/skills/`、缓存等），全量纳入会污染仓库。本次接受现状——文档对当前工作环境生效，团队共享靠 `自定义改动.md`（在根目录，已纳入版本控制）

### 坑2：自定义改动清单的准确性挑战

- **现象**：编写 `自定义改动.md` 时，需要回溯所有自定义 commit，确认改了哪些上游文件、新建了哪些文件
- **方法**：用 `git log --oneline --no-merges | Select-Object -Skip 30 -First 50` 翻历史 commit，结合 `Glob` 工具确认新文件存在
- **发现**：历史 commit 跨度大（从 `a02a10562 feat(server): implement auth handlers` 到 `43085bbc2 docs: update commit hashes`），共 30+ 个自定义 commit
- **结果**：清单按功能分组（多用户认证 / 网页端 UI / 依赖 / 测试），每个文件标注改了什么、为什么改

## 五、影响范围

### 5.1 立即生效

- **项目规则**（`.trae/rules/project_rules.md`）：TRAE IDE 自动加载，新 commit 用 `yejian` scope
- **upstream-sync skill**（`.trae/skills/upstream-sync/SKILL.md`）：TRAE IDE 自动加载，用户说"拉取上游"时触发
- **自定义改动清单**（`自定义改动.md`）：已提交（commit `8c2202200`），团队共享

### 5.2 长期影响

- 下次合并上游时，有标准化流程可循，不再凭记忆操作
- commit 历史更清晰（`yejian` scope 一眼区分自定义 vs 上游）
- 新功能开发倾向模块化，减少对上游文件的散弹枪修改
- 团队成员能快速了解自定义改动全貌

## 六、验证步骤

### 6.1 skill 加载验证

skill 文件位于 `.trae/skills/upstream-sync/SKILL.md`，TRAE IDE 自动加载。下次用户说"拉取上游"时，应能触发该 skill。

### 6.2 项目规则加载验证

项目规则位于 `.trae/rules/project_rules.md`，TRAE IDE 自动加载。本次对话的 system-reminder 已显示最新规则内容，确认生效。

### 6.3 自定义改动清单验证

```powershell
cd d:\AI\opencode
git log --oneline -1  # 应看到 8c2202200 docs(yejian): add custom changes manifest for upstream sync
```

## 七、提交列表

| # | Hash | 标题 |
|---|---|---|
| 1 | `8c2202200` | `docs(yejian): add custom changes manifest for upstream sync` |

**注意**：
- 这是首个使用 `yejian` scope 的 commit，标志新规则落地
- `.trae/` 下的项目规则和 skill 不纳入版本控制（被 gitignore 排除），但对当前工作环境生效

## 八、附注

### 8.1 与前期日志的关系

- `20260703开发日志-取消OPENCODE_SERVER_PASSWORD实现多用户隔离.md`：发现 authorizationLayer 提前 return 问题，本轮写入 skill 注意事项
- `20260704开发日志-session隔离修复与new-session文件树复用与技能框注入.md`：发现双 API 路径架构坑，本轮写入 skill 注意事项
- 本轮把上述经验从"日志"固化到"skill + 项目规则 + 改动清单"，从一次性记录升级为可复用资产

### 8.2 `.trae/` 目录的版本控制权衡

`.trae/` 包含 TRAE IDE 的本地配置（规则、skill、缓存等）。当前 `.gitignore` 排除整个 `.trae/` 目录。

**可选方案**（未实施，留待后续讨论）：
- A. 维持现状：`.trae/` 全部忽略，文档仅对本地生效
- B. 部分纳入：`.gitignore` 加 `!.trae/rules/` 和 `!.trae/skills/`，让规则和 skill 团队共享
- C. 复制到根目录：把 `project_rules.md` 和 `SKILL.md` 复制到根目录的 `docs/` 下纳入版本控制

本轮选 A（维持现状），因为 B/C 涉及 gitignore 调整和团队约定，超出了"写日志"范围。

### 8.3 自定义改动清单的维护责任

按项目规则，每次提交自定义改动后，作者需同步更新 `自定义改动.md`。这是**强制要求**，不是可选动作。合并上游时如果发现清单过时，责任在最近一次改动的作者。
