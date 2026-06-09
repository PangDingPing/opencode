FROM oven/bun:1.3-alpine
ARG OPENCODE_VERSION=1.16.2

# 全局 bun 安装目录改到 /opt/bun-global，避免与 compose 挂载的 /root volume 冲突
# （否则宿主空目录挂到 /root 后会覆盖 bun 装到 /root/.bun 的全局包）
ENV BUN_INSTALL=/opt/bun-global
ENV PATH=/opt/bun-global/bin:$PATH

RUN bun add -g opencode-ai@${OPENCODE_VERSION}

WORKDIR /workspace
EXPOSE 4096
ENTRYPOINT ["opencode", "serve", "--port", "4096", "--hostname", "0.0.0.0"]
