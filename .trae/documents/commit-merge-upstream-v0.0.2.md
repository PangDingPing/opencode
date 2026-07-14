# 提交、合并、构建 v0.0.2 镜像 - 实施计划

## 任务摘要

完成当前 branding-update 分支上的网页端品牌定制修改（title、LOGO、AI 工作台 wordmark），按以下顺序执行：

1. 解决 docker/Dockerfile 和 docker/build.ps1 中遗留的 git 冲突标记
2. 把构建脚本升级到 v0.0.2 并启用 web UI 嵌入
3. 把所有改动按 scope 拆分为多个 commit 提交到 branding-update 分支
4. fast-forward 合并到本地 dev，再 push 到 origin/dev
5. 添加 upstream 远端并 fetch/merge 同步上游最新 dev
6. 在本地构建 v0.0.2 docker 镜像并启动容器验证

---

## 现状分析

### git 状态

- 当前分支：`branding-update`（与 dev 在同一 commit `fe0a14cb4`）
- 工作区未提交：
  - 修改：`packages/app/index.html`、`packages/ui/src/v2/components/wordmark-v2.tsx`
  - 新增：`packages/app/public/LOGO1.ico`、`packages/app/public/ai-workbench.png`
  - 未跟踪目录：`yejian/`（含 LOGO1.ico、AI工作台.png、GDYJ-grey.png、LOGO.png、background.png、readme.md）
- 远端：仅 `origin = https://github.com/PangDingPing/opencode.git`，**没有 upstream**
- 当前 `dev` 已和 `origin/dev` 同步（`Already up to date`）
- dev 历史中 `ac537c5c9` 提交了带 git 冲突标记的 docker 文件

### docker 文件中的冲突标记

