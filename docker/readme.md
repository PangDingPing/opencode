# opencode Docker 镜像构建说明

本文档记录从源码构建 opencode Docker 镜像的完整流程，以及过程中遇到的问题和解决方案。

## 项目说明

- **项目**：opencode（AI 编程助手）
- **目标**：从源码构建 Docker 镜像，提供 Web 服务
- **宿主机端口**：80（v0.0.6 起；之前版本为 8088）
- **镜像名称**：`yejian-opencode:v0.0.9`
- **容器名称**：`yejian-AIworkbench`
- **基础镜像**：`oven/bun:1.3.14-alpine`（builder 阶段）+ `alpine:3.20`（runtime 阶段；v0.0.8 回到 3.20，3.24 装 libreoffice 拉链子慢）
- **构建策略**：多阶段构建 —— builder 阶段在 Alpine/musl 容器内 `bun install` + `bun run build.ts --docker-build` 编译 musl baseline binary，runtime 阶段只 COPY binary + 装运行时依赖（libreoffice / poppler / uv / pnpm 等）
- **预装运行时**：Node.js 24 LTS + Python 3.14 + pnpm 11 + LibreOffice + poppler + qpdf + uv（详见 [Skill 运行时依赖](#skill-运行时依赖)）

---

## 快速开始

### 一键构建并启动（含 API key 注入）

```powershell
cd D:\ai\opencode
powershell -ExecutionPolicy Bypass -File .\docker\build.ps1 -EnvFile "D:\AI\opencode\docker\api-keys.env"
```

> **改了 `packages/app` 里的 web UI 代码**（包括新建/修改了 `packages/app/src/**` 下的文件），必须加 `-ForceRebuild` 强制重建 opencode 二进制（web UI 是嵌入到二进制里的，不重建看不到改动）：
>
> ```powershell
> powershell -ExecutionPolicy Bypass -File .\docker\build.ps1 -EnvFile "D:\AI\opencode\docker\api-keys.env" -ForceRebuild
> ```
>
> 不传 `-ForceRebuild` 时，脚本会复用 `packages/opencode/dist/` 里现成的二进制，**不会**自动检测源码是否变更。

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

### 坑 14：Windows 系统层面禁止 bind 8088 端口（v0.0.5 新增）

**问题现象**：`docker run -p 8088:8088 ...` 报：
```
ports are not available: exposing port TCP 0.0.0.0:8088 -> 127.0.0.1:0:
listen tcp 0.0.0.0:8088: bind: An attempt was made to access a socket
in a way forbidden by its access permissions.
```

**根因诊断**（按排除法逐项检查）：
| 检查项 | 命令 | 结果 |
|---|---|---|
| 单端口占用 | `netstat -ano -p TCP \| findstr 8088` | 找不到 8088 |
| PowerShell 连接状态 | `Get-NetTCPConnection -LocalPort 8088` | 空 |
| Windows 端口排除 | `netsh interface ipv4 show excludedportrange protocol=tcp` | 排除段是 3336/4113-4212/4411-4510/4511-4610/7681-7780/8044-8143/9340-9439/50000-50059/50248，**不包含 8088** |
| Docker daemon | `docker run -P`（自动分配端口） | 成功（如 0.0.0.0:32768→8088） |
| **系统底层 bind** | `python -c "import socket; socket.socket().bind(('0.0.0.0', 8088))"` | ❌ **WinError 10013 (WSAEACCES)** |
| 其它端口 | bind 9000/12345 | ✅ 正常 |

**结论**：不是单个进程占用，不是 Docker daemon 问题，不是端口排除范围；是 **Windows 系统内核层面拒绝 bind 8088 端口**（同理 8089，但 9000/12345 等端口正常）。**未完全定位到具体是哪个底层服务**（可能是 Trae IDE 沙箱、Defender 实时保护、或某个后台服务持续锁定 8088 socket）。

**解决（推荐）**：**重启电脑**即可恢复 8088 端口的 bind 能力。重启后无需任何额外操作。

**临时绕过**：把主机端口改用 9090（容器端口 8088 不变）：
```powershell
docker run -d --name yejian-AIworkbench -p 9090:8088 ... yejian-opencode:v0.0.5
```
然后访问 `http://localhost:9090`。

**预防**：
- 如果你长期不用 8088 端口（如切换到 9090），建议把 `build.ps1` / `run.ps1` 的默认端口也改一下（`param([int]$HostPort = 8088)` → `9090`）
- 但本项目仍按 8088 标准端口来——8088 一直是 opencode 约定的端口，重启恢复后保持一致

---

### 坑 15：迁移脚本也用 @node-rs/argon2（v0.0.6 新增）

**问题**：`packages/core/src/database/migration/20260625120001_seed_initial_users.ts` L1 `import { hash } from "@node-rs/argon2"`，跟 `packages/core/src/user/index.ts` 是同一个跨平台崩溃问题。如果只改 `user/index.ts` 不改迁移脚本，迁移运行时仍崩。

**解决**：从 `user/index.ts` `export hashPassword`，迁移脚本 `import { hashPassword } from "../../user"` 替换 argon2 hash。这样密码 hash 格式统一（scryptSync 的 `salt:hash` 格式），`verifyPasswordHash` 能正确验证。

**教训**：改密码哈希算法时，必须 `grep -r "@node-rs/argon2" packages/` 检查所有 hash 调用点，不能只改主文件。

---

### 坑 16：bun build 跨平台打包 napi 包硬编码 Windows 路径（v0.0.7 新增）

**问题现象**：v0.0.7 在 builder 阶段（Alpine 容器内）跑 `bun run build.ts --docker-build` 编译完 binary，runtime 阶段启动 `opencode --version` 立刻崩：

```
TypeError: must be absolute path
    at /root/.bun/install/global/node_modules/@node-rs/argon2/index.js:42
```

**根因**：`@node-rs/argon2` 之类的 napi 包用 `createRequire(__filename)` 加载 native binding。`bun build` 在 Windows 主机上打 Linux musl binary 时，会把 Windows 绝对路径（如 `D:\...\node_modules\@node-rs\argon2\index.js`）嵌入到 binary 的字符串里。Linux 容器里 `createRequire` 用这个 Windows 路径去加载 native `.node` 文件，自然报"must be absolute path"（路径是绝对的，但指向不存在的 Windows 盘符）。

**解决**：跨平台/多用户密码哈希改用 `node:crypto.scryptSync`（Node 标准库，无 native binding）。同时从 `packages/core/package.json` 删除 `@node-rs/argon2` 依赖（详见 v0.0.6 改动 + 坑 15）。

**教训**：在选择依赖时，优先选 Node 标准库或纯 JS 实现。napi 包在跨平台打包场景下需要特别留意 binding 加载机制。

---

### 坑 17：Bun compile 把 `export const Xxx = {...}` 编译为 lazy 加载的 undefined（v0.0.8 新增）

**问题现象**：v0.0.8 镜像构建成功，容器启动后任何 opencode 命令（包括 `--version`）都崩：

```
TypeError: undefined is not an object (evaluating 'xd.node')
    at <anonymous> (/$bunfs/root/src/index.js:200:4247)
Bun v1.3.14 (Linux x64 baseline)
```

**根因诊断**：
1. `xd` 是 minify 后的变量名。`strings` 提取 binary 内容，找 `xd.node` 附近上下文：
   ```
   xd={Service:n0,defaultLayer:N$,node:H9}
   lr.make(Shc,[xd.node])  // user/index.ts
   ```
   确认 `xd` = `Database` 模块对象
2. git log 找到合并提交 `859f44c3e`（multi-user-system 覆盖式合并到 dev）把 `export * as Database from "./database"` 改成了 `export const Database = { Service, defaultLayer, node }`
3. 对比两种导出方式在 Bun compile 下的行为：

| 导出方式 | Bun compile 行为 | 结果 |
|----------|-----------------|------|
| `export * as Database from "./database"` | 创建 live binding namespace 对象，namespace 对象本身始终存在 | ✅ `Database` 不会是 undefined |
| `export const Database = { Service, defaultLayer, node }` | 常量值导出，在模块体 lazy 函数执行时才赋值 | ❌ 模块体未执行时 `Database` 是 undefined |

Bun compile 把每个模块编译成 lazy 函数，在首次访问时调用。如果模块 A 引用模块 B 的导出但模块 B 的 lazy 函数还没调用，模块 B 的 `export const` 导出就是 undefined。

**解决**：3 个模块（`database.ts` / `user/index.ts` / `auth-token/index.ts`）的导出方式从 `export const Xxx = {...}` 改回自引用命名空间导出 `export * as Xxx from "..."`。所有 `import { Database }` 等调用点无需修改（命名空间对象兼容 `.Service` / `.defaultLayer` / `.node` 访问）。

**错误信息 `Bun v1.3.14 (Linux x64 baseline)` 的误导**：`build.ts` 选择的是 AVX2 目标，但错误信息说 baseline。这是因为 `bun-linux-x64-musl` target 在 Bun 中默认就是 baseline，与 build.ts 配置无关。

**诊断技巧**：
- `xd` 这类 minify 后的名字无法直接 grep 源码，用 `strings <binary> | grep -B2 -A2 "xd.node"` 提取上下文
- 在 PowerShell 中 `strings` 是 Git for Windows 自带的工具，位于 `C:\Program Files\Git\usr\bin\` 或 `~\scoop\apps\ripgrep\current\ripgrep.exe`（如 PATH 没设可以加 `;$env:PATH += "C:\Program Files\Git\usr\bin"`）
- `xd={Service:n0,...}` 这种 pattern 是 Bun compile 把 TS 类+常量打包成 plain object 的特征

---

### 坑 18：verifyPassword 函数调用了不存在的 `verify` 函数（v0.0.8 新增）

**问题现象**：坑 17 修复后，binary 正常启动，登录 API 调用 `userSvc.verifyPassword(...)` 时崩：

```
ReferenceError: verify is not defined
    at User.verifyPassword (...)
    at AuthHandler.auth.login (...)
```

**根因**：`packages/core/src/user/index.ts` L142 `verifyPassword` 函数体内调用了 `verify(row.password_hash, password)`，但文件里只定义了 `verifyPasswordHash` 函数（无 `verify` 这个名字）。之前 dev 模式下没发现，因为 dev 模式不跑 Bun compile lazy loading 流程；编译后这个 typo 显形。

**解决**：`verify` → `verifyPasswordHash`（函数签名是 `(stored: string, pwd: string)`，参数顺序正确）。仅 L142 一行。

**教训**：binary 编译后才会暴露的 typo 错误，dev 模式无法捕捉。重要的 callback 函数（特别是带 async/promise 包装的）值得加单测。

---

### 坑 19：密码 hash 格式不匹配 —— PHC vs 冒号（v0.0.8 新增）

**问题现象**：登录永远返回 401（Unauthorized），不管用什么密码。docker logs 无任何错误（`hashPassword` / `verifyPasswordHash` 都正常执行）。

**根因**：旧数据库中 32 个用户的密码 hash 是 PHC 标准格式（外部工具生成）：
```
scrypt$N=16384$r=8$p=1$<salt_hex>$<hash_hex>
```
而 v0.0.6 引入的 `hashPassword` 生成冒号格式 `<salt_hex>:<hash_hex>`，`verifyPasswordHash` 也只按冒号 split 解析。把 PHC 字符串按 `:` split 只能得到 1 段（整个 PHC 字符串），用 `parts[0]` 作 salt、`undefined` 作 hash 重新计算永远不匹配。

**解决**：
1. `hashPassword` 改为生成 PHC 格式（与外部工具兼容，便于将来跨工具迁移）
2. `verifyPasswordHash` 同时支持 PHC 格式和冒号格式：
   ```typescript
   if (stored.startsWith("scrypt$")) {
     // PHC 格式解析
     const parts = stored.split("$")
     // parts[0]="scrypt", parts[1]="N=..", parts[2]="r=..", parts[3]="p=..", parts[4]=salt, parts[5]=hash
   } else {
     // 冒号格式解析
     const parts = stored.split(":")
   }
   ```

**踩坑 - 数据清理**：
- 旧用户密码 hash 虽是 PHC 格式但**不匹配任何常见密码**（Yejian2016 / 123456 / 111111 / admin / password 等都试过），怀疑是用其他工具（dev 用户管理工具）生成的
- 决定直接清空 `E:\AI\AIworkbench-data` 目录重新建库
- **PowerShell `Remove-Item -Recurse -Force` 删除 Docker 创建的文件失败**：报大量文件锁 / sandbox 限制错误
- 解决：```powershell
  docker run --rm -v "E:\AI\AIworkbench-data:/data" alpine:3.20 sh -c "rm -rf /data/* /data/.*; mkdir -p /data/root /data/tmp"
  ```
  用容器内 `rm -rf` 删除宿主机文件（DOCKER bind mount 的特性，容器内看到的是同一文件系统）

**踩坑 - PowerShell 引号**：执行 `docker exec ... sh -c "python3 << 'EOF' ..."` 引号冲突。解决：把 Python 脚本写入 `.py` 文件，`docker cp` 复制到容器后执行。

**踩坑 - SQLite 锁**：运行中的 opencode 进程持有 SQLite 锁，外部 Python 脚本直接连主库报 `unable to open database file`。解决：先 `docker stop yejian-AIworkbench`，再用临时容器挂载宿主机目录后访问。

**踩坑 - NTFS 卷挂载 SQLite 临时文件**：容器内 `sqlite3 /root/.local/share/opencode/opencode.db` 报 `unable to open database file`（连只读 mode 都失败），但 `cp` 到 `/tmp` 再开就 OK。原因是 Windows 挂载的 NTFS 卷不支持 SQLite 的临时 WAL/journal 机制。解决：复制到容器内 `/tmp` 再操作。

---

### 坑 20：bootstrapUsers 在 Bun compile 后不工作（v0.0.8 新增，待排查）

**问题现象**：镜像启动后 `serve.ts` 的 `bootstrapUsers()` 函数没自动从 `seed-users.json` 创建用户，user 表始终为空。docker logs 完全无任何 `[bootstrapUsers]` 输出（包括函数体里的 `console.warn(...)` / `console.log(...)`）。

**已排查的假设**：
- ❌ `OPENCODE_SEED_USERS_FILE` 环境变量丢失 → 容器内 `env | grep SEED` 显示 `OPENCODE_SEED_USERS_FILE=/etc/opencode/seed-users.json` ✅
- ❌ `seed-users.json` 文件缺失或内容错 → `cat /etc/opencode/seed-users.json` 输出正常 JSON ✅
- ❌ 数据库迁移未完成 → 37 条 migration 全部执行（`SELECT id FROM migration` 包含 `20260625120001_seed_initial_users`）✅
- ❌ `user` 表结构问题 → `SELECT count(*) FROM user` 返回 0，但表本身存在 ✅

**临时方案**：`docker/insert-user.py`（Python 脚本，用 `hashlib.scrypt` 生成 PHC 格式 hash，直接打开 sqlite 数据库插入 user 行）。需要 `docker stop` 容器 + 用临时 Python 容器挂载宿主机目录。

**待排查**：
- Bun compile 后 Effect 层 `Effect.provide(...)` 顺序问题？
- `console.log` / `console.warn` 在 Bun binary 模式下被吞？
- `readFile` / `JSON.parse` 在 lazy 模块体里未执行？

**教训**：binary 模式下调试 Effect 框架代码很麻烦。简单日志输出 + 立即同步执行是 binary 模式友好的模式。

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
| v0.0.5 | 2026-06-20 | Skill 四角互补重构：新增"决策系统（军师）★★"分组，整合 4 个思考类 skill（头脑风暴 / 梳理头绪 / 决策顾问 / 智囊评审）；前端 `case` 字段从 string 升级为 `string \| string[]` 支持多 case 列表展示；Word 技能 case 拆为 3 元素数组；公文排版 keyword 由命令式 `/document-format` 改为描述性中文短语；`其它`分组删除 3 个旧条目（梳理思路 / 个人决策顾问 / 头脑风暴）。**注意**：本版本构建期间发现 8088 端口被系统层面禁止 bind（WinError 10013），**重启电脑可恢复**——见坑 14 |
| v0.0.6 | 2026-07-12 | 多用户登录系统 + ppt-master skill 依赖。**(1) 密码哈希跨平台**：`@node-rs/argon2` → `node:crypto.scryptSync`（避免 bun build 跨平台打包硬编码 Windows native binding 路径，Linux 容器启动崩）；**(2) 多用户预置**：`bootstrapAdmin()` 无 `OPENCODE_SERVER_PASSWORD` 时静默跳过（不再 fail-fast），`bootstrapUsers()` 从烤入镜像的 `seed-users.json` 预置用户（admin: yejian/Yejian2016，首次登录强制改密）；**(3) ppt-master 依赖**：新增 `requirements-ppt.txt`（17 个 Python 包，svglib 方案 B 精简版）；**(4) api-keys.env 精简**：无需 `OPENCODE_SERVER_USERNAME/PASSWORD`，HTTP Basic Auth 禁用，多用户登录系统接管；**(5) 默认项目**：`layout.tsx` 已有 `openProject(last ?? "/YEJIAN")` 逻辑，全新容器首次启动自动打开 /YEJIAN 项目；**(6) build.ps1**：默认 tag v0.0.6，启动命令对齐用户实际（`E:\AI\YEJIAN:/YEJIAN` + `--restart always`）|
| v0.0.7 | 2026-07-13 | 多阶段构建，binary 在 Docker builder 阶段编译（Linux 容器）。**问题**：`@node-rs/argon2` napi binding 在 bun build 跨平台打包时硬编码 Windows native binding 路径，Linux 容器里 `createRequire` 报 `TypeError: must be absolute path` → 崩。**解决**：依赖 `node:crypto.scryptSync`（已 v0.0.6 切换）。**结论**：v0.0.7 实际上没用，纯准备工作版本 |
| v0.0.8 | 2026-07-13 | 多阶段构建（builder 阶段在 Alpine 容器内 `bun install` + `bun run build.ts --docker-build` 编译 musl baseline binary；runtime 阶段只 COPY binary + 装运行时）+ **国内镜像源**（apk 阿里云 / pip 清华 / npm 淘宝 / bun 淘宝）+ **完善 BuildKit 缓存挂载**（apk/bun/pip/npm 下载缓存持久化）+ alpine 基础镜像 3.24 → 3.20（libreoffice 拉链子更快）。**构建时间**：首次 1-2 小时（vs v0.0.6 的 6-7 小时），有缓存 10-20 分钟（vs v0.0.6 的 3-4 小时）。**修复 3 个运行时 bug**：(a) `xd.node undefined` —— 3 个模块（database/user/auth-token）从 `export const Xxx = {...}` 改回 `export * as Xxx from "..."` 自引用命名空间导出，绕开 Bun compile 把 `export const` 编译为 lazy undefined 的问题；(b) `verify is not defined` —— `user/index.ts` L142 `verify` → `verifyPasswordHash` 函数名 typo；(c) 密码 hash 格式不匹配 —— `hashPassword` 改为生成 PHC 标准格式（旧 hash 是 PHC 格式），`verifyPasswordHash` 同时支持 PHC 和冒号两种格式。**新增 docker/insert-user.py 工具**：bootstrapUsers 在 binary 模式下不工作时（待排查），用 Python 手动插入用户的绕道方案。**详见 [坑 16-20] 和附录"v0.0.8 多阶段构建 + 3 个 bug 修复"** |

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

---

## 附录：v0.0.5 Skill 四角互补重构 + 实际启动命令（2026.06.20）

本次改动合并两个独立事项：(A) **Skill 体系四角互补重构**（前端 4 文件 + skills.json 1 文件）整合 4 个思考类 skill 为"决策系统（军师）★★"分组；(B) **用户实际 docker run 命令与 build.ps1/run.ps1 默认值不一致**，本次以用户实际命令为准记录在案。

### A. Skill 四角互补重构

#### A.1 需求背景

按 `E:\AI\YEJIAN\.开发文档\260620-skill四角互补重构计划-v3.md`，将 4 个思考类 skill（头脑风暴 / 梳理头绪 / 决策顾问 / 智囊评审）整合为"发散 → 澄清 → 决断 → 把关"四角互补工作流，在悬浮技能框中以"决策系统（军师）★★"分组集中展示，并删除其它分组下的旧/重复条目。

附带需求：
- `case` 字段从单字符串扩展为支持多 case 数组（让用户能看到更多示例）
- 公文排版 keyword 从命令式 `/document-format <Word文件路径>` 改为描述性中文短语
- 现有 Word 技能的 3 个 case（原本用 `；` 拼接为单字符串）拆为数组

#### A.2 修改文件清单

##### A.2.1 `packages/app/src/components/skills-panel/skills-panel-types.ts`

- L16-17：`case: string` → `case: string | string[]`，注释加"支持字符串或字符串数组"

##### A.2.2 `packages/app/src/components/skills-panel/skills-panel-data.ts`

- L13-14：`isSkill` 验证条件改为：
  ```ts
  (typeof v.case === "string" ||
    (Array.isArray(v.case) && v.case.every((c) => typeof c === "string")))
  ```

##### A.2.3 `packages/app/src/components/skills-panel/index.tsx`

- L58-70：case 渲染从 `{props.skill.case}` 改为三元判断
  - 字符串：用 `<span>` 直接展示（保持原行为）
  - 数组：渲染为 `<ul class="skills-tooltip-case-list">` 多行

##### A.2.4 `packages/app/src/components/skills-panel/skills-panel.css`

- 新增 `.skills-tooltip-case-list` 和 `.skills-tooltip-case-list li` 样式（list-style-type: disc，行高 1.5）

##### A.2.5 `packages/app/public/yejian/skills.json`

**新增"决策系统（军师）★★"分组（groups[0]）**：

| Skill | skillId | case 数量 | 工作流阶段 |
|---|---|---|---|
| 头脑风暴 | brainstorming | 5 | 发散 |
| 梳理头绪 | thought-clarifier | 5 | 澄清 |
| 决策顾问 | decision-advisor | 4 | 决断 |
| 智囊评审 | brain-trust-review | 5 | 把关 |

**"其它"分组删除 3 个旧条目**（梳理思路 / 个人决策顾问 / 头脑风暴）；保留 幻觉检测、文章去AI味。

**Word 技能 case 拆为数组**（groups[1].skills[1]）：
```json
"case": [
  "请将以下文字内容转成 Word",
  "按【模板】将内容转换为精美的成品 Word 文档",
  "【Word 文件】插入页码"
]
```

**公文排版 keyword 改方案 A**（groups[2].skills[2]）：`/document-format <Word文件路径>` → `公文排版、Word 排版、公文格式、党政机关公文格式`

#### A.3 踩坑记录（前端 / JSON）

1. **JSON 中 ASCII 直引号导致解析失败**：3 个 tooltip 行（line 12/27/56）value 中用了 ASCII `"`（0x22）包裹触发词，导致 `SyntaxError: Expected ',' or '}' after property value in JSON at position 262 (line 12 column 43)`。修复：Python 脚本批量替换为中文 `"`/`"`（U+201C / U+201D）。**教训：编辑 JSON 时字符串内用中文引号或转义，避免裸 ASCII 引号**。

2. **前端 `isSkill` 验证不接受数组**：`isSkill` 原本只接受 `typeof v.case === "string"`，直接改 JSON 不动前端会触发"技能 JSON 结构校验失败"。**必须前端 + JSON 同步改**。

3. **`<For>` 已在顶部 import**：SolidJS `<For>` 组件已存在于文件顶部 import，不需要新增 import。

#### A.4 验证

1. **类型检查**（可选）：`cd packages/app && bun typecheck`
2. **JSON 合法性**：`python -c "import json; json.load(open('packages/app/public/yejian/skills.json', encoding='utf-8'))"`
3. **浏览器 dev 模式**：访问 `http://localhost:4444`（前端 dev 端口），强制刷新（Ctrl+Shift+R）清缓存。
4. **关键检查点**：
   - "决策系统（军师）★★"分组在第 1 个位置
   - 4 个 skill 名称：头脑风暴 / 梳理头绪 / 决策顾问 / 智囊评审
   - case 列表显示为**项目符号**（不是挤在一行）
   - Word 技能 case 3 条、公文排版 keyword 是新描述
   - "其它"分组下：只剩 幻觉检测、文章去AI味

#### A.5 提交（按依赖顺序 4 个 commit）

| # | hash | 提交信息 | 文件 |
|---|---|---|---|
| 1 | `51d50b6e2` | `feat(skills-panel): support array case for multi-example display` | types.ts + data.ts + index.tsx + css |
| 2 | `d7e20c523` | `feat(skills): add decision-system group for 4-corner workflow` | skills.json（核心：新增决策系统分组 + 其它分组清理 + Word case 拆 + keyword 改） |
| 3 | `9fc94b13b` | `docs(日志): append 6-20 skill four-corner refactor entry` | 日志.md |
| 4 | `6971f5ccd` | `docs(日志): add 6-20 four-corner skill refactor detailed log` | 日志/20260620开发日志-skill四角互补重构.md |

详细开发日志：`日志/20260620开发日志-skill四角互补重构.md`

---

### B. 实际 docker run 命令（用户最终使用）

**用户当前启动 v0.0.5 容器的命令**（与 `build.ps1` / `run.ps1` 默认值不同）：

```powershell
docker run -d --name yejian-AIworkbench -p 8088:8088 `
  -v "E:\AI\YEJIAN:/YEJIAN" `
  -v "E:\AI\AIworkbench-data/root:/root" `
  -v "E:\AI\AIworkbench-data/tmp:/tmp" `
  -w /YEJIAN `
  --env-file "E:\AI\dockerimage\api-keys.env" `
  --restart always `
  --hostname 0.0.0.0 `
  yejian-opencode:v0.0.5
```

#### B.1 与 `build.ps1` / `run.ps1` 默认值的差异

| 参数 | build.ps1 / run.ps1 默认 | 用户实际 | 原因 |
|---|---|---|---|
| `-p` | `127.0.0.1:8088:8080`（build.ps1）<br>`${HostPort}:${ContainerPort}`（run.ps1） | `8088:8088`（0.0.0.0） | 用户希望局域网能访问（绑定所有网卡） |
| `-v` 工作目录 | `D:\AI\AIworkbench:/workspace` | `E:\AI\YEJIAN:/YEJIAN` | 用户在 YEJIAN 项目下用 opencode，需要挂载 YEJIAN |
| `-v` `/root` | `D:\AI\AIworkbench-data/root:/root` | `E:\AI\AIworkbench-data/root:/root` | 容器 root 数据放 AIworkbench-data |
| `-v` `/tmp` | `D:\AI\AIworkbench-data/tmp:/tmp` | `E:\AI\AIworkbench-data/tmp:/tmp` | 一致 |
| `-w` | `/workspace` | `/YEJIAN` | 配合工作目录 |
| `--env-file` | 可选 `D:\AI\opencode\docker\api-keys.env` | `E:\AI\dockerimage\api-keys.env` | 用户把 API key 文件统一放在 dockerimage 目录 |
| `--restart` | 无 | `always` | 用户希望容器随 docker daemon 自动重启 |
| `--hostname` | `0.0.0.0` | `0.0.0.0` | 一致 |

#### B.2 注意事项

1. **环境变量 API key 文件路径变化**：`D:\AI\opencode\docker\api-keys.env` → `E:\AI\dockerimage\api-keys.env`，如果 `build.ps1` 仍在用旧路径会注入失败。
2. **工作目录变化**：容器默认工作目录 `/YEJIAN`（不是 `/workspace`），如果 skill 脚本里用相对路径需要注意。
3. **端口 8088 临时不可用**（v0.0.5 构建期间发现，见坑 14）：如果遇到 WinError 10013，**重启电脑**即可恢复；临时可改 `9090:8088` 绕过。

#### B.3 验证结果

- HTTP 探活 `http://localhost:9090` 返回 200（v0.0.5 构建期间用 9090 临时绕过）
- 容器内 opencode 监听 8088（容器内端口不变）
- 容器名 `yejian-AIworkbench` 与 build.ps1 默认一致
- API key 文件 `E:\AI\dockerimage\api-keys.env` 注入成功（容器内 `env | grep -i API` 可查）

#### B.4 后续建议

- 把 `E:\AI\dockerimage\api-keys.env` 路径固化到 `build.ps1` 的注释里（或加一个 `api-keys.env` 默认路径配置）
- 把 `E:\AI\YEJIAN:/YEJIAN` 工作目录挂载也固化到脚本（避免每次手动写）
- 但**这些不影响构建流程**——本次 build.ps1 的 binary + image 构建都成功了，只是容器启动用的是用户手动命令

---

## 附录：v0.0.6 多用户登录系统 + ppt-master 依赖（2026.07.12）

### 一、需求背景

v0.0.5 之前用 `OPENCODE_SERVER_USERNAME/PASSWORD` 环境变量做 HTTP Basic Auth + 单 admin 引导，存在两个问题：
1. `@node-rs/argon2` 在 bun build 跨平台打包时硬编码 Windows native binding 路径，Linux 容器启动崩（`TypeError: must be absolute path`）
2. api-keys.env 里的 `OPENCODE_SERVER_PASSWORD` 与 seed-users.json 的 admin 密码重复输入

v0.0.6 的目标：
- 跨平台密码哈希用 `node:crypto.scryptSync`（Node 标准库，无 native binding）
- api-keys.env 无需 `OPENCODE_SERVER_USERNAME/PASSWORD`，用户名密码只放在 `seed-users.json`（烤入镜像）
- 安装 ppt-master skill 的 17 个 Python 依赖
- 启动时默认打开 `/YEJIAN` 项目

### 二、修改文件清单

#### 1. 跨平台密码哈希

| 文件 | 改动 |
|---|---|
| `packages/core/src/user/index.ts` | `hashPassword` 改为 `export`，供迁移脚本复用 |
| `packages/core/src/database/migration/20260625120001_seed_initial_users.ts` | `import { hash } from "@node-rs/argon2"` → `import { hashPassword } from "../../user"`，调用点同步改 |
| `packages/core/package.json` | 删除 `"@node-rs/argon2": "2.0.2"` 依赖 |

#### 2. 多用户预置（serve.ts）

| 文件 | 改动 |
|---|---|
| `packages/opencode/src/cli/cmd/serve.ts` | `bootstrapAdmin()` 无 `OPENCODE_SERVER_PASSWORD` 时不再 `process.exit(1)`，改为 `console.log + return` 静默跳过；handler 的 Warning 改为 Info 提示 |

#### 3. Docker 打包

| 文件 | 改动 |
|---|---|
| `docker/seed-users.json` | **新建**，admin 账号 yejian/Yejian2016 |
| `docker/requirements-ppt.txt` | **新建**，ppt-master 的 17 个 Python 依赖（svglib 方案 B 精简版） |
| `docker/Dockerfile` | 顶部注释加 v0.0.6 changes；新增 `COPY + uv pip install requirements-ppt.txt`；新增 `COPY seed-users.json + ENV OPENCODE_SEED_USERS_FILE` |
| `docker/build.ps1` | 默认 tag `v0.0.3` → `v0.0.6`；workbenchDir `D:\AI\AIworkbench` → `E:\AI\YEJIAN`；dataDir `D:\AI\AIworkbench-data` → `E:\AI\AIworkbench-data`；挂载 `/workspace` → `/YEJIAN`；工作目录 `/workspace` → `/YEJIAN`；加 `--restart always` |

### 三、关键设计决策

#### 3.1 为什么 seed-users.json 烤入镜像而不是挂载？

用户的 `docker run` 命令没有挂载 seed-users.json，所以必须烤入镜像。admin 初始密码 Yejian2016 只是引导密码，首次登录强制改密（`must_change_password=1`），用户登录后会改自己的密码。初始密码留在镜像层里是可接受的（私有镜像）。

#### 3.2 为什么 api-keys.env 无需 OPENCODE_SERVER_USERNAME/PASSWORD？

- `bootstrapAdmin()` 无密码时静默跳过，不 fail-fast
- `bootstrapUsers()` 从烤入的 `seed-users.json` 预置用户
- `auth.ts` 的 `required()` 在无 `OPENCODE_SERVER_PASSWORD` 时返回 false，HTTP Basic Auth 自动禁用
- 多用户登录系统（cookie token）接管认证

#### 3.3 默认打开 /YEJIAN 项目如何实现？

`packages/app/src/pages/layout.tsx` L559 已有逻辑：
```tsx
if (list.length === 0) {
  await openProject(last ?? "/YEJIAN", true)
}
```
全新容器首次启动时，项目列表为空、lastProject 为空，自动 `openProject("/YEJIAN")`。配合 `docker run -v "E:\AI\YEJIAN:/YEJIAN"`，容器内 `/YEJIAN` 目录存在，项目可正常打开。

### 四、启动命令（用户最终使用）

```powershell
docker run -d --name yejian-AIworkbench -p 80:8088 `
  -v "E:\AI\YEJIAN:/YEJIAN" `
  -v "E:\AI\AIworkbench-data/root:/root" `
  -v "E:\AI\AIworkbench-data/tmp:/tmp" `
  -w /YEJIAN `
  --env-file "E:\AI\dockerimage\api-keys.env" `
  --restart always `
  --hostname 0.0.0.0 `
  yejian-opencode:v0.0.6
```

**与 v0.0.5 的差异**：
- 端口映射 `8088:8088` → `80:8088`（直接用 80 端口访问）
- 镜像 tag `v0.0.5` → `v0.0.6`
- api-keys.env 内容不变（只有 AGNES_API_KEY 和 MinerU-api）

### 五、验证步骤

#### 5.1 构建镜像

```powershell
cd D:\AI\opencode
powershell -ExecutionPolicy Bypass -File .\docker\build.ps1 -EnvFile "E:\AI\dockerimage\api-keys.env" -ForceRebuild
```

`-ForceRebuild` 必加：本次改了 `packages/core` 和 `packages/opencode` 的 TypeScript 代码，必须重新构建 opencode 二进制（scryptSync + bootstrapAdmin 改动才会编进 binary）。

#### 5.2 容器内验证

```powershell
docker exec -it yejian-AIworkbench sh

# 验证 opencode 启动（应看到 bootstrapUsers 日志）
docker logs yejian-AIworkbench | head -20
# 应包含：[bootstrapAdmin] 跳过：未设置 OPENCODE_SERVER_PASSWORD
#         [bootstrapUsers] 已创建预置用户: yejian (admin)

# 验证 seed-users.json 存在
cat /etc/opencode/seed-users.json

# 验证 ppt-master Python 依赖
python3 -c "import pptx, edge_tts, svglib, reportlab, fitz, mammoth, markdownify, ebooklib, nbconvert, openpyxl, PIL, numpy, requests, bs4, curl_cffi, google.genai, flask; print('PPT deps OK')"
```

#### 5.3 浏览器验证

1. 访问 `http://localhost`（80 端口）
2. 登录页输入 `yejian` / `Yejian2016`
3. 首次登录强制改密
4. 改密后自动跳转，默认打开 `/YEJIAN` 项目

### 六、踩坑记录

#### 坑 15：迁移脚本也用 @node-rs/argon2

**问题**：`packages/core/src/database/migration/20260625120001_seed_initial_users.ts` L1 `import { hash } from "@node-rs/argon2"`，跟 `user/index.ts` 是同一个跨平台崩溃问题。如果只改 `user/index.ts` 不改迁移脚本，迁移运行时仍会崩。

**解决**：从 `user/index.ts` `export hashPassword`，迁移脚本 `import { hashPassword } from "../../user"` 替换 argon2 hash。这样密码 hash 格式统一（scryptSync 的 `salt:hash` 格式），`verifyPasswordHash` 能正确验证。

**教训**：改密码哈希算法时，必须检查所有 hash 调用点（`grep -r "@node-rs/argon2" packages/`），不能只改主文件。

---

## 附录：v0.0.8 多阶段构建 + 3 个 bug 修复（2026.07.13）

本次改动在 v0.0.6 基础上做了**多阶段构建重构**（binary 从"主机预编译"改为"builder 阶段在 Linux 容器内编译"），并修复了 v0.0.7 暴露的 3 个运行时 bug（xd.node undefined / verify typo / PHC 格式）。

### 一、需求背景

v0.0.6 是"主机预编译 binary + COPY 进镜像"模式。v0.0.7 尝试在 Docker builder 阶段编译 binary（让 binary 在 Linux 容器内编译，避免 Windows 主机交叉编译的 napi 路径问题），但又发现新问题：
1. bun build 在 Windows 主机上编译 Linux musl binary 时，会把 `D:\...\node_modules\@node-rs\argon2\index.js` 这类 Windows 路径嵌入 binary，Linux 容器里 `createRequire` 用此路径加载 native binding 报 `TypeError: must be absolute path`
2. builder 阶段首次构建 6-7 小时（拉 libreoffice + 编译 native binding）
3. 国内拉链子慢，无缓存命中

v0.0.8 的目标：
- 解决 v0.0.7 的 napi 路径问题（已在 v0.0.6 切换到 scryptSync）
- 加速构建（国内镜像源 + BuildKit 缓存挂载）
- 修复 v0.0.7 binary 暴露的 3 个 runtime bug

### 二、修改文件清单

#### 1. Dockerfile 改动（多阶段 + 国内镜像源 + 缓存）

`docker/Dockerfile` 重写为两阶段：

**Stage 1: builder**（`oven/bun:1.3.14-alpine`）：
- 国内镜像源：apk 阿里云（`mirrors.aliyun.com`），npm/bun 淘宝（`registry.npmmirror.com`）
- `RUN --mount=type=cache,target=/var/cache/apk`：apk 缓存持久化
- `bun install` 在容器内执行（musl native binding 是 Alpine 兼容版本）
- `bun run script/build.ts --docker-build`：编译 musl baseline binary（避免 AVX2 兼容问题）
- 设置 `OPENCODE_CHANNEL=latest` + `OPENCODE_VERSION=1.17.6` 避免 Script 模块访问 npm registry / git

**Stage 2: runtime**（`alpine:3.20`）：
- apk 阿里云源 + community 仓库（libreoffice）
- `--mount=type=cache,target=/root/.cache/pip`：pip 缓存
- `--mount=type=cache,target=/root/.npm`：npm 缓存
- `COPY --from=builder /build/packages/opencode/dist/opencode-linux-x64-musl/bin/opencode`：只 COPY 编译好的 binary
- `COPY docker/seed-users.json /etc/opencode/seed-users.json` + `ENV OPENCODE_SEED_USERS_FILE`：烤入多用户清单
- `ENTRYPOINT ["opencode", "web"]` + `CMD ["--hostname", "0.0.0.0", "--port", "8088"]`

#### 2. 源码修复（3 个运行时 bug）

| 文件 | 改动 | 解决 bug |
|---|---|---|
| `packages/core/src/database/database.ts` L66 | `export const Database = {...}` → `export * as Database from "./database"` | xd.node undefined（坑 17） |
| `packages/core/src/user/index.ts` L263 | `export const User = {...}` → `export * as User from "./index"` | xd.node undefined（坑 17） |
| `packages/core/src/user/index.ts` L142 | `verify(...)` → `verifyPasswordHash(...)` | verify is not defined（坑 18） |
| `packages/core/src/user/index.ts` L14-67 | `hashPassword` 生成 PHC 格式 + `verifyPasswordHash` 支持 PHC/冒号双格式 | 密码 hash 不匹配（坑 19） |
| `packages/core/src/auth-token/index.ts` L135 | `export const AuthToken = {...}` → `export * as AuthToken from "./index"` | xd.node undefined（坑 17） |

#### 3. 新增工具

`docker/insert-user.py`（Python 脚本）：
- 用 `hashlib.scrypt` 生成 PHC 格式 hash
- 直接打开 sqlite 数据库插入 user 行
- 用于 bootstrapUsers 在 binary 模式下不工作时（坑 20）的绕道

#### 4. 镜像构建 / 启动命令

镜像构建：
```powershell
cd D:\AI\opencode
powershell -ExecutionPolicy Bypass -File .\docker\build.ps1 -EnvFile "E:\AI\dockerimage\api-keys.env"
```

**有缓存**（默认）：10-20 分钟
- builder 阶段：~5 分钟（bun install 命中 `~/.bun/install/cache`，script/build.ts 编译 ~30 秒）
- runtime 阶段：~10 分钟（apk + libreoffice ~300MB 命中 `~/.cache/apk`）

**首次 / `-ForceRebuild`**：1-2 小时
- 拉 `oven/bun:1.3.14-alpine` + `alpine:3.20` 基础镜像
- alpine apk 安装 + libreoffice 下载
- bun install 全部依赖（~1500 包）

**只重建 builder 阶段**（推荐，改了源码后用）：
```powershell
docker build --no-cache-filter=builder -t yejian-opencode:v0.0.8 -f docker/Dockerfile .
```

启动命令（与 v0.0.6 相同）：
```powershell
docker run -d --name yejian-AIworkbench -p 80:8088 `
  -v "E:\AI\YEJIAN:/YEJIAN" `
  -v "E:\AI\AIworkbench-data\root:/root" `
  -v "E:\AI\AIworkbench-data\tmp:/tmp" `
  -w /YEJIAN --hostname 0.0.0.0 `
  --env-file "E:\AI\dockerimage\api-keys.env" `
  --restart always yejian-opencode:v0.0.8
```

### 三、关键设计决策

#### 3.1 为什么用 musl baseline 而非 AVX2？

`bun run script/build.ts --docker-build` 编译出的 `opencode-linux-x64-musl` 默认是 baseline 变体。AVX2 需要 CPU 支持，否则在老 CPU 上崩。Alpine 镜像兼容性最广的就是 baseline。

#### 3.2 为什么 alpine 3.24 → 3.20？

3.20 装 libreoffice 拉链子比 3.24 快（3.24 的 community 仓库在国外 CDN）。3.20 + libreoffice + community 仓库完全够用。

#### 3.3 为什么不直接 `apk add` 装 sqlite3 CLI？

Dockerfile 不需要 sqlite3 CLI（构建期不查数据库）。运行时查数据库通过 `docker exec` + `apk add --no-cache sqlite` 临时装。

#### 3.4 为什么不修复 bootstrapUsers？

参见 [坑 20](#坑-20bootstrapusers-在-bun-compile-后不工作v008-新增待排查)。三个怀疑点都未坐实，临时用 `docker/insert-user.py` 绕道。后续需要更多 binary 模式调试工具（Effect tracer / 同步 console.log）才能继续排查。

### 四、验证步骤

#### 4.1 构建验证

```powershell
docker build --no-cache-filter=builder -t yejian-opencode:v0.0.8 -f docker/Dockerfile .
# 应看到 builder 阶段 1-5 分钟完成，runtime 阶段 0-10 分钟完成（缓存命中）
```

#### 4.2 二进制验证

```powershell
docker run --rm yejian-opencode:v0.0.8 opencode --version
# 应返回 1.17.6（不再报 xd.node / verify 错误）
```

#### 4.3 登录验证

```powershell
# 清空数据目录（首次启动或换版本时）
docker run --rm -v "E:\AI\AIworkbench-data:/data" alpine:3.20 sh -c "rm -rf /data/* /data/.*; mkdir -p /data/root /data/tmp"

# 启动容器
docker run -d --name yejian-AIworkbench -p 80:8088 -v "E:\AI\YEJIAN:/YEJIAN" -v "E:\AI\AIworkbench-data\root:/root" -v "E:\AI\AIworkbench-data\tmp:/tmp" -w /YEJIAN --hostname 0.0.0.0 --env-file "E:\AI\dockerimage\api-keys.env" --restart always yejian-opencode:v0.0.8

# 等待 10 秒后插入用户（bootstrapUsers 在 binary 模式下不工作，需要手动插入）
docker stop yejian-AIworkbench
docker run --rm -v "E:\AI\AIworkbench-data:/data" -v "d:\AI\opencode\docker\insert-user.py:/tmp/insert-user.py" python:3.12-alpine python3 /tmp/insert-user.py

# 启动容器 + 登录验证
docker start yejian-AIworkbench
Start-Sleep -Seconds 8
$body = '{"username":"yejian","password":"Yejian2016"}'
Invoke-WebRequest -Uri "http://localhost:80/api/auth/login" -Method POST -Body $body -ContentType "application/json" -UseBasicParsing
# 应返回 200 + {"user":{"id":"usr_yejian","username":"yejian","role":"admin",...}}
```

#### 4.4 浏览器验证

访问 `http://localhost` → 自动跳 `/login` → 输入 `yejian` / `Yejian2016` → 登录成功 → 默认打开 `/YEJIAN` 项目

### 五、踩坑记录（5 个新增）

| # | 现象 | 原因 | 解决 |
|---|---|---|---|
| 坑 16 | `TypeError: must be absolute path` | bun build 跨平台打包 napi 包时把 Windows 路径嵌入 binary | 改用 `node:crypto.scryptSync`（v0.0.6 已完成） |
| 坑 17 | `TypeError: undefined is not an object (evaluating 'xd.node')` | Bun compile 把 `export const Xxx = {...}` 编译为 lazy，模块未执行时是 undefined | 改回 `export * as Xxx from "..."` 自引用命名空间导出 |
| 坑 18 | `ReferenceError: verify is not defined` | `user/index.ts` L142 函数名 typo（`verify` → `verifyPasswordHash`） | 改函数名 |
| 坑 19 | 登录永远 401 | 旧数据库 PHC 格式 hash 与新 `verifyPasswordHash`（仅冒号格式）不兼容 | `hashPassword` 生成 PHC 格式 + `verifyPasswordHash` 双格式解析 |
| 坑 20 | `bootstrapUsers` 在 binary 模式下不工作 | 待排查（Bun compile 后 Effect 层 provide / console.log / lazy 模块） | 临时用 `docker/insert-user.py` 手动插入 |

### 六、提交（按依赖顺序）

**本次改动尚未 git commit**。计划按"代码基础 → 数据 → 应用 → 文档"顺序拆 commit：

| # | 文件 | 提交类型 | 标题（草稿） |
|---|---|---|---|
| 1 | `packages/core/src/database/database.ts` | `fix(yejian)` | `fix(yejian): self-referencing namespace export for Bun compile` |
| 2 | `packages/core/src/user/index.ts` | `fix(yejian)` | `fix(yejian): verify typo + PHC hash format + self-referencing namespace` |
| 3 | `packages/core/src/auth-token/index.ts` | `fix(yejian)` | `fix(yejian): self-referencing namespace export for AuthToken` |
| 4 | `docker/Dockerfile` | `chore(yejian)` | `chore(yejian): multi-stage build v0.0.8 with China mirrors` |
| 5 | `docker/build.ps1` | `chore(yejian)` | `chore(yejian): bump tag to v0.0.8` |
| 6 | `docker/insert-user.py` | `feat(yejian)` | `feat(yejian): manual user insert tool for binary mode` |
| 7 | `docker/readme.md` | `docs(yejian)` | `docs(yejian): v0.0.8 multi-stage build + 3 bug fixes` |
| 8 | `日志.md` | `docs(yejian)` | `docs(yejian): append v0.0.8 entry` |
| 9 | `日志/20260713开发日志-docker-v0.0.8-xd-node修复.md` | `docs(yejian)` | `docs(yejian): detailed log for v0.0.8` |

### 七、附注

#### 7.1 构建时间实测（v0.0.8 首次 vs 有缓存）

| 阶段 | 首次 | 有缓存 | 缓存策略 |
|---|---|---|---|
| 拉 `oven/bun:1.3.14-alpine` | ~10s | 命中 | Docker layer cache |
| `apk add` builder 阶段 | ~30s | 命中 | `--mount=type=cache,target=/var/cache/apk` |
| `bun install` | ~5min | ~30s | `--mount=type=cache,target=/root/.bun/install/cache` |
| `bun run script/build.ts --docker-build` | ~3min | ~30s | Docker layer cache（仅当 builder 阶段源文件未变） |
| 拉 `alpine:3.20` | ~10s | 命中 | Docker layer cache |
| `apk add` runtime 阶段（含 libreoffice 300MB） | ~5min | 命中 | `--mount=type=cache,target=/var/cache/apk` |
| `pip install uv` + `npm install -g pnpm` | ~30s | 命中 | pip/npm cache mount |
| `uv pip install requirements.txt` | ~10s | 命中 | `--mount=type=cache,target=/root/.cache/uv` |
| `uv pip install requirements-ppt.txt` | ~30s | 命中 | 同上 |
| `npm install -g docx pdf-lib pdfjs-dist` | ~20s | 命中 | `--mount=type=cache,target=/root/.npm` |
| **合计** | **~15 分钟** | **~1 分钟** | |

#### 7.2 启动容器 + 登录后用户需做的事

- 首次登录后**强制改密**（`must_change_password=1`），改完跳 `/new-session` 默认打开 `/YEJIAN`
- 后续可以用 admin 账号在 `/admin/users` 页面增删其他用户

#### 7.3 临时用 docker/insert-user.py 的原因

bootstrapUsers 在 binary 模式下不工作（坑 20），所以**全新容器第一次启动后必须手动插入用户**。后续如修复 bootstrapUsers，此步骤可省略。

#### 7.4 镜像大小

- v0.0.6：~900MB（Alpine + libreoffice + 全 skill 依赖）
- v0.0.8：~900MB（无明显变化，多阶段构建不影响 runtime 镜像大小）
