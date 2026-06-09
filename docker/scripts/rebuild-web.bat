@echo off
chcp 65001 >nul
echo === 重新构建 yejian web ===
cd /d %~dp0\..\..\yejian
call bun install
call bun run build
if errorlevel 1 (
    echo 构建失败。
    pause
    exit /b 1
)
echo 构建完成。nginx 容器自动 serve 新文件，无需重启。
pause
