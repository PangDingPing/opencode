# opencode Docker 镜像构建说明

本文档记录从源码构建 opencode Docker 镜像的完整流程，以及过程中遇到的问题和解决方案。

## 项目说明

- **项目**：opencode（AI 编程助手）
- **目标**：从源码构建 Docker 镜像，提供 Web 服务
- **宿主机端口**：8088
- **镜像名称**：`yejian-opencode:v0.0.1`
- **容器名称**：`yejian-AIworkbench`

---

## 快速开始

### 一键构建并启动

```powershell
cd D:\ai\opencode
powershell -ExecutionPolicy Bypass -File .\docker\build.ps1
```

### 单独使用各脚本

| 脚本 | 用途 |
|------|------|
| `build.ps1` | 构建镜像 + 启动容器 |
| `run.ps1` | 启动容器（需要镜像已构建） |
| `cleanup.ps1` | 停止并删除容器 |
| `export.ps1` | 导出镜像为 tar 文件 |

---

## 完整构建流程

### 1. 准备工作

#### 1.1 系统要求
- Windows 10/11
- Docker Desktop 已安装并运行
- Bun 已安装（`bun --version` 验证）
- PowerShell 5.1+ 或 PowerShell 7

#### 1.2 启用 Windows 长路径支持（重要）

由于项目路径较深，需要启用 Windows 长路径支持：

**以管理员身份运行 PowerShell**：
```powershell
New-ItemProperty -Path "HKLM:\SYSTEM\CurrentControlSet\Control\FileSystem" `
  -Name "LongPathsEnabled" -Value 1 -PropertyType DWORD -Force
```

**重启电脑**后生效。

### 2. 构建二进制

在 `packages/opencode` 目录下运行：

```powershell
cd D:\ai\opencode
bun install                          # 安装依赖
cd packages\opencode
bun run script/build.ts --skip-embed-web-ui   # 构建所有平台二进制
```

**构建产物**：
```
packages/opencode/dist/
├── opencode-windows-x64/bin/opencode.exe
├── opencode-linux-x64/bin/opencode              # glibc 版本（Ubuntu/Debian 用）
├── opencode-linux-x64-baseline-musl/bin/opencode # musl 版本（Alpine 用）
├── opencode-linux-arm64/bin/opencode
├── opencode-darwin-arm64/bin/opencode
└── ... (共 12 个平台变体)
```

### 3. 构建 Docker 镜像

运行 `build.ps1`，或手动执行：

```powershell
cd D:\ai\opencode

# 临时禁用 .dockerignore（让它包含 dist/ 目录）
Move-Item .dockerignore .dockerignore.dockerbuild -Force

docker build -t yejian-opencode:v0.0.1 -f docker\Dockerfile .

# 恢复 .dockerignore
Move-Item .dockerignore.dockerbuild .dockerignore -Force
```

### 4. 启动容器

```powershell
docker run -d --name yejian-AIworkbench -p 8088:8088 `
  -v "D:\AI\AIworkbench:/workspace" `
  -v "D:\AI\AIworkbench-data/root:/root" `
  -v "D:\AI\AIworkbench-data/tmp:/tmp" `
  -w /workspace `
  --hostname 0.0.0.0 `
  yejian-opencode:v0.0.1
