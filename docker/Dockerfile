# opencode Docker image - Uses pre-built Linux x64 musl binary
# Build the binary first via: bun run script/build.ts
# (from packages/opencode directory)
# This produces all platforms including:
#   packages/opencode/dist/opencode-linux-x64-baseline-musl/bin/opencode
# We use the baseline-musl variant because Alpine uses musl libc (not glibc)

FROM alpine:3.21.3

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
CMD ["--hostname", "0.0.0.0", "--port", "8088"]
