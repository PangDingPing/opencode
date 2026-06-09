#!/bin/bash
set -e
cd "$(dirname "$0")/../../yejian"
bun install
bun run build
echo "构建完成。nginx 容器自动 serve 新文件，无需重启。"
