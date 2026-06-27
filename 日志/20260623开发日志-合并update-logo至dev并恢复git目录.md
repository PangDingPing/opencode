# 2026-06-23 合并 update-logo 至 dev 并恢复 .git 目录

> 一次计划中的分支合并，演变成 **`.git` 目录丢失**的灾难恢复。完整记录给将来避坑。

---

## 一、需求背景

`update-logo` 分支自 6-15 创建以来累计 50 个 commit（品牌定制 / 技能框重构 / docker v0.0.5 等），需要合并到 `dev` 作为下一次发布的基线。

按项目规则"默认分支是 dev"，所以 `update-logo → dev` 是 fast-forward 合并。

---

## 二、执行过程（按时间顺序）

### 阶段 1：本地 git 状态摸底

```
$ git rev-parse HEAD dev update-logo origin/dev
5560a83f61a0f4a8d2e5cc8c55d9920d85822997  # HEAD = dev = 5560a83f
d14d912caeee7cd71a65e8f59b941a2a35e6a61c  # update-logo
5560a83f61a0f4a8d2e5cc8c55d9920d85822997  # origin/dev

$ git merge-base dev update-logo
5560a83f61a0f4a8d2e5cc8c55d9920d85822997
```

- `merge-base = dev HEAD`，说明 `update-logo` 领先 dev 50 commit
- 理论上是**纯 fast-forward 合并**

### 阶段 2：dev 上有 5488 行 git status 输出

dev 工作区有大量未提交修改（约 400+ 文件）：删除 e2e 测试、改 docker 配置、删 .vscode/.opencode/ 资源等，**实际是手工复制粘贴的 update-logo 内容**（与 update-logo 的 50 commit 增量 ~60767 行匹配）。

### 阶段 3：第一次 `git merge update-logo --ff-only` 失败

```
error: Your local changes to the following files would be overwritten by merge:
    docker/Dockerfile
    docker/build.ps1
    ...
error: The following untracked working tree files would be overwritten by merge:
    docker/requirements.txt
    packages/app/public/yejian/skills.json
    ...
Aborting
```

### 阶段 4：改用 stash 方案

```powershell
git stash push -u -m "wip: dev local changes before merging update-logo"  # 成功
git status --short  # → 0 行，工作区干净
```

### 阶段 5：fast-forward merge 成功 ✅

```
Updating 5560a83f6..d14d912ca
Fast-forward
 43 files changed, 60767 insertions(+), 146 deletions(-)
```

### 阶段 6：`git stash pop` 失败 + **.git 目录消失** 💥

```
CONFLICT (rename/delete): yejian/20260613开发日志-...md renamed to 日志/...md
  in Updated upstream, but deleted in Stashed changes.
...
error: could not restore untracked files from stash
fatal: not a git repository: 'D:/AI/opencode/.git'
```

`Test-Path .git` 返回 `False`，**整个 `.git` 目录消失**：
- HEAD、refs、objects、stash 全丢
- `代码/`、`日志.md` 等 untracked 还在工作区（untracked 文件不受 .git 删除影响）

### 阶段 7：调查 + 决策

- 怀疑 Trae IDE 工作区 watcher / Windows Defender 误删（无确凿证据）
- 工作区里的 43 个文件、60767 行**就是合并后的 update-logo 内容**（物理上合并已达成）
- 决定采用**方案 A：完整克隆恢复**

### 阶段 8：尝试 clone 远端 — 被 GFW 屏蔽

`https://github.com/PangDingPing/opencode.git`：
- DNS 正常：`github.com → 20.205.243.166`
- Ping 60ms 通
- **TCP 443 失败**：`Recv failure: Connection was reset`（GFW 屏蔽）

试 `https://ghfast.top/...` 镜像：同样 21 秒超时。

### 阶段 9：Watt Toolkit 加速无效

