# 20261023 开发日志：Docker 镜像与容器统一为 yejian-v1.0

## 需求背景

1. 先拉取远程更新（本地落后 8 个提交，`f37d9c59` → `fb0e07ae`），并用 `git checkout` 清掉 `serve.ts` 的幻影改动（eol 规范化导致 `M` 标记但 `git diff` 为空）。
2. 按 `docker/readme.md` 的流程重建 Docker 镜像，要求：版本号 `yejian-v1.0`，容器名 `yejian-v1.0`，镜像名 `yejian-v1.0`，并同步修改 `docker/` 目录下的脚本与文档。
3. 构建完成后提交、推送，并打标签；标签名先按用户要求打为 `Docker-v1.0`，随后用户要求改名为 `yejian-v1.0`。

## 备选方案

镜像命名有三种解释，最终按用户字面要求选 A：

| 方案 | 镜像完整名 | 容器名 | 说明 |
|------|-----------|--------|------|
| **A（采用）** | `yejian-v1.0:latest` | `yejian-v1.0` | 仓库名即 `yejian-v1.0`，`docker images` 显示与用户要求完全一致 |
| B | `yejian-opencode:yejian-v1.0` | `yejian-v1.0` | 保留原仓库名，只用 tag 区分版本 |
| C | `yejian-opencode:v1.0` | `yejian-v1.0` | 沿用历史 `yejian-opencode:vX.Y.Z` 风格，但与用户要求不符 |

命名卷保持 `yejian-opencode-data` 不变（改卷名会导致数据库、登录态、会话历史全部丢失）。

## 文件改动

| 文件 | 行号 | 改动 |
|------|------|------|
| `docker/build.ps1` | L3 | 头部注释新增 v1.0 说明 |
| `docker/build.ps1` | L18-L20 | 默认值：`ImageName=yejian-v1.0`、`ContainerName=yejian-v1.0`、`ImageTag=latest` |
| `docker/run.ps1` | L7 | 注释：容器名默认 `yejian-v1.0` |
| `docker/run.ps1` | L15-L17、L23 | 默认值同上；容器名未指定时取 `$ImageName` |
| `docker/export.ps1` | L7-L8 | 默认导出 `yejian-v1.0:latest` |
| `docker/readme.md` | L9-L11 | 项目说明：镜像/容器名同步 v1.0 |
| `docker/readme.md` | L165-L188 | 标准 `docker run` 命令与参数表同步 v1.0 |
| `docker/readme.md` | L1622-L1646 | 新增「附录：v1.0 重命名」：背景、改动清单、数据保留说明、构建验证命令 |

Dockerfile 未改动（`OPENCODE_VERSION=1.17.6` 保持原样）。

## 影响范围

- 仅容器编排、构建脚本与文档；镜像内二进制由 `-RebuildBuilder` 重编（含刚拉取的 8 个上游/自定义提交）。
- 数据无影响：`/root`、`/tmp`、`/YEJIAN`、`/YEJIAN2` 四个 bind mount 与 named volume `yejian-opencode-data` 全部沿用。
- 旧容器 `yejian-v0.1.8` 已 `docker stop`（保留 Exited 状态，可回滚），新容器 `yejian-v1.0` 占用 8088。

## 踩坑记录

1. **端口冲突**：旧容器 `yejian-v0.1.8` 处于 Up 状态且带 `--restart always`，直接构建启动会因 8088 被占用失败。需先 `docker stop` 再构建。
2. **脚本提示误导**：`build.ps1` 打印 "Old container removed"，但 `docker ps -a` 显示 `yejian-v0.1.8` 仍在（Exited）。`docker ps -a --filter "name=..."` 为子串匹配，且变量判空在某些情况下误判，提示不可信，验证以 `docker ps` 实际结果为准。
3. **PowerShell 5 引号解析**：`docker inspect --format` 里嵌套单引号/双引号会报 `unterminated quoted string`，改用单引号包裹整个 format 字符串。
4. **Git 标签大小写敏感**：先打的 `Docker-v1.0` 与历史小写 `docker-v0.1.8` 风格不一致；git 标签区分大小写，故 `Docker-v1.0` 与 `docker-v1.0` 视为两个标签。改名流程为：新建 `yejian-v1.0` → 推送 → 删除远程 `Docker-v1.0`（`git push origin :refs/tags/Docker-v1.0`）→ 删除本地。
5. **`git ls-remote` 附注标签输出两行**：`refs/tags/X` 是标签对象 hash，`refs/tags/X^{}` 才是剥壳后指向的提交，不是两个标签、也不是重号。
6. **pre-push 钩子**：每次 `git push`（含标签）都会触发 `bun turbo typecheck`，23 个包约 8-10 秒，属正常。

## 验证步骤

```powershell
# 1. 构建（只重编 builder，runtime 全缓存）
powershell -ExecutionPolicy Bypass -File .\docker\build.ps1 -RebuildBuilder
# → Docker image built successfully，naming to docker.io/library/yejian-v1.0:latest

# 2. 镜像与二进制新鲜度
docker images --format "{{.Repository}}:{{.Tag}}`t{{.CreatedSince}}`t{{.Size}}"
# → yejian-v1.0:latest  4 minutes ago  2.38GB（旧 v0.1.8 为 2.34GB）
docker run --rm --entrypoint sh yejian-v1.0:latest -c "stat -c '%y %s' /usr/local/bin/opencode; opencode --version"
# → 2026-10-23 21:36:11 ... 1.17.6（确认为本次重编）

# 3. 容器与挂载
docker ps --filter "name=yejian-v1.0"
# → Up，yejian-v1.0:latest
docker inspect yejian-v1.0 --format '{{.State.Status}} | restart={{.HostConfig.RestartPolicy.Name}} | workdir={{.Config.WorkingDir}}'
# → running | restart=always | workdir=/YEJIAN
# 5 个挂载：YEJIAN → /YEJIAN、YEJIAN2 → /YEJIAN2、AIworkbench-data\root → /root、
#          AIworkbench-data\tmp → /tmp、yejian-opencode-data → /root/.local/share/opencode

# 4. Web 健康
docker exec yejian-v1.0 python3 -c "import urllib.request; print(urllib.request.urlopen('http://localhost:8088/', timeout=10).status)"
# → 200

# 5. 标签核对
git ls-remote --tags origin | Select-String "yejian-v1.0"
# → 1463c77f... refs/tags/yejian-v1.0 / db6668ff... refs/tags/yejian-v1.0^{}
```

## 提交与标签

- 提交：`db6668ffb2` `chore(yejian): unify docker image and container name as yejian-v1.0`（4 文件，+49 / -18）
- 标签：`yejian-v1.0`（附注标签，标签对象 `1463c77f` → 提交 `db6668ff`），已推送远程
- 临时标签 `Docker-v1.0`（`f9092690`）已从远程与本地删除

## 已知遗留

- 容器日志提示 `OPENCODE_SERVER_PASSWORD is not set; server is unsecured.`，当前 Web 无密码保护；需要时用 `build.ps1 -EnvFile` / `run.ps1 -EnvFile` 注入。
- 旧容器 `yejian-v0.1.8`（Exited）与旧镜像 `yejian-opencode:v0.1.8` 未删除，确认 v1.0 稳定后可清理。