- [docker/Dockerfile](file:///D:/AI/opencode/docker/Dockerfile)：1-30 行 HEAD 侧（`oven/bun:1.2.4-debian` 实时构建），31-63 行 incoming 侧（`alpine:3.21` + 预编译 musl 二进制）
- [docker/build.ps1](file:///D:/AI/opencode/docker/build.ps1)：第 2-14、29-33、43-54、59-74、144-153、175-186 行有 HEAD/incoming 冲突标记
- 这些冲突标记已作为文字 commit 进 `ac537c5c9`，但 v0.0.1 实际构建时是按 incoming 侧（预编译 musl + Alpine）跑通的（参考 [docker/readme.md](file:///D:/AI/opencode/docker/readme.md) 和 v0.0.1 开发日志）

### web UI 嵌入机制

- [packages/opencode/script/build.ts](file:///D:/AI/opencode/packages/opencode/script/build.ts) 第 25 行：用 `--skip-embed-web-ui` 跳过 web UI 嵌入
- 第 27-49 行 `createEmbeddedWebUIBundle`：先跑 `bun run --cwd packages/app build`，再把 `packages/app/dist/**` 通过 `import ... with { type: "file" }` 嵌入二进制
- [packages/opencode/src/server/shared/ui.ts](file:///D:/AI/opencode/packages/opencode/src/server/shared/ui.ts) 第 44-49 行 `embeddedUI`：运行时动态 import `opencode-web-ui.gen.ts`；第 88-93 行：未嵌入时**代理到 https://app.opencode.ai**
- [packages/opencode/src/server/routes/instance/httpapi/server.ts](file:///D:/AI/opencode/packages/opencode/src/server/routes/instance/httpapi/server.ts) 第 189 行：`disableEmbeddedWebUi` 来自 `flags`，由全局 flag 注入
- **结论**：v0.0.1 用 `--skip-embed-web-ui` 跑，web 资源是从官方公网代理。用户的 packages/app 修改要出现在 v0.0.2 镜像里，**必须去掉 `--skip-embed-web-ui`**

### 已确认的用户决策

| 决策 | 用户选择 |
|---|---|
| upstream URL | `https://github.com/anomalyco/opencode.git` |
| 合并流程 | `branding-update` → 本地 `dev` → `origin/dev` |
| v0.0.2 web UI 策略 | 嵌入 web UI（用户的 title/LOGO/wordmark 才会生效） |
| `yejian/` 目录 | 全部纳入版本控制（含 readme.md） |

---

## 专业审核与关键修正

原 plan 的问题与本次修正要点：

| # | 原 plan 问题 | 修正 |
|---|---|---|
| 1 | 单个混合大 commit（feat + chore + docs）不符合 conventional commit 规范 | 拆为 3 个 commit：app rebrand / docker 升级 / docs |
| 2 | `git merge --no-ff branding-update` 在同 commit 上毫无意义（会强制生成 merge commit） | 用 fast-forward（直接 `git merge branding-update`） |
| 3 | `merge --strategy-option=ours` 写法错误（git 没这个 option） | 去掉预设策略，upstream 同步时按实际冲突人工处理 |
| 4 | 默认 `-X ours` 策略会丢弃 upstream 的潜在 bug fix | 不预设，冲突文件单独评审 |
| 5 | 缺构建产物预清理（`packages/app/dist` 可能留有 dev 模式的旧产物） | 步骤新增 `rm -rf packages/app/dist packages/opencode/dist` |
| 6 | 缺构建时长预估 | 步骤中注明 15-30 分钟 |
| 7 | 缺 alpine tag 固定（`3.21` 是浮动 tag，可能升级到 3.21.x） | 固定为 `3.21.3`（若 docker hub 上不存在则降级为 `3.21`） |
| 8 | 缺 `docker stop` 旧 v0.0.1 容器（直接 rm 不优雅） | 先 stop 再 rm |
| 9 | 缺 `D:\AI\AIworkbench-data\root` 和 `tmp` 目录预创建 | 步骤 9 前面补 |
| 10 | 缺镜像/卷备份 | 启动 v0.0.2 前对 v0.0.1 容器和镜像备份 |
| 11 | 缺自动验证 | 用 `curl` 检查 title 是否包含"广东冶建图审" |
| 12 | 缺构建产物检查 | 检查 `packages/opencode/dist/opencode-linux-x64-baseline-musl/bin/opencode` 存在 |
| 13 | 回滚方案不具体 | 列出精确的 stop / rm / run 旧镜像命令 |
| 14 | 缺端口冲突检查 | 步骤 9 前面加 `netstat` 检查 8088 占用情况 |

---

## 实施步骤

### 步骤 0：准备备份与现状快照

```powershell
# 备份 v0.0.1 容器（旧容器还在跑）
docker commit yejian-AIworkbench yejian-opencode:v0.0.1-backup
# 给当前 v0.0.1 镜像打 tag 备份
docker tag yejian-opencode:v0.0.1 yejian-opencode:v0.0.1-backup-$(Get-Date -Format yyyyMMddHHmmss)
# 检查端口占用
netstat -ano | findstr ":8088"
```

### 步骤 1：清理 docker 文件中的冲突标记

**目标**：让 [docker/Dockerfile](file:///D:/AI/opencode/docker/Dockerfile) 和 [docker/build.ps1](file:///D:/AI/opencode/docker/build.ps1) 变成纯净版本，基于 v0.0.1 已验证的 incoming 侧方案。

**操作**：
- 打开 `docker/Dockerfile`，保留 incoming 侧内容（Alpine 3.21 + 预编译 musl 二进制，第 31-63 行的实质内容），删除所有 `<<<<<<< HEAD`、`=======`、`>>>>>>> feat-build-docker-image-TMggJ0` 标记
- 同样处理 `docker/build.ps1`，保留 incoming 侧完整流程，删掉冲突标记
- 不修改 `docker/cleanup.ps1`、`docker/export.ps1`、`docker/run.ps1`、`docker/readme.md`（无冲突标记）

### 步骤 2：升级 build 脚本到 v0.0.2

**文件 1**：[docker/build.ps1](file:///D:/AI/opencode/docker/build.ps1)

- 第 19 行：`[string]$ImageTag = "v0.0.1"` → `"v0.0.2"`
- 第 96 行：`bun run script/build.ts --skip-embed-web-ui` → `bun run script/build.ts`（**去掉 `--skip-embed-web-ui`**）
- 在第 95 行 `Push-Location "packages/opencode"` 之前，添加：
  ```powershell
  # Ensure workspace dependencies (especially packages/app) are installed
  if (-not (Test-Path "node_modules")) { bun install }
  if (-not (Test-Path "packages/app/node_modules")) { bun install }
  ```

**文件 2**：[docker/Dockerfile](file:///D:/AI/opencode/docker/Dockerfile)

- `FROM alpine:3.21` → `FROM alpine:3.21.3`（若 hub 上不存在则退回 `3.21`）
- 更新注释：去掉"Build the binary first via: `bun run script/build.ts --skip-embed-web-ui`"，改为 `bun run script/build.ts` (from `packages/opencode` directory, embeds the Web UI bundle)

**为什么**：
- `--skip-embed-web-ui` 会让二进制代理到 `https://app.opencode.ai`，用户的 title/LOGO/wordmark 不会出现在镜像里
- 不带这个 flag 时，build.ts 第 27-49 行会先跑 `bun run --cwd packages/app build`，把 `packages/app/dist/**`（含 `LOGO1.ico`、`ai-workbench.png`、改后的 `index.html`、改后的 `wordmark-v2.tsx` 产物）嵌入二进制
- build.ts 默认会自己跑 `bun install --os="*" --cpu="*" @opentui/core@...` 等，无需在 build.ps1 重复

### 步骤 3：清理旧构建产物

```powershell
cd D:\AI\opencode
Remove-Item -Recurse -Force packages\app\dist -ErrorAction SilentlyContinue
Remove-Item -Recurse -Force packages\opencode\dist -ErrorAction SilentlyContinue
```

### 步骤 4：拆分三个 commit 提交到 branding-update

按 scope 拆 3 个 commit（与原 plan 的大混合 commit 不同）：

**Commit 1**：`feat(app): rebrand to 广东冶建图审AI工作台`

```powershell
git add packages/app/index.html
git add packages/ui/src/v2/components/wordmark-v2.tsx
git add packages/app/public/LOGO1.ico
git add packages/app/public/ai-workbench.png
git commit -m "feat(app): rebrand to 广东冶建图审AI工作台" -m "- index.html: 浏览器标签标题改为「广东冶建图审AI工作台」；favicon 三个 link 引用统一指向 /LOGO1.ico - wordmark-v2.tsx: 「新建会话」页面 wordmark 由 opencode SVG 替换为 /ai-workbench.png 图片 - public/LOGO1.ico、ai-workbench.png: 新增资源文件"
```

**Commit 2**：`chore(docker): clean conflict markers and upgrade to v0.0.2 with web UI embed`

```powershell
git add docker/Dockerfile docker/build.ps1
git commit -m "chore(docker): clean conflict markers and upgrade to v0.0.2 with web UI embed" -m "- Dockerfile、build.ps1: 清理 ac537c5c9 遗留的 git 冲突标记，统一为 v0.0.1 已验证的 incoming 侧（Alpine 3.21 + 预编译 musl 二进制）方案 - build.ps1: ImageTag 默认 v0.0.1 升级到 v0.0.2，构建二进制时不再传 --skip-embed-web-ui，使 web UI 定制修改生效 - Dockerfile: alpine 标签固定到具体小版本"
```

**Commit 3**：`docs(yejian): add branding customization changelog`

```powershell
git add yejian/
git commit -m "docs(yejian): add branding customization changelog" -m "记录网页端品牌定制（title、LOGO、wordmark）的修改内容、位置、文件清单与启动验证步骤"
```

### 步骤 5：合并到本地 dev（fast-forward）

由于 `branding-update` 和 `dev` 之前在同一 commit，且 `branding-update` 现在多了 3 个 commit，合并采用 fast-forward 即可，**不要**用 `--no-ff`（没有意义）：

```powershell
git checkout dev
git merge branding-update
# 此时 dev 指针会前移到 branding-update HEAD
```

### 步骤 6：添加并同步 upstream

```powershell
# 1. 添加 upstream 远端
git remote add upstream https://github.com/anomalyco/opencode.git
# 2. 仅 fetch dev 分支
git fetch upstream dev
# 3. 查看 upstream/dev 相对本地 dev 的领先/落后
git log --oneline dev..upstream/dev
git log --oneline upstream/dev..dev
# 4. merge upstream/dev（不预设策略；如有冲突会进入冲突状态，再按文件逐个处理）
git merge upstream/dev -m "Merge upstream/dev into dev"
```

**冲突处理原则**：
- 品牌定制相关文件（`packages/app/index.html`、`packages/ui/src/v2/components/wordmark-v2.tsx`、`packages/app/public/*`）：保留本地（ours）
- 业务代码、构建脚本、文档：保留 upstream（theirs）
- 冲突逐文件评估，不预设全局策略

### 步骤 7：推送到 origin

```powershell
# 先推 branding-update（追溯用）
git push -u origin branding-update
# 再推 dev
git push origin dev
git remote -v  # 验证
```

### 步骤 8：构建 v0.0.2 镜像

**预估时长**：15-30 分钟（多平台二进制 + 嵌入 web UI + 镜像构建）

```powershell
cd D:\AI\opencode

# 1. 预清理（已在步骤 3 做过，这里可跳过）
# 2. 一次性安装所有 workspace 依赖
bun install

# 3. 构建多平台二进制（含 web UI 嵌入）
Push-Location packages\opencode
bun run script/build.ts
Pop-Location

# 4. 验证产物
Get-Item packages\opencode\dist\opencode-linux-x64-baseline-musl\bin\opencode

# 5. 临时禁用 .dockerignore 让 dist/ 能被复制
Move-Item .dockerignore .dockerignore.dockerbuild -Force

# 6. 构建镜像
docker build -t yejian-opencode:v0.0.2 -f docker\Dockerfile .

# 7. 恢复 .dockerignore
Move-Item .dockerignore.dockerbuild .dockerignore -Force

# 8. 验证镜像
docker images | findstr yejian-opencode
```

**或者调用升级后的脚本**（脚本默认 tag 已经是 v0.0.2）：

```powershell
powershell -ExecutionPolicy Bypass -File .\docker\build.ps1
```

> 注：`build.ps1` 设计为"构建+启动"一键。如果想分两步：先单独跑构建部分（用上面的手动命令），再单独用 `run.ps1` 启动。

### 步骤 9：启动并验证 v0.0.2 容器

```powershell
# 1. 预创建挂载点子目录
$root = "D:\AI\AIworkbench-data"
New-Item -ItemType Directory -Path "$root\root" -Force | Out-Null
New-Item -ItemType Directory -Path "$root\tmp" -Force | Out-Null
New-Item -ItemType Directory -Path "D:\AI\AIworkbench" -Force | Out-Null

# 2. 优雅停止并删除 v0.0.1 容器
docker stop yejian-AIworkbench
docker rm yejian-AIworkbench

# 3. 启动 v0.0.2
docker run -d --name yejian-AIworkbench `
  -p 8088:8088 `
  -v "D:\AI\AIworkbench:/workspace" `
  -v "$root\root:/root" `
  -v "$root\tmp:/tmp" `
  -w /workspace `
  --hostname 0.0.0.0 `
  yejian-opencode:v0.0.2

# 4. 验证
docker ps --filter "name=yejian-AIworkbench"
Start-Sleep -Seconds 5
docker logs yejian-AIworkbench
```

### 步骤 10：自动验证品牌定制生效

```powershell
# 等待服务完全启动
$ready = $false
for ($i = 0; $i -lt 30; $i++) {
    try {
        $r = Invoke-WebRequest -Uri "http://localhost:8088" -UseBasicParsing -TimeoutSec 5
        if ($r.Content -match "广东冶建图审") { $ready = $true; break }
    } catch { Start-Sleep -Seconds 2 }
}
if ($ready) { Write-Host "[OK] 标题包含品牌定制" -ForegroundColor Green }
else { Write-Host "[FAIL] 标题未包含品牌定制" -ForegroundColor Red; exit 1 }
```

### 步骤 11：更新 docker/readme.md 变更记录

**文件**：[docker/readme.md](file:///D:/AI/opencode/docker/readme.md) 末尾"变更记录"表格追加：

```
| v0.0.2 | 2026-06-14 | 嵌入 Web UI、网页端品牌定制（title 改为「广东冶建图审AI工作台」、LOGO、AI 工作台 wordmark） |
```

---

## 假设与决策

- **冲突标记的解决方式**：采用 incoming 侧（v0.0.1 验证过的方案）。理由：[docker/readme.md](file:///D:/AI/opencode/docker/readme.md) 1.1 节"坑 2"否定了 HEAD 侧的 `oven/bun` 实时构建（apt-get 包名冲突），"坑 9"否定了 musl/glibc 误用
- **alpine tag 固定**：浮动 tag 在企业内部构建存在版本漂移风险，固定小版本是工程实践
- **commit 拆分**：遵循 conventional commit 规范，便于 changelog 工具识别；本次"网页端品牌定制"是一个逻辑功能，但代码分布在 `packages/app`、`packages/ui`、`docker/`、`yejian/` 四个 scope，分 3 个 commit 更清晰
- **build.ts 不传 `--skip-install`**：build.ts 第 140-144 行默认会跑 `bun install --os="*" --cpu="*" @opentui/core@...` 等，build.ps1 只需要确保根目录 workspace 依赖就绪
- **`yejian/` 进版本控制**：按用户明确要求
- **不动 `packages/opencode` 的 build.ts 等源文件**：仅升级 docker 脚本
- **不构建多平台镜像**：只构建 `linux/amd64` 镜像，与 v0.0.1 一致

---

## 验证步骤

实施完成后逐项检查：

| 检查项 | 命令 | 期望 |
|---|---|---|
| 工作区干净 | `git status` | nothing to commit, working tree clean |
| 三个 commit 存在 | `git log --oneline -4` | 看到 3 个新 commit 按顺序：app rebrand → docker upgrade → docs |
| dev 已合 branding-update | `git log --oneline dev ^branding-update` | 无输出（dev ⊇ branding-update） |
| origin/dev 同步 | `git log --oneline origin/dev..dev` | 无输出 |
| upstream 已添加 | `git remote -v` | 显示 origin + upstream |
| upstream/dev 已 merge | `git log --oneline dev ^upstream/dev` | 无输出（dev ⊇ upstream/dev） |
| 镜像存在 | `docker images \| findstr v0.0.2` | 显示 `yejian-opencode v0.0.2` |
| 容器运行 | `docker ps --filter "name=yejian-AIworkbench"` | 状态 Up |
| 标题定制 | `curl -s http://localhost:8088 \| findstr "广东冶建"` | 有匹配 |
| favicon 定制 | `curl -sI http://localhost:8088/LOGO1.ico` | HTTP 200 |
| 容器无错误日志 | `docker logs yejian-AIworkbench 2>&1 \| findstr /i "error panic"` | 无匹配 |

---

## 风险与回滚

### 风险

| 风险 | 概率 | 影响 | 缓解 |
|---|---|---|---|
| 构建 web UI 失败（packages/app 依赖缺失） | 低 | 镜像不能包含定制 | 步骤 2 已加 `bun install` 保险 |
| `bun run script/build.ts` 跨平台编译时间过长 | 中 | 等待 15-30 分钟 | 步骤 8 已注明时长 |
| `alpine:3.21.3` 在 docker hub 不存在 | 低 | docker build 失败 | 回退到 `alpine:3.21` |
| upstream/dev 与本地 dev 冲突 | 中 | 需人工处理 | 步骤 6 已说明按文件评估原则 |
| 8088 端口被占用 | 低 | 容器启动失败 | 步骤 0 已加端口检查 |
| v0.0.2 启动失败 | 低 | web 服务不可用 | 步骤 0 已备份 v0.0.1 镜像 |

### 回滚方案

**A. 镜像未启动（构建失败或启动失败）**：

```powershell
# 删除 v0.0.2 镜像/容器
docker rm -f yejian-AIworkbench
docker rmi yejian-opencode:v0.0.2
# 重启 v0.0.1
docker run -d --name yejian-AIworkbench -p 8088:8088 `
  -v "D:\AI\AIworkbench:/workspace" `
  -v "D:\AI\AIworkbench-data\root:/root" `
  -v "D:\AI\AIworkbench-data\tmp:/tmp" `
  -w /workspace --hostname 0.0.0.0 `
  yejian-opencode:v0.0.1
```

**B. 已启动但发现需要回退**：

```powershell
# 1. 停 v0.0.2
docker stop yejian-AIworkbench
docker rm yejian-AIworkbench
# 2. 启动 v0.0.1（如果 v0.0.1 镜像已被覆盖，先用 backup 还原：docker tag yejian-opencode:v0.0.1-backup yejian-opencode:v0.0.1）
docker run -d --name yejian-AIworkbench -p 8088:8088 `
  -v "D:\AI\AIworkbench:/workspace" `
  -v "D:\AI\AIworkbench-data\root:/root" `
  -v "D:\AI\AIworkbench-data\tmp:/tmp" `
  -w /workspace --hostname 0.0.0.0 `
  yejian-opencode:v0.0.1
```

**C. git 回滚（仅在工作区未 push 时）**：

```powershell
git checkout dev
git reset --hard origin/dev  # 放弃本地 dev 的所有改动（谨慎！）
```

**D. 容器数据保留**：

由于 v0.0.1/v0.0.2 都用 `bind mount` 挂载 `D:\AI\AIworkbench`、`D:\AI\AIworkbench-data/root`、`D:\AI\AIworkbench-data/tmp`，容器切换不会丢失用户数据（数据在宿主机）。

---

## 文件清单

本次实施将修改/创建的文件：

| 路径 | 操作 | 备注 |
|---|---|---|
| `docker/Dockerfile` | 编辑 | 清理冲突标记、alpine 版本固定、注释更新 |
| `docker/build.ps1` | 编辑 | 清理冲突标记、tag 升级、去掉 skip-embed-web-ui、加依赖预检 |
| `docker/readme.md` | 编辑 | 变更记录追加 v0.0.2 行 |
| `packages/app/index.html` | 编辑（步骤 4 commit 1） | 改 title、favicon |
| `packages/ui/src/v2/components/wordmark-v2.tsx` | 编辑（步骤 4 commit 1） | 改 wordmark |
| `packages/app/public/LOGO1.ico` | 新增（步骤 4 commit 1） | 资源文件 |
| `packages/app/public/ai-workbench.png` | 新增（步骤 4 commit 1） | 资源文件 |
| `yejian/*` | 新增（步骤 4 commit 3） | 整个目录首次纳入版本控制 |
