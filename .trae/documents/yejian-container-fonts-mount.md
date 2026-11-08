# 计划：yejian-v1.0 容器固化挂载文档 + 挂载 Windows 字体

## 摘要

两件事合并为一次容器重建处理：

1. **固化部署文档**：把 `yejian-v1.0` 平台容器当前实际的 6 个挂载参数完整固化到部署文档（经核对，文档与容器现状一致，本次主要是把「字体挂载」合并进重建命令模板，保持文档即真相）。
2. **预防性挂载 Windows 字体**：重建容器时追加只读挂载 `C:\Windows\Fonts → /usr/share/fonts/win`，让 Linux 容器内可用宋体（SimSun）等 Windows 字体。

**重要说明（已向用户确认）**：现有报告生成（`generate_report_docx.js`，node docx 库）只是把字体名写进 docx 的 XML，**不需要** Linux 端安装字体，报告在 Windows 打开显示正常。本次挂载属于预防性配置，为以后容器内做渲染类操作（如 LibreOffice 转 PDF）铺路。

## 现状核对（已探索确认）

- 当前容器实际挂载（`docker inspect yejian-v1.0`）共 6 个，与 [docs/内网部署记录.md](file:///E:/AI/Green-Building-Review-workbench/docs/内网部署记录.md) 第二节记录一致：
  - `E:\AI\YEJIAN:/YEJIAN`
  - `E:\AI\YEJIAN2:/YEJIAN2`
  - `E:\AI\AIworkbench-data\root:/root`
  - `E:\AI\AIworkbench-data\tmp:/tmp`
  - `E:\AI\green-review-data:/data/green-review`
  - 卷 `yejian-opencode-data:/root/.local/share/opencode`
  - 启动参数：`-p 8088:8088`、`--restart always`、`--entrypoint opencode ... web --hostname 0.0.0.0 --port 8088`
- "Linux 环境无 SimSun" 提示来自平台容器内 AI 的运行时说明，非代码报错；技能与工作台代码中均无 SimSun 硬依赖。

## 改动内容

### 1. 更新 `E:\AI\Green-Building-Review-workbench\docs\内网部署记录.md`

- 第二节 `docker run` 命令模板追加一行字体挂载：
  ```powershell
  -v "C:\Windows\Fonts:/usr/share/fonts/win:ro" `
  ```
  并加注释说明：只读挂载、预防性配置（现有 docx 生成不依赖 Linux 端字体；为容器内后续 PDF 渲染等需求备用）。
- 第 4 步验证清单补充：容器内 `ls /usr/share/fonts/win/simsun.ttc` 可见（字体挂载生效）。
- 「遗留与后续」或新增小节记录本次变更日期（2026-11-07）与动机。
- 补充失败排查：若挂载失败（Docker Desktop 未共享 C 盘），到 Settings → Resources → File sharing 添加 `C:\`。

### 2. 更新 `E:\AI\Green-Building-Review-workbench\README.md`

- 第 91 行平台容器说明处补一句：可选地只读挂载 `C:\Windows\Fonts` 供容器内渲染使用，详见部署记录。

### 3. 更新 `E:\AI\Green-Building-Review-workbench\日志.md`

- 按项目规则在顶部（2026-11-07）记录本次部署文档更新与容器重建。

### 4. 重建容器（执行项，按文档第二节既有流程）

前置检查：确认当前**没有正在运行的审查/转换任务**（`docker compose ps` 或问用户），重建期间平台会中断约 1~2 分钟。

```powershell
# 1) 备份当前配置
docker inspect yejian-v1.0 > E:\AI\green-review-data\_backup\yejian-v1.0-inspect-20261107.json

# 2) 停旧容器并改名保留（便于回滚）
docker stop yejian-v1.0
docker rename yejian-v1.0 yejian-v1.0-old2

# 3) 按原参数重建，追加字体只读挂载
docker run -d --name yejian-v1.0 --restart always `
  -p 8088:8088 `
  -v "E:\AI\YEJIAN:/YEJIAN" `
  -v "E:\AI\YEJIAN2:/YEJIAN2" `
  -v "E:\AI\AIworkbench-data\root:/root" `
  -v "E:\AI\AIworkbench-data\tmp:/tmp" `
  -v "E:\AI\green-review-data:/data/green-review" `
  -v "yejian-opencode-data:/root/.local/share/opencode" `
  -v "C:\Windows\Fonts:/usr/share/fonts/win:ro" `
  --entrypoint opencode yejian-v1.0:latest web --hostname 0.0.0.0 --port 8088
```

### 5. 验证

| 检查项 | 方式 | 通过标准 |
|:--|:--|:--|
| 容器状态 | `docker ps` | `yejian-v1.0` Up |
| 平台可达 | `curl http://127.0.0.1:8088` | 返回 200 |
| 共享目录仍在 | `docker exec yejian-v1.0 ls /data/green-review` | 目录可见 |
| 字体挂载生效 | `docker exec yejian-v1.0 ls /usr/share/fonts/win/simsun.ttc` | 文件存在 |
| 字体可被识别 | `docker exec yejian-v1.0 fc-list` 查 SimSun（若容器无 fc-list 则跳过，仅验文件可见） | 能列出 simsun |
| 工作台链路 | `docker compose ps`（在 `E:\AI\Green-Building-Review-workbench`）+ 浏览器开 `http://<本机IP>:8090` | api/web 均 healthy，登录页正常、能登录 |

### 6. 收尾

- 验证通过后**不主动删除** `yejian-v1.0-old2`，向用户展示结果，由用户确认后再删（符合"手动验证后确认"规则）。
- 若用户后续确认稳定，可顺带清理上次遗留的 `yejian-v1.0-old`（仅询问，不擅自删）。

## 假设与决策

- 字体容器内目标路径选 `/usr/share/fonts/win`（fontconfig 默认扫描 `/usr/share/fonts`），只读挂载 `:ro`。
- 不改 `docker-compose.yml`：`yejian-v1.0` 是手工 `docker run` 的独立容器，不受该编排管理（编排只管 green-review-api/web，它们不渲染文档，无需挂字体）。
- 不改技能代码：报告生成链路无需任何字体相关改动。
- 本次不在容器里安装 fontconfig/LibreOffice（属新增软件，超出本次范围）；`fc-list` 不存在就只验文件可见。

## 风险

- 重建容器期间平台中断 1~2 分钟，正在跑的任务会受影响 → 前置检查规避。
- Docker Desktop 未开 C 盘共享会导致挂载失败 → 文档写明排查路径。
- 微软字体授权面向 Windows 使用，只读挂载自用属常规做法，不分发即可（文档不展开）。
