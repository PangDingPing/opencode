#!/bin/bash
set -e
cd "$(dirname "$0")/.."
read -p "请输入同事的 11 位手机号: " PHONE
if [[ ! "$PHONE" =~ ^1[0-9]{10}$ ]]; then
  echo "错误：手机号格式不对，必须是 11 位、以 1 开头"
  exit 1
fi
echo "即将为账号 $PHONE 设置密码（提示后请输入两次密码）..."
docker run --rm -it -v "$PWD/nginx:/etc/nginx" httpd:alpine htpasswd -B /etc/nginx/htpasswd "$PHONE"

# 读 .env 拿 WORKSPACE_PATH
WS=$(grep '^WORKSPACE_PATH=' .env 2>/dev/null | cut -d= -f2)
WS=${WS:-/workspace}
mkdir -p "${WS}/user-${PHONE}"

echo "完成：账号 $PHONE 已添加，项目目录 ${WS}/user-${PHONE} 已创建。"
echo "同事可访问 http://你的服务器IP:8088 用此手机号登录。"
