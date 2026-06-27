# opencode Docker image - Uses pre-built Linux x64 musl binary
# Build the binary first via: bun run script/build.ts
# (from packages/opencode directory)
# This produces all platforms including:
#   packages/opencode/dist/opencode-linux-x64-baseline-musl/bin/opencode
# We use the baseline-musl variant because Alpine uses musl libc (not glibc)
#
# v0.0.3 changes:
#   - Upgrade base image from Alpine 3.21.3 to 3.24.1
#   - Add Node.js 24 LTS, Python 3.14, pnpm 11 (skills runtime deps)
#   - Add LibreOffice (docx/xlsx 转换与公式重算)
#   - Add poppler-utils + qpdf (pdf 处理)
#   - Add uv (edge-tts skill 专用)
#   - 用 uv pip 安装 12 个 Python 包
#   - 用 npm 安装 3 个全局 NPM 包
#   - 不装 tesseract / OCR (按需 docker exec 进去装)

FROM alpine:3.24.1

# Disable Bun's runtime transpiler cache (not useful in ephemeral containers)
ARG BUN_RUNTIME_TRANSPILER_CACHE_PATH=0
ENV BUN_RUNTIME_TRANSPILER_CACHE_PATH=${BUN_RUNTIME_TRANSPILER_CACHE_PATH}

# 一次性装齐所有系统包
# - libgcc/libstdc++  : opencode 二进制运行时依赖
# - ripgrep           : opencode 内置代码搜索
# - xdg-utils         : opencode 启动时尝试打开浏览器所需
# - bash git curl     : 常用工具 (排查 / 调试)
# - nodejs npm pnpm   : docx / pdf / xlsx 等 skill 需要 node 生态
# - python3 py3-pip   : 上述 skill 同样依赖 python 生态
# - uv                : edge-tts skill 专用 (uvx edge-tts)
# - libreoffice       : docx 转换 + xlsx 公式重算 (300MB, 必需)
# - poppler-utils     : pdftoppm / pdftotext / pdfimages
# - poppler-data      : pdf 编码数据
# - qpdf              : pdf 合并/拆分/解密
# 不装: tesseract (OCR, 按需安装) / font-noto-cjk (CJK 字体, 按需安装)
RUN apk add --no-cache \
    libgcc libstdc++ ripgrep xdg-utils \
    bash git curl ca-certificates \
    nodejs npm pnpm \
    python3 py3-pip \
    uv \
    libreoffice \
    poppler-utils poppler-data qpdf

# Copy the pre-built musl binary (Alpine uses musl libc, not glibc)
COPY packages/opencode/dist/opencode-linux-x64-baseline-musl/bin/opencode /usr/local/bin/opencode
RUN chmod +x /usr/local/bin/opencode

# 用 uv pip 安装 12 个 Python 包到系统 site-packages
# uv 比 pip 快 10~100 倍,且会自动处理依赖冲突
# --break-system-packages: Python 3.14 启用了 PEP 668 (Alpine 3.24 的 python3 自带 externally-managed 标记)
#                          镜像里我们就是包管理者,可放心打破这个保护
COPY docker/requirements.txt /tmp/requirements.txt
RUN uv pip install --system --break-system-packages --no-cache -r /tmp/requirements.txt \
 && rm -f /tmp/requirements.txt

# 用 npm 安装 3 个全局包
# - docx       : docx skill 创建新文档
# - pdf-lib    : pdf skill (reference.md) JS 操作
# - pdfjs-dist : pdf skill (reference.md) JS 解析
RUN npm install -g --silent docx pdf-lib pdfjs-dist \
 && npm cache clean --force

# Test the binary
RUN opencode --version \
 && node --version \
 && python3 --version \
 && uv --version

# Expose web port
EXPOSE 8088

# Entry point: run web service
ENTRYPOINT ["opencode", "web"]

# Default arguments: listen on all interfaces, port 8088
CMD ["--hostname", "0.0.0.0", "--port", "8088"]
