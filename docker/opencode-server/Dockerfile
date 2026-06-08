FROM oven/bun:1.3-alpine
ARG OPENCODE_VERSION=1.16.2
RUN bun add -g opencode-ai@${OPENCODE_VERSION}
WORKDIR /workspace
EXPOSE 4096
ENTRYPOINT ["opencode", "serve", "--port", "4096", "--hostname", "0.0.0.0"]