```

**参数说明**：
| 参数 | 说明 |
|------|------|
| `-d` | 后台运行 |
| `--name yejian-AIworkbench` | 容器名称 |
| `-p 8088:8088` | 端口映射（宿主机:容器） |
| `-v ...:/workspace` | 工作目录挂载 |
| `-v ...:/root` | 容器 root 目录挂载 |
| `-v ...:/tmp` | 临时目录挂载 |
| `-w /workspace` | 设置工作目录 |
| `--hostname 0.0.0.0` | 监听所有网卡 |

### 5. 验证

打开浏览器访问：**http://localhost:8088**

---

## 踩过的坑（问题与解决方案）

### 坑 1：PowerShell 中文编码问题

**问题现象**：
```
字符串缺少终止符: "
表达式中缺少右")"。
```

**原因**：PowerShell 脚本中含有中文字符，编码不正确导致解析失败。

**解决**：脚本全部使用纯英文，中文用注释或说明代替。

---

### 坑 2：apt-get 安装包名错误

**问题现象**：
```
The following packages have unmet dependencies:
libstdc++-10-doc : Conflicts: libstdc++-9-doc
E: Unable to correct problems, you have held broken packages.
```

**原因**：`libstdc++` 在 Debian 中不是合法包名，应该是 `libstdc++6`。且 `libgcc-s1` 在 `oven/bun` 镜像中已存在。

**解决**：
- 只安装 `ripgrep`
- `libstdc++` 和 `libgcc` 由 Bun 镜像自带

---

### 坑 3：bun install 编译失败

**问题现象**：
```
FileNotFoundError: [Errno 2] No such file or directory:
'...node_modules\.bun\tree-sitter-powershell@0.25.10\...\node_addon_api_except.vcxproj.filters'
```

**原因**：Windows 路径超过 260 字符限制。

**解决**：
1. 启用 Windows 长路径（见上文）
2. 重启电脑

---

### 坑 4：bun install 失败后改用复制 node_modules

**问题描述**：`bun install` 在容器内无法解析 `catalog:` 版本的依赖。

**解决**：改为在主机上安装依赖，构建时通过临时禁用 `.dockerignore` 复制 `node_modules`。

---

### 坑 5：Docker 容器无法访问外网

**问题现象**：
```
curl: (7) Failed to connect to github.com port 443
```

**原因**：容器内网络无法访问 GitHub。

**解决**：改为在主机上构建二进制，再复制到 Docker 镜像中。**不要在容器内下载外部资源**。

---

### 坑 6：Dockerfile COPY 路径被 .dockerignore 排除

**问题现象**：
```
CopyIgnoredFile: Attempting to Copy file "...dist\opencode-linux-x64\bin\opencode"
that is excluded by .dockerignore
```

**原因**：项目根目录的 `.dockerignore` 排除了 `**/dist` 目录。

**解决**：构建前临时重命名 `.dockerignore`，构建后恢复。`build.ps1` 已自动处理。

---

### 坑 7：脚本找不到路径

**问题现象**：
```
error: Module not found "script/build.ts"
```

**原因**：`build.ts` 在 `packages/opencode/script/` 目录下，而不是仓库根目录。

**解决**：在执行 `bun run script/build.ts` 之前先 `Push-Location "packages/opencode"`。

---

### 坑 8：构建的二进制是 Windows 版本

**问题现象**：使用 `--single` 参数时只构建当前平台（Windows）。

**解决**：去掉 `--single` 参数，构建所有平台。

---

### 坑 9：Alpine 无法运行 glibc 二进制

**问题现象**：
```
/bin/sh: opencode: not found
```

**原因**：Alpine Linux 使用 musl libc，而 `opencode-linux-x64` 是 glibc 版本，**不能**在 Alpine 上运行。

**解决**：使用 musl 版本 `opencode-linux-x64-baseline-musl`：

```dockerfile
COPY packages/opencode/dist/opencode-linux-x64-baseline-musl/bin/opencode /usr/local/bin/opencode
```

**重要规则**：
- **Alpine 基础镜像** → 用 `*-musl` 变体
- **Ubuntu/Debian 基础镜像** → 用普通 `linux-x64` 变体

---

## 镜像导出与迁移

### 导出镜像为 tar 文件

```powershell
cd D:\ai\opencode
powershell -ExecutionPolicy Bypass -File .\docker\export.ps1
```

或手动：
```powershell
docker save -o D:\AI\yejian-opencode-v0.0.1.tar yejian-opencode:v0.0.1
```

**输出文件**：`D:\AI\yejian-opencode-v0.0.1.tar`（约 130MB）

### 在其他电脑加载镜像

#### 前提条件
- 目标电脑已安装 Docker
- 目标电脑与原电脑架构一致（x64 ↔ x64，arm64 ↔ arm64）

#### 操作步骤

1. **复制 tar 文件**到目标电脑（U盘、网盘等）

2. **加载镜像**：
   ```powershell
   docker load -i D:\AI\yejian-opencode-v0.0.1.tar
   ```

3. **验证加载成功**：
   ```powershell
   docker images
   # 应该能看到 yejian-opencode:v0.0.1
   ```

4. **启动容器**（同上文第 4 步）

### 跨平台注意事项

| 源平台 | 目标平台 | 是否可直接迁移 |
|--------|----------|----------------|
| Windows x64 | Windows x64 | ✅ 可以 |
| Windows x64 | Linux x64 | ⚠️ 需要重新构建 |
| Linux x64 | Windows x64 | ⚠️ 需要重新构建 |
| macOS | Windows/Linux | ⚠️ 需要重新构建 |

**跨平台重新构建**：
```bash
# 在目标平台使用 buildx
docker buildx build --platform linux/amd64 -t yejian-opencode:v0.0.1 -f docker/Dockerfile .
```

---

## 常用命令速查

### 查看镜像
```powershell
docker images
```

### 查看容器
```powershell
docker ps                # 运行中的
docker ps -a             # 全部
```

### 查看日志
```powershell
docker logs -f yejian-AIworkbench
```

### 进入容器
```powershell
docker exec -it yejian-AIworkbench sh
```

### 停止容器
```powershell
docker stop yejian-AIworkbench
```

### 删除容器
```powershell
docker rm -f yejian-AIworkbench
```

### 删除镜像
```powershell
docker rmi yejian-opencode:v0.0.1
```

### 查看镜像详情
```powershell
docker inspect yejian-opencode:v0.0.1
```

---

## 文件清单

```
docker/
├── Dockerfile         # Docker 镜像构建配置
├── build.ps1          # 构建并启动（一键）
├── run.ps1            # 仅启动容器
├── cleanup.ps1        # 清理容器
└── export.ps1         # 导出镜像
```

---

## 参考资料

- [Bun 官方文档](https://bun.sh/docs)
- [Docker 官方文档](https://docs.docker.com/)
- [opencode GitHub 仓库](https://github.com/opencode-ai/opencode)

---

## 变更记录

| 版本 | 日期 | 变更内容 |
|------|------|----------|
| v0.0.1 | 2026-06-13 | 首次构建，从源码生成多平台二进制并打包为 Docker 镜像 |
| v0.0.2 | 2026-06-14 | 嵌入 Web UI，网页端品牌定制：浏览器标签标题改为「广东冶建图审AI工作台」、favicon 指向 LOGO1.ico、「新建会话」页面 wordmark 替换为 ai-workbench.png；alpine 标签固定到 3.21.3 |
