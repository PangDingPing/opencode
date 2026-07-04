# 计划：把当前工作提交到 `update-logo` 分支

## 1. 任务概述

把本次"悬浮技能框"所有改动连同未提交的 `日志.md` 更新，按用户要求拆成 **2 个 commit** 提交到当前分支 `update-logo`。根目录的源文件 `yejian/技能库.png` 一并提交。

## 2. 当前状态分析

### 分支与 HEAD

- 当前分支：`update-logo`
- HEAD：`a7556b671 chore(app): use local LOGO1.ico for system notification icon`（仅改了 `entry.tsx:72`）
- 父提交：`5560a83f6 更新日志.md`（在 `dev` 上独立提交；本分支未包含 2026-06-15 LOGO1.ico 那段日志）

### 改动现状

```
$ git status --short
 M packages/app/src/app.tsx                         (+2 行：注入 SkillsPanel)
 M packages/app/src/components/prompt-input.tsx     (1 处字符串：designPlaceholder)
 M packages/app/src/pages/directory-layout.tsx      (+13 -7 行：SkillsPanel 移到 Show 外)
 M packages/app/src/pages/home.tsx                  (+1 行：未使用的 SkillsPanel 导入，需清理)
 M 日志.md                                          (+20 行：2026-06-15 LOGO1.ico 那段本次未提)
?? packages/app/public/yejian/                      (技能库.png + 技能.json)
?? packages/app/src/components/skills-panel/        (6 个新文件)
?? yejian/技能库.png                                (根目录源文件，按用户选择一起提交)
```

### 关键文件状态（已读）

- `packages/app/src/app.tsx:54-128` — DraftRoute 包了 `<SkillsPanel />`，lazy 加载
- `packages/app/src/pages/directory-layout.tsx:84-96` — Layout 把 `<SkillsPanel />` 移到了 `<Show>` 外层
- `packages/app/src/pages/home.tsx:50` — 有一行**未使用**的 `import { SkillsPanel }`（我在迭代过程中加了又删了用法但忘了删 import）
- `packages/app/src/components/prompt-input.tsx:1338-1341` — `designPlaceholder` 返回中文
- `日志.md` — 现在是 23 行（2026-06-15 那段 20 行未提交）

## 3. 提交流程

### 3.1 提交流程

按用户偏好拆成 **2 个 commit**：

#### Commit 1：`feat(app): add floating skills panel with skill library JSON`

包含：
- 新增 6 个组件文件：
  - `packages/app/src/components/skills-panel/index.tsx`
  - `packages/app/src/components/skills-panel/skills-panel.css`
  - `packages/app/src/components/skills-panel/skills-panel-data.ts`
  - `packages/app/src/components/skills-panel/skills-panel-state.ts`
  - `packages/app/src/components/skills-panel/skills-panel-types.ts`
- 新增 2 个静态资源：
  - `packages/app/public/yejian/技能库.png`
  - `packages/app/public/yejian/技能.json`
- 新增 1 个根目录源文件（按用户选择）：
  - `yejian/技能库.png`
- 修改 2 个注入点：
  - `packages/app/src/app.tsx`（DraftRoute 注入 SkillsPanel）
  - `packages/app/src/pages/directory-layout.tsx`（Layout 注入 SkillsPanel）
- 修改 1 个清理点：
  - `packages/app/src/pages/home.tsx`（删除未使用的 `import { SkillsPanel }`，让 home.tsx 在 commit 1 后保持原状）
- 修改 1 个文档点：
  - `日志.md`（在顶部追加 2026-06-16 的"悬浮技能框"条目）

> home.tsx 的 `+1 -1` 净零变更，看起来像是 noop commit，但保证了 ① home.tsx 在新功能分支上不留未使用导入；② 后续 cherry-pick / rebase 时不会引入"漏带 import"的问题。

#### Commit 2：`feat(app): localize prompt-input placeholder`

包含：
- 修改 1 个文件：
  - `packages/app/src/components/prompt-input.tsx`（`designPlaceholder` 字符串改为"请输入交互内容。提示：/ 调用技能；ctrl+\ 显示文件树"）

### 3.2 commit message 模板

