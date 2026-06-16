# opencode Docker 镜像构建说明

本文档记录从源码构建 opencode Docker 镜像的完整流程，以及过程中遇到的问题和解决方案。

## 项目说明

- **项目**：opencode（AI 编程助手）
- **目标**：从源码构建 Docker 镜像，提供 Web 服务
- **宿主机端口**：8088
- **镜像名称**：`yejian-opencode:v0.0.3`
- **容器名称**：`yejian-AIworkbench`
- **基础镜像**：`alpine:3.24.1`（v0.0.3 起）
- **预装运行时**：Node.js 24 LTS + Python 3.14 + pnpm 11 + LibreOffice + poppler + qpdf + uv（详见 [Skill 运行时依赖](#skill-运行时依赖)）

---

## 快速开始

### 一键构建并启动（含 API key 注入）

```powershell
cd D:\ai\opencode
powershell -ExecutionPolicy Bypass -File .\docker\build.ps1 -EnvFile "D:\AI\opencode\docker\api-keys.env"
```

### 单独使用各脚本

| 脚本 | 用途 |
|------|------|
| `build.ps1` | 构建镜像 + 启动容器（可选 `-EnvFile` 注入 API key） |
| `run.ps1` | 启动容器（需要镜像已构建，可选 `-EnvFile`） |
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
bun run script/build.ts                  # 构建所有平台二进制（含 Web UI 嵌入）
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

docker build -t yejian-opencode:v0.0.2 -f docker\Dockerfile .

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
  yejian-opencode:v0.0.2
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

### 坑 10：custom-elements.d.ts 引用语法错误（v0.0.2 新增）

**问题现象**：
```
@opencode-ai/desktop:typecheck: ../app/src/custom-elements.d.ts(1,1): error TS1128: Declaration or statement expected.
@opencode-ai/enterprise:typecheck: src/custom-elements.d.ts(1,1): error TS1128: Declaration or statement expected.
```

**原因**：`packages/app/src/custom-elements.d.ts` 和 `packages/enterprise/src/custom-elements.d.ts` 的内容是单行相对路径字符串：
```
../../ui/src/custom-elements.d.ts
```
这不是合法 TypeScript 语法。`push` 触发的 pre-push hook 跑 `bun turbo typecheck` 时报 TS1128。

**解决**：改为合法的 `///` 引用指令：
```
/// <reference path="../../ui/src/custom-elements.d.ts" />
```

---

### 坑 11：upstream merge 后 patch 文件失效（v0.0.2 新增）

**问题现象**：
```
ENOENT: No such file or directory: failed to apply patches: patches/@ff-labs%2Ffff-bun@0.9.3.patch
```

**原因**：从 `anomalyco/opencode` 拉取最新 dev 后，upstream 已经把 `patches/` 目录下 10 个 patch 文件删了（包升级到不需要 patch 的版本），但仓库根 `package.json` 里的 `patchedDependencies` 字典还引用这 10 个不存在的文件。

**解决**：从 `package.json` 删掉 10 个失效的 `patchedDependencies` 条目，只保留 `patches/` 目录里实际存在的：
```json
"patchedDependencies": {
  "@modelcontextprotocol/sdk@1.29.0": "patches/@modelcontextprotocol%2Fsdk@1.29.0.patch"
}
```

**注意**：执行 `bun install` 时会重新生成 `bun.lock`，需要随同 `package.json` 一起提交。

---

### 坑 12：Windows 上 bun install 的 symlink 权限问题（v0.0.2 新增）

**问题现象**：
```
ENOENT: No such file or directory: failed to symlink dependencies for package: <package-name>
```

**原因**：bun 默认在 Windows 上用符号链接（symlink）创建 `node_modules`，但 Windows 默认不允许普通用户创建 symlink（需要开发者模式或管理员权限）。2350+ 包里 9 个 symlink 失败。

**解决**：用 `bun install --no-symlink` 重新安装（不创建符号链接，慢一点但不需要特殊权限）：
```powershell
bun install --no-symlink
```

**根本性解决**（推荐）：以管理员身份运行 PowerShell 一次执行 `bun install`，或启用 Windows 开发者模式（Settings → Privacy & security → For developers → Developer Mode）。后续每次 `bun install` 就都能正常用 symlink。

---

### 坑 13：Alpine 镜像缺少 xdg-open（v0.0.2 新增）

**问题现象**：
```
error: Executable not found in $PATH: "xdg-open"
```

**原因**：`opencode` 启动时会尝试自动打开浏览器（调用 `xdg-open`），但精简的 Alpine 镜像里没装这个工具。**这只是 opencode CLI 的额外便利功能，不影响 web 服务本身**。

**解决**：忽略这个错误，web 服务已经正常启动并监听 8088 端口。容器仍然可以正常用。

如果想消除这个警告，可以在 `Dockerfile` 的 `apk add` 后面追加 `xdg-utils`：
```dockerfile
RUN apk add --no-cache libgcc libstdc++ ripgrep xdg-utils
```

---

## 镜像导出与迁移

### 导出镜像为 tar 文件

```powershell
cd D:\ai\opencode
powershell -ExecutionPolicy Bypass -File .\docker\export.ps1
```

或手动：
```powershell
docker save -o D:\AI\yejian-opencode-v0.0.2.tar yejian-opencode:v0.0.2
```

**输出文件**：`D:\AI\yejian-opencode-v0.0.2.tar`（约 150MB，含 web UI 资源比 v0.0.1 略大）

### 在其他电脑加载镜像

#### 前提条件
- 目标电脑已安装 Docker
- 目标电脑与原电脑架构一致（x64 ↔ x64，arm64 ↔ arm64）

#### 操作步骤

1. **复制 tar 文件**到目标电脑（U盘、网盘等）

2. **加载镜像**：
   ```powershell
   docker load -i D:\AI\yejian-opencode-v0.0.2.tar
   ```

3. **验证加载成功**：
   ```powershell
   docker images
   # 应该能看到 yejian-opencode:v0.0.2
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
docker buildx build --platform linux/amd64 -t yejian-opencode:v0.0.2 -f docker/Dockerfile .
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
docker rmi yejian-opencode:v0.0.2
```

### 查看镜像详情
```powershell
docker inspect yejian-opencode:v0.0.2
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

## Skill 运行时依赖

v0.0.3 起，镜像里一次性装齐了 `D:\AI\AIworkbench\.trae\skills\` 下 docx / pdf / xlsx / edge-tts 四个 skill 所需的全部系统包和 Python/NPM 包，**直接就能在容器内运行**。

### 预装的系统包（apk）

| 包 | 用途 | 关联 skill |
|---|---|---|
| `libgcc` `libstdc++` | opencode 二进制运行时 | 全部 |
| `ripgrep` `xdg-utils` | opencode 内置 | 全部 |
| `bash` `git` `curl` | 通用工具 / 排查 | 全部 |
| `nodejs` (24 LTS) `npm` `pnpm` (11) | Node 生态 | docx / pdf / xlsx |
| `python3` (3.14) `py3-pip` | Python 生态 | docx / pdf / xlsx |
| `uv` | Python 包管理器（10~100x 比 pip 快） | edge-tts（`uvx edge-tts`）+ Python 包安装 |
| `libreoffice` | `.doc↔.docx` 转换、docx→pdf、xlsx 公式重算 | docx / xlsx（**必需，~300MB**） |
| `poppler-utils` `poppler-data` | `pdftoppm` / `pdftotext` / `pdfimages` | docx / pdf |
| `qpdf` | PDF 合并 / 拆分 / 解密 / 旋转 | pdf |

**没装的系统包**（按需 `docker exec` 进容器手动 `apk add`）：

| 包 | 用途 | 大小 |
|---|---|---|
| `tesseract-ocr` + `tesseract-data-chi_sim` / `chi_tra` | 扫描版 PDF 做 OCR | ~100MB |
| `font-noto-cjk` | PDF 显示中文 | ~50MB |
| `pdf2image` 依赖（系统 `poppler` 实际已装） | — | — |

### 预装的 Python 包（见 `docker/requirements.txt`）

| 包 | 关联 skill |
|---|---|
| `defusedxml` `lxml` | docx / xlsx（XML 解析、schema 校验） |
| `pypdf` `pdfplumber` `pdf2image` `Pillow` `reportlab` `pypdfium2` `pandas` `numpy` | pdf |
| `pytesseract` | pdf（按需，tesseract 引擎需要时再装） |
| `openpyxl` | xlsx |

安装方式：`uv pip install --system --break-system-packages --no-cache -r requirements.txt`（构建时执行一次；`--break-system-packages` 是为了绕过 Python 3.14 的 PEP 668 限制，Docker 镜像里使用完全安全）

### 预装的 NPM 包（全局）

| 包 | 关联 skill |
|---|---|
| `docx` | docx skill 创建新文档（`require('docx')`） |
| `pdf-lib` `pdfjs-dist` | pdf skill（reference.md 中的 JS 用法） |

---

## API key 配置

推荐用 `--env-file` 方式，从宿主机的 `.env` 文件批量注入容器：

### 1. 创建 `api-keys.env`

在 `D:\AI\opencode\docker\` 下新建 `api-keys.env`（**不要提交到 git**）：

```env
ANTHROPIC_API_KEY=sk-ant-xxxxx
OPENAI_API_KEY=sk-xxxxx
OPENCODE_API_KEY=xxxxx
GOOGLE_API_KEY=xxxxx
```

### 2. 启动时传入

```powershell
# build.ps1 一条龙
powershell -ExecutionPolicy Bypass -File .\docker\build.ps1 -EnvFile "D:\AI\opencode\docker\api-keys.env"

# 或者 run.ps1 单独启动
powershell -ExecutionPolicy Bypass -File .\docker\run.ps1 -EnvFile "D:\AI\opencode\docker\api-keys.env"
```

### 3. 验证

```powershell
docker exec -it yejian-AIworkbench sh
echo $ANTHROPIC_API_KEY   # 应该输出 sk-ant-xxxxx
env | grep -i api          # 列出所有 API 相关环境变量
```

### 其它方式对比

| 方式 | 优点 | 缺点 |
|---|---|---|
| `--env-file`（推荐） | 干净、可版本控制 `.env.example` | 文件不能丢 |
| `docker run -e K=V` | 单次灵活 | 多个 key 时命令行很长 |
| Dockerfile 里 `ENV` | 简单 | **key 会进镜像层，不安全** |

---

## 局域网访问配置（v0.0.3 新增）

`localhost:8088` 访问没问题，但**别的机器**用 `http://192.168.x.x:8088` 访问可能连不上 —— 这不是 Docker 构建的问题，是 **Windows 防火墙** 拦截了入站连接。

### 症状

| 入口 | 结果 |
|---|---|
| 本机 `http://localhost:8088` | ✓ 能访问 |
| 同局域网 `http://192.168.x.x:8088` | ✗ 连不上 / 超时 |

### 原因

Docker Desktop on Windows 跑在 WSL2 / Hyper-V 虚拟机里。`docker run -p 8088:8088` 时，Docker Desktop **应当**自动加一条"放行 8088 入站"的 Windows 防火墙规则，但**这一步有时候会失败**（尤其是 `docker load` 镜像启动的容器）。

### 解决：以管理员身份运行 PowerShell，加一条防火墙规则

```powershell
New-NetFirewallRule -DisplayName "opencode web 8088" `
  -Direction Inbound `
  -Protocol TCP `
  -LocalPort 8088 `
  -Action Allow `
  -Profile Any
```

加完规则后，**别的机器立刻就能访问** `http://192.168.x.x:8088`，不用重启容器。

### 验证步骤

```powershell
# 1. 容器端口确实在监听
docker ps
# 看 PORTS 列是不是 0.0.0.0:8088->8088/tcp

# 2. 容器内是绑了 0.0.0.0
docker exec -it yejian-AIworkbench sh -c "netstat -tlnp | grep 8088"
# 应该看到 0.0.0.0:8088，而不是 127.0.0.1:8088

# 3. 同网段另一台机器 ping + 访问
ping 192.168.x.x
curl http://192.168.x.x:8088
```

### 其它可能原因

- Windows 当前网络是"公用网络"（更严格）→ 设置 → 网络 → 改成"专用网络"
- 第三方杀毒软件（360 / 火绒 / 卡巴斯基）拦截 → 临时退出测试
- 公司网段有 ACL 限制 → 找网管确认

---

## 变更记录

| 版本 | 日期 | 变更内容 |
|------|------|----------|
| v0.0.1 | 2026-06-13 | 首次构建，从源码生成多平台二进制并打包为 Docker 镜像 |
| v0.0.2 | 2026-06-14 | 嵌入 Web UI（去除 `--skip-embed-web-ui`），网页端品牌定制：浏览器标签标题改为「广东冶建图审AI工作台」、favicon 指向 LOGO1.ico、「新建会话」页面 wordmark 替换为 ai-workbench.png；alpine 标签固定到 3.21.3；新增 4 个踩坑记录（坑 10/11/12/13） |
| v0.0.3 | 2026-06-16 | Alpine 升到 3.24.1（拿到 Node 24 LTS / Python 3.14 / pnpm 11）；一次性装齐 docx / pdf / xlsx / edge-tts 四个 skill 所需全部运行时（libreoffice / poppler / qpdf / uv + 12 个 Python 包 + 3 个 NPM 包）；`run.ps1` / `build.ps1` 新增 `-EnvFile` 参数支持 `--env-file` 注入 API key；新增 `requirements.txt`；新增"Skill 运行时依赖"和"局域网访问配置"两节 |

---

## 附录：v0.0.3 Docker 升级开发日志（2026.06.16）

本次修改把 opencode Docker 镜像从 v0.0.2 升级到 v0.0.3，主要解决"Skill 运行时依赖缺失"问题（`D:\AI\AIworkbench\.trae\skills\` 下的 docx / pdf / xlsx / edge-tts 四个 skill 在容器内跑不起来），同时把基础镜像从 Alpine 3.21.3 升到 3.24.1（拿到 Node 24 LTS / Python 3.14 / pnpm 11 等新版运行时），并补上 API key 注入和局域网访问说明。

### 一、前置操作

无（基于 v0.0.2 增量升级，未切换分支，沿用 6-15 的 `update-logo` 分支）。

### 二、修改文件清单

#### 1. `docker/Dockerfile`（重写）

- `FROM alpine:3.21.3` → `FROM alpine:3.24.1`
- `RUN apk add --no-cache` 一次性装齐（按类别）：
  - 基础：`libgcc libstdc++ ripgrep xdg-utils`
  - 工具：`bash git curl ca-certificates`
  - Node 生态：`nodejs` (24 LTS) `npm` `pnpm` (11)
  - Python 生态：`python3` (3.14) `py3-pip`
  - 高速包管理器：`uv`（10~100x 比 pip 快）
  - LibreOffice 套件（必需，~300MB）
  - PDF 工具：`poppler-utils` `poppler-data` `qpdf`
- 新增 `COPY docker/requirements.txt /tmp/requirements.txt` + `uv pip install --system --break-system-packages -r ...`：装 12 个 Python 包
- 新增 `npm install -g --silent docx pdf-lib pdfjs-dist && npm cache clean --force`：装 3 个全局 NPM 包
- 新增 `RUN opencode --version && node --version && python3 --version && uv --version` 构建期验证

**关键技巧**：`--break-system-packages` 用于绕过 Python 3.14 启用的 PEP 668 "externally-managed" 标记。Docker 镜像里使用完全安全（一次性构建、容器销毁清零、不存在破坏系统包管理器的风险）。

#### 2. `docker/run.ps1`（重写）

- `param` 新增 `[string]$EnvFile = ""`（可选，传 .env 文件路径，脚本自动用 `--env-file` 注入容器）
- 把所有中文 `Write-Host` 字符串全部改成纯英文（避开 PowerShell 5.1 GBK 编码坑，见坑 1 / 坑 D）
- 启动容器拆成 **两个独立 if/else 分支**（带 envFile / 不带 envFile），避免变量内含空格被 PowerShell 当成单个参数（见坑 C）

#### 3. `docker/build.ps1`（改）

- `param` 新增 `[string]$EnvFile = ""`
- `$ImageTag` 默认值 `v0.0.2` → `v0.0.3`
- 启动容器部分同步拆成两个 if/else 分支
- 其它二进制构建逻辑保持不变

#### 4. `docker/readme.md`（改）

- 顶部信息更新到 v0.0.3
- 新增 "Skill 运行时依赖" 章节（apk 包 / pip 包 / npm 包三张表 + 按需 `apk add` 说明）
- 新增 "API key 配置" 章节（`--env-file` 推荐 + 其它方式对比）
- 新增 "局域网访问配置" 章节（症状 / 原因 / `New-NetFirewallRule` 解法 / 其它可能）
- 末尾 "变更记录" 表加 v0.0.3 行

### 三、新增资源文件

| 文件 | 用途 |
|---|---|
| `docker/requirements.txt` | 12 个 Python 包清单，按 skill 分组注释；Dockerfile 用 `uv pip install` 装到系统 site-packages |

### 四、删除资源文件

无。

### 五、启动验证

#### 5.1 镜像构建

```powershell
cd D:\ai\opencode
powershell -ExecutionPolicy Bypass -File .\docker\build.ps1 -EnvFile "D:\AI\opencode\docker\api-keys.env"
```

构建各阶段耗时（首次拉取依赖；后续 rebuild 会命中缓存）：

| 阶段 | 耗时 | 说明 |
|---|---|---|
| 拉 Alpine 3.24.1 基础镜像 | ~30s | 首次 |
| `apk add` 装所有系统包 | ~9 分钟 | LibreOffice 占大头（~300MB） |
| `uv pip install` 12 个 Python 包 | ~9s | uv 极快 |
| `npm install -g` 3 个 NPM 包 | ~35s | |
| 最终镜像体积 | ~900MB | 从 v0.0.2 的 ~150MB 增加 ~750MB |

#### 5.2 启动容器

```powershell
powershell -ExecutionPolicy Bypass -File .\docker\run.ps1 -EnvFile "D:\AI\opencode\docker\api-keys.env"
```

#### 5.3 容器内逐项验证

```powershell
docker exec -it yejian-AIworkbench sh

# 验证各运行时版本
node --version          # v24.x
python3 --version       # 3.14.x
pnpm --version          # 11.x
uv --version            # uv 0.x
soffice --version       # LibreOffice 信息
pdftotext -v 2>&1 | head -1    # poppler 信息
qpdf --version          # qpdf 信息

# 验证 Python 包（应全部能 import）
python3 -c "import openpyxl, pypdf, pdfplumber, reportlab, defusedxml, lxml, PIL, pandas, numpy, pypdfium2; print('Python deps OK')"

# 验证 NPM 包（应全部能 require）
node -e "require('docx'); require('pdf-lib'); require('pdfjs-dist'); console.log('NPM deps OK')"

# 验证 API key 注入
echo $ANTHROPIC_API_KEY
env | grep -i API
```

#### 5.4 浏览器访问

打开 **http://localhost:8088**，应能看到 opencode Web 界面。局域网访问需先执行 `New-NetFirewallRule` 放行 8088（见 readme.md "局域网访问配置" 章节）。

### 六、附注

#### 6.1 本次新增的 4 个坑

| # | 现象 | 原因 | 解决 |
|---|---|---|---|
| 坑 A | `error: The interpreter at /usr is externally managed`（uv 拒绝装包） | Alpine 3.24 自带的 Python 3.14 启用了 PEP 668，标记系统 Python 归 apk 管、拒绝 pip/uv 安装 | `uv pip install --break-system-packages`（uv 镜像了 pip 的同名参数） |
| 坑 B | `Unable to find image 'run:latest' locally`（Docker 把 `run` 当成镜像名） | PowerShell 的 `@array` splatting 与 Docker CLI 配合有问题 | 改回最原始的"反引号续行 + 字面量参数"写法 |
| 坑 C | `invalid reference format: repository name (library/ --env-file D) must be lowercase` | `$envFileArg = " --env-file \`"$EnvFile\`""` 把"flag + value"塞进一个变量，PowerShell 不会按空格拆分、整体作为一个参数传给 Docker | 把带 envFile / 不带 envFile 拆成两个独立的 if/else 代码分支，每个分支用字面量参数 |
| 坑 D | `字符串缺少终止符: "`（PowerShell 解析失败） | PowerShell 5.1 按 GBK 解析 .ps1 文件，中文字符被当乱码 | PS1 脚本内所有 `Write-Host` 字符串改用纯英文（中文只放 `#` 注释里） |

#### 6.2 镜像体积增量分布

| 组件 | 大小 | 备注 |
|---|---|---|
| LibreOffice | +300MB | 必需（docx 转换 + xlsx 公式重算） |
| Python 12 包 | +200MB | pypdf / pdfplumber / openpyxl 等 |
| Python3 + py3-pip | +70MB | 基础 |
| uv | +50MB | 高速包管理器 |
| Node 3 包 | +50MB | docx / pdf-lib / pdfjs-dist |
| nodejs + npm + pnpm | +50MB | 基础 |
| poppler / poppler-data / qpdf | +15MB | PDF 工具链 |
| bash / git / curl 等 | +5MB | 通用工具 |
| **合计** | **~750MB** | v0.0.2 150MB → v0.0.3 ~900MB |

#### 6.3 暂未安装的可选包（按需 `docker exec` 进去手动 `apk add`）

| 包 | 用途 | 大小 |
|---|---|---|
| `tesseract-ocr` + `tesseract-data-chi_sim` / `chi_tra` | 扫描版 PDF 做 OCR | ~100MB |
| `font-noto-cjk` | PDF 显示中文 | ~50MB |

#### 6.4 局域网访问的"防火墙"问题与构建无关

`localhost:8088` 能访问、`192.168.x.x:8088` 不行，是 Windows 防火墙拦截（`docker run -p` 时 Docker Desktop 有时不会自动加防火墙规则），不是镜像本身的问题。详见 readme.md "局域网访问配置" 章节里的 `New-NetFirewallRule` 解法。

#### 6.5 typecheck / lint

本次仅修改 `docker/` 目录下的 shell / markdown / Dockerfile，未触及 `packages/*` 任何 TypeScript / TSX 代码，无需跑 `bun typecheck`。

### 七、提交列表

**本次改动尚未 git commit**。计划按"代码基础 → 数据 → 应用"顺序拆 5 个 commit（沿用 6-15 起的 `update-logo` 分支）：

| # | 待提交文件 | 提交类型 | 标题（草稿） |
|---|---|---|---|
| 1 | `docker/Dockerfile` | `feat(docker)` | `feat(docker): upgrade to alpine 3.24.1 with full skill runtime` |
| 2 | `docker/requirements.txt` | `feat(docker)` | `feat(docker): add Python deps for docx/pdf/xlsx skills` |
| 3 | `docker/run.ps1` | `feat(docker)` | `feat(docker): add -EnvFile param for API key injection` |
| 4 | `docker/build.ps1` | `chore(docker)` | `chore(docker): bump default tag to v0.0.3` |
| 5 | `docker/readme.md` | `docs(docker)` | `docs(docker): document v0.0.3 changes, skills deps, firewall` |

每个 commit 独立可构建、可回滚。等用户确认后再执行 `git add / commit`（不主动 push）。
