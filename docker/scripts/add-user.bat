@echo off
chcp 65001 >nul
set /p PHONE=请输入同事的 11 位手机号：

echo %PHONE%| findstr /R "^1[0-9][0-9][0-9][0-9][0-9][0-9][0-9][0-9][0-9][0-9]$" >nul
if errorlevel 1 (
    echo 错误：手机号格式不对，必须是 11 位、以 1 开头。
    pause
    exit /b 1
)

cd /d %~dp0\..
echo 即将为账号 %PHONE% 设置密码（提示后请输入两次密码）...
docker run --rm -it -v %CD%\nginx:/etc/nginx httpd:alpine htpasswd -B /etc/nginx/htpasswd %PHONE%
if errorlevel 1 (
    echo 密码设置失败。
    pause
    exit /b 1
)

REM 读 .env 拿 WORKSPACE_PATH
for /f "tokens=2 delims==" %%a in ('findstr "^WORKSPACE_PATH=" .env 2^>nul') do set WS=%%a
if "%WS%"=="" set WS=D:/AI/AIworkbench

if not exist "%WS%\user-%PHONE%" mkdir "%WS%\user-%PHONE%"
echo.
echo 完成：账号 %PHONE% 已添加，项目目录 %WS%\user-%PHONE% 已创建。
echo 同事现在可以打开 http://你的服务器IP:8088 用此手机号登录。
pause