提交时使用 HEREDOC 传 commit message（按 AGENTS.md 12-17 行的 conventional commit 规范）：

```
feat(app): add floating skills panel with skill library JSON

Adds a left-side floating skills panel on session pages (/new-session
and /:dir/session/:id?). The panel:
  - shows a 36x192 tab with the yiejian "技能库" icon
  - opens a drawer on hover with 7 skill groups (日常办公 / 审查相关 /
    党群文章 / 经营投标 / 财务相关 / 多模态 / 其它)
  - supports per-group expand/collapse (accordion, state persisted
    via Persist.global)
  - shows a tooltip on each skill (name, description, keyword, case)
  - fills the prompt-input editor with a preset prompt on click
  - reads all data dynamically from /yejian/技能.json

All UI assets (技能库.png, 技能.json) live under packages/app/public/yejian/.
The root-level yejian/技能库.png is the source asset.
```

```
feat(app): localize prompt-input placeholder

Changes the new-design placeholder in prompt-input.tsx from
"Ask anything, / for commands, @ for context..." to a Chinese hint
that mentions the new / skills panel shortcut and ctrl+\ for the
file tree.
```

### 3.3 提交前的 typecheck

按 AGENTS.md 146 行规则"Always run `bun typecheck` from package directories"，提交流程在 commit 之前先在 `packages/app/` 跑一次 `bun typecheck` 确认无新错误。

## 4. 关键假设与决策

1. **不拆成更多 commit**：用户选 2~3，这里用 2。`home.tsx` 的清理在 commit 1 一起做（净零变更）；`日志.md` 文档更新与功能捆绑。
2. **不跑 `git push`**：用户没要求推到远程，仅做本地 commit
3. **不自动 stage `yejian/技能库.png` 之外的其他 untracked**：本工作区没有其他 untracked 噪音
4. **保留 commit 顺序**：先功能（commit 1）后文案（commit 2），让 cherry-pick / rebase 时能干净地只取功能
5. **不修改 HEAD 之前已经提交的 2026-06-15 LOGO1.ico 那段日志**：它已经合并到 dev 了，本次只是顺便把"未提交"的版本继续往前进
6. **不修改 AGENTS.md / package.json / vite 配置**
7. **按用户规则 4.2 把 2026-06-16 工作条目追加到 `日志.md` 顶部**

## 5. 验证步骤

1. **typecheck**：`cd packages/app && bun typecheck` 确认 0 新错误（仅有上游 `message-timeline.tsx:585` 那个非本任务的旧错）
2. **运行 `git status --short` 确认无残留**
3. **运行 `git log --oneline -5` 确认 2 个新 commit 在 `update-logo` 分支顶端**
4. **运行 `git log -1 --stat` 确认 commit 1 的文件清单与计划一致**
5. **运行 `git log -2 --stat` 确认 commit 2 只动了 prompt-input.tsx**
6. **不执行 `git push`**：等用户决定

## 6. 涉及的文件

### 新建（10 个）

- `packages/app/public/yejian/技能库.png`
- `packages/app/public/yejian/技能.json`
- `packages/app/src/components/skills-panel/index.tsx`
- `packages/app/src/components/skills-panel/skills-panel.css`
- `packages/app/src/components/skills-panel/skills-panel-data.ts`
- `packages/app/src/components/skills-panel/skills-panel-state.ts`
- `packages/app/src/components/skills-panel/skills-panel-types.ts`
- `yejian/技能库.png`（根目录源文件，按用户选择提交）

### 修改（4 个）

- `packages/app/src/app.tsx`（commit 1：+2 行）
- `packages/app/src/pages/directory-layout.tsx`（commit 1：+13 -7 行）
- `packages/app/src/pages/home.tsx`（commit 1：+1 -1 行净零，但删未使用 import）
- `packages/app/src/components/prompt-input.tsx`（commit 2：+1 -1 行）
- `日志.md`（commit 1：+N 行追加 2026-06-16 条目 + 已有的 2026-06-15 LOGO1.ico 条目）

### 不动

- `packages/app/src/entry.tsx`（已 commit 在 a7556b671）
- 后端 / 桌面端 / 路由表 / 配置
