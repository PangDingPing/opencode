# syntax=docker/dockerfile:1.4
# opencode Docker image - Multi-stage build (Alpine + musl)
#
# v0.1.6: skill 依赖更新（对齐 2026-09-04 重装的 skills 目录）
#         - npm 全局新增 pptx skill 依赖：pptxgenjs react-icons react react-dom sharp
#         - requirements-ppt.txt 对齐新版 ppt-master（+PyYAML/XlsxWriter/skia-pathops/uharfbuzz，
#           移除旧 svglib 方案）
#         - requirements.txt 新增 python-docx（online-to-md Word 拆分）
#         - 内置 TZ=Asia/Shanghai + tzdata（v0.1.5 后已有）
#         - 本版镜像包含 20260905 会话隔离 SSE 归属过滤修复
#
# v0.0.8: 构建加速优化 + 回到 musl/Alpine 方案
#         - 国内镜像源（apk 阿里云 / pip 清华 / npm 淘宝 / bun 淘宝）
#         - 完善 BuildKit 缓存挂载（apk/bun/pip/npm 下载缓存持久化）
#         - musl baseline binary + Alpine（v0.0.3 已验证能运行）
#         - glibc baseline binary 在 Debian 容器里挂起，弃用
#         - --version 验证加 timeout 防止挂起
#
# 构建时间对比（首次 → 有缓存）：
#   v0.0.6: 6-7 小时 → 3-4 小时（glibc baseline，会挂起）
#   v0.0.8: 1-2 小时 → 10-20 分钟（musl baseline + 国内源 + 全缓存）

# ============ Stage 1: builder ============
# 在 Alpine 容器里编译 musl baseline binary
# Alpine 环境自动安装 musl native binding，无需交叉编译
FROM oven/bun:1.3.14-alpine AS builder

WORKDIR /build

# 安装 git + python3 + build-essential
# - git: Script 模块获取 channel（设了 OPENCODE_CHANNEL 可绕过）
# - python3 make g++: node-gyp 编译 native 模块（tree-sitter-powershell 等）
# 阿里云 Alpine 镜像源 + cache 挂载加速
RUN --mount=type=cache,target=/var/cache/apk,sharing=locked \
    sed -i 's|dl-cdn.alpinelinux.org|mirrors.aliyun.com|g' /etc/apk/repositories && \
    apk add --update --cache-dir /var/cache/apk git ca-certificates python3 make g++

# COPY 源代码（.dockerignore 排除了 node_modules/dist/.git）
COPY . .

# 修改 packages/app/package.json，把 ghostty-web 的 github 引用改为本地 file 引用
# 容器内无法访问 GitHub，主机已预先把 ghostty-web 源码放到 vendor/ghostty-web/
RUN sed -i 's|"ghostty-web": "github:anomalyco/ghostty-web#main"|"ghostty-web": "file:../../vendor/ghostty-web"|' packages/app/package.json

# 安装依赖（在 Alpine/musl 容器里安装，native binding 是 musl 版本）
# 国内 npm 镜像（淘宝）+ cache 挂载持久化 bun 下载缓存
ENV BUN_CONFIG_REGISTRY=https://registry.npmmirror.com
RUN --mount=type=cache,target=/root/.bun/install/cache \
    bun install

# 编译 binary
# 设置 OPENCODE_CHANNEL 和 OPENCODE_VERSION 避免 Script 模块访问 npm registry / git
# 设置 MODELS_DEV_API_JSON 避免 build.ts 联网下载 models.dev/api.json（国内无法访问）
#   - docker/models-dev-api.json 是预先缓存的 models.dev 快照，COPY . . 时已复制到 /build/docker/
# --docker-build: 只编译 Linux x64 baseline musl（Alpine 兼容）
ENV OPENCODE_CHANNEL=latest
ENV OPENCODE_VERSION=1.17.6
ENV MODELS_DEV_API_JSON=/build/docker/models-dev-api.json
RUN cd packages/opencode && bun run script/build.ts --docker-build

# 验证 binary（先跳过，后续在 runtime 阶段验证）
# RUN timeout 30 packages/opencode/dist/opencode-linux-x64-musl/bin/opencode --version

# ============ Stage 2: runtime ============
FROM alpine:3.20

# Disable Bun's runtime transpiler cache (not useful in ephemeral containers)
ARG BUN_RUNTIME_TRANSPILER_CACHE_PATH=0
ENV BUN_RUNTIME_TRANSPILER_CACHE_PATH=${BUN_RUNTIME_TRANSPILER_CACHE_PATH}

# yejian: 服务端时区固定为东八区（北京时间）。
# 容器默认 UTC 会导致 system prompt 里的日期、日志与默认会话标题时间偏慢 8 小时
ENV TZ=Asia/Shanghai

