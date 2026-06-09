@echo off
chcp 65001 >nul
echo === AI 工作台健康检查 ===
echo.
cd /d %~dp0\..
echo [1/5] 容器状态：
docker compose ps
echo.
echo [2/5] opencode-server 最近 30 行日志：
docker compose logs --tail=30 opencode-server
echo.
echo [3/5] nginx 最近 30 行日志：
docker compose logs --tail=30 nginx
echo.
echo [4/5] 检查工作区目录：
if defined WORKSPACE_PATH (
    dir "%WORKSPACE_PATH%"
) else (
    echo WORKSPACE_PATH 未设置，从 .env 读
)
echo.
echo [5/5] 检查 opencode 数据目录：
if defined DATA_PATH (
    dir "%DATA_PATH%\root\.opencode\logs" 2>nul
) else (
    echo DATA_PATH 未设置
)
echo.
echo === 检查完成 ===
pause
