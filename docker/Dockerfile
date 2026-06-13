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
CMD ["--hostname", "0.0.0.0", "--port", "8088"]