# 阿里云 Alpine 镜像源 + 启用 community 仓库（libreoffice 在 community 里）
# 一次性装齐所有系统包
# - libgcc libstdc++   : opencode 二进制运行时依赖（musl 版本）
# - ripgrep            : opencode 内置代码搜索
# - xdg-utils          : opencode 启动时尝试打开浏览器所需
# - bash git curl      : 常用工具 (排查 / 调试)
# - nodejs npm         : docx / pdf / xlsx 等 skill 需要 node 生态
# - python3 py3-pip    : 上述 skill 同样依赖 python 生态
# - libreoffice        : docx 转换 + xlsx 公式重算 (300MB, 必需)
# - poppler-utils      : pdftoppm / pdftotext / pdfimages
# - poppler-data       : pdf 编码数据
# - qpdf               : pdf 合并/拆分/解密
# - ca-certificates    : HTTPS 证书
# - tzdata             : 时区数据（配合 TZ=Asia/Shanghai）
# 使用 cache 挂载加速 apk 下载（缓存持久化，下次构建跳过下载）
RUN --mount=type=cache,target=/var/cache/apk,sharing=locked \
    sed -i 's|dl-cdn.alpinelinux.org|mirrors.aliyun.com|g' /etc/apk/repositories && \
    apk add --update --cache-dir=/var/cache/apk \
    libgcc libstdc++ ripgrep xdg-utils \
    bash git curl ca-certificates \
    nodejs npm \
    python3 py3-pip \
    libreoffice \
    poppler-utils poppler-data qpdf tzdata

# npm 淘宝镜像源
RUN npm config set registry https://registry.npmmirror.com

# 安装 uv (edge-tts skill 专用, uvx edge-tts)
# 使用 cache 挂载持久化 pip 下载缓存
RUN --mount=type=cache,target=/root/.cache/pip \
    pip install --break-system-packages uv

# 安装 pnpm (skill 需要)
# 使用 cache 挂载持久化 npm 下载缓存
RUN --mount=type=cache,target=/root/.npm \
    npm install -g pnpm

# COPY 编译好的 musl AVX2 binary from builder stage
COPY --from=builder /build/packages/opencode/dist/opencode-linux-x64-musl/bin/opencode /usr/local/bin/opencode
RUN chmod +x /usr/local/bin/opencode

# ---- 分层优化：requirements 前置 ----
# 先 COPY requirements 文件，再装依赖
# 这样改源码不会触发 pip 重新安装，只有改 requirements.txt 才会

# 用 uv pip 安装 Python 包到系统 site-packages
# 国内 PyPI 镜像（阿里云）+ cache 挂载持久化 uv 下载缓存
# v0.1.4: 清华源对 uv/pip 客户端持续返回 403，改为阿里云源
ENV UV_INDEX_URL=https://mirrors.aliyun.com/pypi/simple
COPY docker/requirements.txt /tmp/requirements.txt
RUN --mount=type=cache,target=/root/.cache/uv \
    uv pip install --system --break-system-packages -r /tmp/requirements.txt \
 && rm -f /tmp/requirements.txt

# 安装 ppt-master skill 依赖（17 个 Python 包，v0.0.6 新增）
COPY docker/requirements-ppt.txt /tmp/requirements-ppt.txt
RUN --mount=type=cache,target=/root/.cache/uv \
    uv pip install --system --break-system-packages -r /tmp/requirements-ppt.txt \
 && rm -f /tmp/requirements-ppt.txt

# 用 npm 安装全局包
# - docx             : docx skill + document-format 公文排版 + 绿建审查报告生成
# - pdf-lib pdfjs-dist: pdf skill JS 路线
# - pptxgenjs        : pptx skill（PPT 生成）
# - react-icons react react-dom sharp : pptx skill 图标渲染（react-icons → SVG → sharp 栅格化）
# v0.1.6: 新增 pptx skill 5 个包；sharp 会按 musl 自动选择 linuxmusl 预编译二进制
# 使用 cache 挂载持久化 npm 下载缓存
RUN --mount=type=cache,target=/root/.npm \
    npm install -g docx pdf-lib pdfjs-dist pptxgenjs react-icons react react-dom sharp

# 烤入多用户预置清单（v0.0.6 新增）
COPY docker/seed-users.json /etc/opencode/seed-users.json
ENV OPENCODE_SEED_USERS_FILE=/etc/opencode/seed-users.json

# 验证 binary 和运行时（先跳过 opencode --version，用 strace 调试挂起问题）
RUN timeout 30 node --version \
 && timeout 30 python3 --version \
 && timeout 30 uv --version

# Expose web port
EXPOSE 8088

# Entry point: run web service
ENTRYPOINT ["opencode", "web"]

# Default arguments: listen on all interfaces, port 8088
CMD ["--hostname", "0.0.0.0", "--port", "8088"]
