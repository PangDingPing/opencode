#!/bin/bash
set -e
cd "$(dirname "$0")/.."
echo "=== AI 工作台健康检查 ==="
echo "[1/5] 容器状态："
docker compose ps
echo ""
echo "[2/5] opencode-server 最近 30 行日志："
docker compose logs --tail=30 opencode-server
echo ""
echo "[3/5] nginx 最近 30 行日志："
docker compose logs --tail=30 nginx
echo ""
echo "[4/5] 检查工作区目录："
ls "${WORKSPACE_PATH:-/workspace}" 2>/dev/null || echo "(工作区目录不存在或环境变量未设置)"
echo ""
echo "[5/5] 检查 opencode 日志目录："
ls "${DATA_PATH:-/data}/root/.opencode/logs" 2>/dev/null || echo "(无日志或目录不存在)"
echo "=== 检查完成 ==="
