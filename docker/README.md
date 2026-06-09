# 广东冶建施工图审查中心 AI 工作台 — 部署运维手册

> 本文档面向**运维人员**（也就是你，未来负责日常维护这套系统的人）。
> 同事使用层面的"怎么用工作台"另有用户手册（待补）。

## 1. 这套系统是什么

- **同事打开浏览器即用**：`http://你的服务器IP:8088`，无需安装任何软件
- **基于 opencode 二次开发**：通过 fork 跟随上游 opencode 更新
- **Docker 部署两个容器**：`yejian-nginx`（前端 + 认证）+ `yejian-opencode`（AI 后端）
- **数据完全在你宿主机**：所有同事的项目文件存在 `WORKSPACE_PATH` 目录下，可随时备份

## 2. 一次性首次部署（10 步）

> 假设你已 fork `https://github.com/PangDingPing/opencode` 到自己账号、且 clone 到了本地。

### 2.1 准备宿主目录

```bash
# Windows 示例（你实际环境的路径以你的为准）
mkdir D:\AI\AIworkbench
mkdir D:\AI\AIworkbench-data\root
mkdir D:\AI\AIworkbench-data\tmp
```

### 2.2 构建前端静态文件

```bash
cd D:/ai/opencode/yejian
bun install
bun run build
```

完成后 `yejian/dist/` 应该有 index.html + assets/。

### 2.3 复制环境配置

```bash
cd D:/ai/opencode/docker
cp .env.example .env
```

编辑 `.env`，把路径改为你的实际宿主路径：

```
WORKSPACE_PATH=D:/AI/AIworkbench
DATA_PATH=D:/AI/AIworkbench-data
OPENCODE_VERSION=1.16.2
WEB_PORT=8088
```

### 2.4 添加你自己的账号

```bash
cd D:/ai/opencode
docker/scripts/add-user.bat
```

按提示输入你的 11 位手机号 + 设置密码（输入两次）。脚本会自动创建 `D:\AI\AIworkbench\user-<你的手机号>` 目录。

### 2.5 启动

```bash
cd D:/ai/opencode/docker
docker compose --env-file .env up -d
```

第一次会下载镜像 + 构建，5-10 分钟。后续启动很快。

### 2.6 验证

浏览器打开 `http://localhost:8088`，弹出登录框：
- 用户名：刚才输入的手机号
- 密码：刚才设的密码

登录成功应能看到「广东冶建施工图审查中心AI工作台」界面。

---

## 3. 日常维护命令

| 任务 | 命令 |
|---|---|
| 加新同事 | `docker/scripts/add-user.bat` |
| 改了 yejian 源码后更新前端 | `docker/scripts/rebuild-web.bat` |
| 改了 skills.json 后更新 | 同上（前端文件改了都用这个） |
| 健康检查 | `docker/scripts/healthcheck.bat` |
| 查实时日志 | `cd docker && docker compose logs -f` |
| 重启所有服务 | `cd docker && docker compose restart` |
| 完全重启（含网络） | `cd docker && docker compose down && docker compose up -d` |
| 升级 opencode | 改 `.env` 的 `OPENCODE_VERSION`，然后 `cd docker && docker compose build --no-cache opencode-server && docker compose up -d opencode-server` |

---

## 4. 跟随 opencode 上游更新（每周或大版本时）

```bash
cd D:/ai/opencode
git checkout yejian-main

# 1. 拉上游最新
git fetch upstream

# 2. 看上游有什么新东西（可选）
git log yejian-main..upstream/dev --oneline

# 3. 合并
git merge upstream/dev

# 4. 如有冲突（大概率在 packages/app 的几处侵入式改动），用 VS Code 合并 UI 解决
#    保留 yejian 的修改，吸收上游的新内容

# 5. 重新构建前端
cd yejian && bun run build

# 6. 推到 fork
cd .. && git push origin yejian-main
```

**侵入式改动登记**（合并冲突时优先查这些位置）：见设计文档 §5。

---

## 5. 故障排查

### 5.1 打不开页面 / 502 错误

```bash
docker/scripts/healthcheck.bat
```

常见原因：
- **opencode-server 容器挂了**：重启 `cd docker && docker compose restart opencode-server`
- **nginx 配置错误**：看 nginx 日志 `docker compose logs nginx`
- **端口被占用**：另一个程序占了 8088，改 `.env` 的 `WEB_PORT`

### 5.2 登录后白屏

- 按 F12 看浏览器 console 报错
- 让同事**截图浏览器错误详情**发给你
- 主要原因：前端构建未更新（跑 `rebuild-web.bat`）

### 5.3 同事看不到自己的项目

- 确认 `D:\AI\AIworkbench\user-<手机号>` 目录存在
- 如果不存在，手动 `mkdir` 或重跑 `add-user.bat`（输入相同手机号也会重建目录）

### 5.4 容器自己跑跑就挂

`docker compose ps` 看状态——只要 `restart: unless-stopped` 在配置里，挂了会自动重启。如果反复挂：
- `docker compose logs --tail=100 opencode-server` 看是不是 opencode 报错
- 实在解决不了，告诉 AI（我）具体错误，定位问题

---

## 6. 验收清单（首次部署后必查）

- [ ] http://localhost:8088 弹出登录框（说明 nginx + basic auth 工作）
- [ ] 输入手机号 + 密码登录成功（说明 htpasswd 文件正确）
- [ ] 看到"广东冶建施工图审查中心AI工作台"标题
- [ ] 左侧面板一显示所有技能组（说明 skills.json 加载成功）
- [ ] 鼠标悬浮技能能看到 Tooltip
- [ ] 占位技能（带 *）是灰色不可点
- [ ] 左侧面板二能看到当前用户项目（手机号显示为 `138****1876`）
- [ ] 看不到别的同事的项目（UI 隔离生效）
- [ ] 浏览器 F12 → Network 标签里 `/api/...` 请求是 200（说明反向代理工作）

---

## 7. 不在本期范围内

- 真后端权限隔离（同事 A 仍可构造 API 看同事 B 的数据；下一期"多用户系统"解决）
- HTTPS / SSL 证书（内网部署）
- 手机号验证码登录（基本认证够用）
- 集群部署 / 监控告警

---

## 8. 联系

- 仓库：https://github.com/PangDingPing/opencode 分支 `yejian-main`
- 上游：https://github.com/anomalyco/opencode 分支 `dev`
- 设计文档：`docs/superpowers/specs/2026-06-07-yejian-customization-design.md`
- 实施计划：`docs/superpowers/plans/2026-06-07-yejian-customization-plan.md`