- 用户启动 `Steam++`（Watt Toolkit 主进程）→ `netsh winhttp show proxy` 仍为 Direct（用的是 TUN 模式而非系统代理）
- `git fetch --depth=1 origin dev` 仍然 `Connection was reset`
- 推测：TUN 模式未生效 / GitHub 加速未启用 / 加速节点故障

### 阶段 10：换 SSH 协议（22 端口）成功 ✅

- `Test-NetConnection github.com -Port 22` → `TcpTestSucceeded : True`
- 用户配置了 GitHub SSH key
- 改 `git remote set-url origin git@github.com:PangDingPing/opencode.git`
- `git fetch --depth=100 origin` → 成功，55.19 MiB / 5.12 MiB/s

### 阶段 11：Trae IDE denylist 拦截 .git

```
fatal: Unable to create 'D:/AI/opencode/.git/shallow.lock': File exists.
...
Refuse to delete or operate 'd:\ai\opencode\.git': path in denylist
Not allowed to delete or operate files under these paths:
  d:\ai\opencode\.vscode
  d:\ai\opencode\.trae\mcp.json
  d:\ai\opencode\.git
```

Trae agent 调用无法删除 `.git/shallow.lock`。**用户切换到独立 PowerShell 手动跑后续命令**才得以继续。

### 阶段 12：在 D:\AI\opencode 目录 `git init` 重建

```powershell
git init                                    # 重建 .git
git remote add origin git@github.com:...   # 配 SSH
git remote set-url origin git@github.com:...
```

### 阶段 13：fast-forward 合并（简化版）

```powershell
git fetch --depth=100 origin                # 拉所有分支
git branch -f dev origin/update-logo        # dev 直接指向 update-logo HEAD
git reset --hard origin/update-logo         # 强制对齐工作区（保留 untracked）
git checkout dev                            # 切到 dev（HEAD 跟到 dev）
git branch -d master                        # 删 git init 默认创建的 master
git push origin dev                         # 推送 dev 到远端
```

结果：
```
5560a83..d14d912  dev -> dev
```

`origin/dev` 同步到 `d14d912ca` ✅

---

## 三、踩坑记录（**最重要**）

### 坑 1：**`.git` 目录在 `git stash pop` 失败时可能消失**

- 触发条件：`stash pop` 出现 `CONFLICT (rename/delete)` 后，git 报 `not a git repository`
- 后果：所有本地分支、HEAD、stash、对象库丢失；**untracked 文件幸存**
- 原因未确定：可能是 Trae IDE watcher、Windows Defender 或 git 自身 bug
- **避坑**：
  - 合并前先 `git add -A && git commit` 暂存本地修改（避免大 stash）
  - 或者用 `git worktree` 在独立目录做合并，不污染主目录
  - 定期 `git bundle create backup.bundle --all` 备份整个仓库

### 坑 2：**GFW 屏蔽 GitHub 443 端口**（不是临时降级，是完全 reset）

- `git clone` / `fetch` 走 https → `Recv failure: Connection was reset`
- `git ls-remote` 早上能成功，下午失败（GFW 动态干扰）
- 验证：`Test-NetConnection github.com -Port 443` 失败，`-Port 22` 成功
- **避坑**：
  - **默认配 GitHub SSH key**（`ssh-keygen -t ed25519`），用 `git@github.com:...`
  - 加 `~/.ssh/config` 让 `github.com` 默认走 22 端口
  - 应急：用 `https://ghfast.top/...` 镜像（**不持久**，会挂）

### 坑 3：**Watt Toolkit 加速 GitHub 不一定生效**

- 启动后 `git fetch` 仍失败
- TUN 模式不显示在 `netsh winhttp show proxy`，调试不直观
- **避坑**：
  - 加速前先在浏览器访问 https://github.com 验证是否走代理
  - Watt Toolkit UI 里**手动确认 GitHub 加速已勾选**（不是默认开）
  - TUN 模式需要管理员权限；普通权限可能拿到 fallback 节点

### 坑 4：**Trae IDE agent 把 `.git` 目录加进 denylist**

