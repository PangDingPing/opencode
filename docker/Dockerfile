<<<<<<< HEAD
# opencode Docker image - Run from source
# Uses Bun as runtime, executes TypeScript source directly

FROM oven/bun:1.2.4-debian

# Install runtime dependencies
RUN apt-get update && apt-get install -y --no-install-recommends \
    ripgrep \
    && rm -rf /var/lib/apt/lists/*

# Set working directory to project root
WORKDIR /app

# Copy entire project (dockerignore excludes unnecessary files)
COPY . .

# Install dependencies
RUN bun install --force

# Install cross-platform native modules
RUN bun install --force @opentui/core @parcel/watcher @ff-labs/fff-bun

# Expose port
EXPOSE 8088

# Entry point: run web service
ENTRYPOINT ["bun", "run", "--cwd", "packages/opencode", "src/index.ts", "web"]

# Default arguments
=======
# opencode Docker image - Uses pre-built Linux x64 musl binary
# Build the binary first via: bun run script/build.ts --skip-embed-web-ui
# (from packages/opencode directory)
# This produces all platforms including:
#   packages/opencode/dist/opencode-linux-x64-baseline-musl/bin/opencode
# We use the baseline-musl variant because Alpine uses musl libc (not glibc)

FROM alpine:3.21

# Install runtime dependencies
RUN apk add --no-cache libgcc libstdc++ ripgrep

# Disable Bun's runtime transpiler cache (not useful in ephemeral containers)
ARG BUN_RUNTIME_TRANSPILER_CACHE_PATH=0
ENV BUN_RUNTIME_TRANSPILER_CACHE_PATH=${BUN_RUNTIME_TRANSPILER_CACHE_PATH}

# Copy the pre-built musl binary (Alpine uses musl libc, not glibc)
COPY packages/opencode/dist/opencode-linux-x64-baseline-musl/bin/opencode /usr/local/bin/opencode

# Make the binary executable
RUN chmod +x /usr/local/bin/opencode

# Test the binary
RUN opencode --version

# Expose web port
EXPOSE 8088

# Entry point: run web service
ENTRYPOINT ["opencode", "web"]

# Default arguments: listen on all interfaces, port 8088
>>>>>>> feat-build-docker-image-TMggJ0
CMD ["--hostname", "0.0.0.0", "--port", "8088"]