#!/bin/bash
# sImgApi 部署脚本（在服务器上以 root 或 sudo 权限执行）
set -e

APP_DIR=/opt/simgapi
SERVICE_NAME=simgapi

echo "=== 1. 安装 Node.js 22 ==="
if ! command -v node &>/dev/null; then
  curl -fsSL https://deb.nodesource.com/setup_22.x | bash -
  apt-get install -y nodejs
fi
node -v

echo "=== 2. 创建应用目录 ==="
mkdir -p $APP_DIR
mkdir -p $APP_DIR/uploads

echo "=== 3. 获取项目代码 ==="
# 首次部署：git clone <repo-url> $APP_DIR
# 更新部署：git -C $APP_DIR pull
cd $APP_DIR

echo "=== 4. 安装运行时依赖 ==="
npm ci --omit=dev

echo "=== 5. 配置环境变量 ==="
if [ ! -f $APP_DIR/.env ]; then
  cp $APP_DIR/.env.example $APP_DIR/.env
  echo "请编辑 $APP_DIR/.env 填写配置后重新运行此脚本"
  exit 1
fi

# 确保 BASE_URL 使用实际域名（提醒用户）
echo "请确认 $APP_DIR/.env 中 BASE_URL 已设置为实际域名"

echo "=== 6. 设置目录权限 ==="
chown -R www-data:www-data $APP_DIR
chmod -R 755 $APP_DIR
chmod -R 775 $APP_DIR/uploads

echo "=== 7. 安装 systemd 服务 ==="
cp $APP_DIR/deploy/simgapi.service /etc/systemd/system/$SERVICE_NAME.service
systemctl daemon-reload
systemctl enable $SERVICE_NAME
systemctl restart $SERVICE_NAME
systemctl status $SERVICE_NAME --no-pager

echo "=== 8. 配置 Nginx ==="
apt-get install -y nginx
cp $APP_DIR/deploy/nginx.conf /etc/nginx/sites-available/$SERVICE_NAME
ln -sf /etc/nginx/sites-available/$SERVICE_NAME /etc/nginx/sites-enabled/$SERVICE_NAME
nginx -t && systemctl reload nginx

echo ""
echo "=== 部署完成 ==="
echo "服务状态：systemctl status $SERVICE_NAME"
echo "查看日志：journalctl -u $SERVICE_NAME -f"
echo "如需 HTTPS：certbot --nginx -d your-domain.com"