- agent 无法删除 `.git/shallow.lock` 等临时文件
- 影响：合并失败时无法恢复
- **避坑**：
  - **git 操作前先退出 Trae agent** 或在独立 PowerShell 跑
  - 重大操作（clone、merge、reset）**用户手动执行**，不要让 agent 代跑

### 坑 5：**git init 默认创建 `master` 分支**

- `git init` 后 HEAD 在 `master`
- `git reset --hard origin/X` 不会改 HEAD 指向哪个分支
- 后果：`git log` 显示 `HEAD -> master, dev` 看着正常，但 `git checkout` 时 HEAD 切到 master
- **避坑**：
  - 重建后立刻 `git checkout dev`（即使没 fetch 也能 checkout 本地 master）
  - 或者用 `git init -b main` 指定默认分支

### 坑 6：**PowerShell wrapper 不支持 `&&`、屏蔽 `cmd /c`**

- `cd X && git ...` → 报 `The token '&&' is not a valid statement separator`
- `cmd /c rmdir` → 报 `blocked on Windows for safety`
- 替代：用 `Set-Location X; git ...`（`;` 分隔）

---

## 四、关键 commit

| commit | 说明 |
|---|---|
| `5560a83f6` | 旧 dev HEAD（merge 起点） |
| `d14d912ca` | update-logo HEAD = 新 dev HEAD（merge 终点） |
| 中间 50 个 | update-logo 独有 commit（fast-forward 应用到 dev） |

**远端状态**：
- 合并前 `origin/dev` = `5560a83f6`
- 合并后 `origin/dev` = `d14d912ca`（`git push origin dev` 推送）

---

## 五、影响范围

- **origin/dev** 已更新到 `d14d912ca`；其他同事下次 fetch 时会自动拿到 update-logo 全部 50 commit
- **本地** `dev` / `master` 分支已清理；只有 `dev`（指向 `d14d912ca`）和远端 `origin/dev`、`origin/update-logo`、`origin/yejian-main`
- **临时文件** `代码/`（plan 文档）和 `日志.md` 已通过 `D:\AI\opencode-tmp-backup` 备份后恢复（用户已手动清理备份和 `代码/` 目录）
- **SSH 配置**：已添加 GitHub SSH key 到本地

---

## 六、验证步骤

```powershell
# 1. 本地 dev
git log --oneline -1
# → d14d912 (HEAD -> dev, origin/update-logo) docs(日志): append v0.0.5 docker build section

# 2. 远端 origin/dev
git log --oneline origin/dev -1
# → d14d912 (HEAD -> dev, origin/update-logo, origin/dev) docs(日志): append v0.0.5 docker build section

# 3. 工作区干净
git status
# → On branch dev
#   Your branch is up to date with 'origin/dev'.
#   nothing to commit, working tree clean

# 4. 分支列表
git branch -a
# → * dev
#   remotes/origin/dev
#   remotes/origin/update-logo
#   remotes/origin/yejian-main
```

---

## 七、后续 Todo

- [ ] **下次合并前先 `git worktree add ../opencode-merge update-logo`** 在独立目录做合并，不污染主工作区
- [ ] 写一个 `script/git-merge.sh`：先 commit/stash → merge → 自动恢复 → 失败时回滚
- [ ] 把 `git bundle create` 加到项目根的 `script/backup.sh`，每周跑一次
- [ ] 更新 `project_memory.md` 的 Lessons Learned 部分，记录 `.git` 消失案例
- [ ] 排查 Trae IDE 的 `.git` denylist 来源（看看能否在 IDE 设置里关掉）

---

## 八、相关日志

- [20260615开发日志-系统通知图标改用本地LOGO.md](./20260615开发日志-系统通知图标改用本地LOGO.md)（`update-logo` 分支创建）
- [20260620开发日志-skill四角互补重构.md](./20260620开发日志-skill四角互补重构.md)（`update-logo` 上最后一次大 commit）
- [20260620开发日志-会话页面默认行为定制.md](./20260620开发日志-会话页面默认行为定制.md)
