#!/bin/bash
# regou.app 一键部署脚本
# 用法: ./scripts/deploy.sh

set -e

# 配置
SERVER_HOST="regou.app"
SERVER_USER="root"
SSH_KEY="./ssh/id_ed25519_1panel"
REMOTE_DIR="/root/regou-app"
APP_NAME="regou-app"

echo "==================================="
echo "regou.app 部署脚本"
echo "==================================="
echo ""

# 检查 SSH 密钥
echo "[1/6] 检查 SSH 密钥..."
if [ ! -f "$SSH_KEY" ]; then
    echo "错误: SSH 密钥不存在: $SSH_KEY"
    exit 1
fi
chmod 600 "$SSH_KEY"

# 压缩代码
echo "[2/6] 打包代码..."
cd "$(dirname "$0")/.."
tar czf /tmp/regouapp-deploy.tar.gz \
    --exclude='.git' \
    --exclude='node_modules' \
    --exclude='data/*.sqlite*' \
    --exclude='logs' \
    --exclude='.DS_Store' \
    --exclude='._*' \
    . 2>/dev/null

# 上传代码
echo "[3/6] 上传代码到服务器..."
scp -i "$SSH_KEY" -o StrictHostKeyChecking=no \
    /tmp/regouapp-deploy.tar.gz "${SERVER_USER}@${SERVER_HOST}:${REMOTE_DIR}.tar.gz"

# 远程执行部署
echo "[4/6] 解压并安装依赖..."
ssh -i "$SSH_KEY" -o StrictHostKeyChecking=no "${SERVER_USER}@${SERVER_HOST}" << 'REMOTECMD'
# 加载 bun 到 PATH (bun 安装时写入 ~/.bashrc)
[ -f "$HOME/.bashrc" ] && source "$HOME/.bashrc"

cd /root

# 安装 bun (如果不存在)
if [ ! -f "$HOME/.bun/bin/bun" ]; then
    echo "安装 bun..."
    curl -fsSL https://bun.sh/install | bash
fi

# 确保 bun 在 PATH 中
export PATH="$HOME/.bun/bin:$HOME/.local/bin:$HOME/npm/bin:$PATH"

# 安装 pm2 (如果不存在，用 bun 安装)
if ! command -v pm2 &> /dev/null; then
    echo "安装 pm2..."
    bun install -g pm2
fi

if [ ! -d "/root/regou-app" ]; then
    mkdir -p /root/regou-app
fi
rm -rf /root/regou-app_backup_*
cp -r /root/regou-app /root/regou-app_backup_$(date +%Y%m%d_%H%M%S) 2>/dev/null || true
# 清理 macOS metadata 文件
find /root/regou-app -name '._*' -delete 2>/dev/null || true
tar xzf /root/regou-app.tar.gz -C /root/regou-app --overwrite
cd /root/regou-app
bun install 2>&1 | tail -5
REMOTECMD

echo "[5/6] 重启服务..."
ssh -i "$SSH_KEY" -o StrictHostKeyChecking=no "${SERVER_USER}@${SERVER_HOST}" << 'REMOTECMD'
# 加载 bun 到 PATH
[ -f "$HOME/.bashrc" ] && source "$HOME/.bashrc"
cd /root/regou-app
export PATH="$HOME/.bun/bin:$HOME/.local/bin:$HOME/npm/bin:$PATH"
pm2 reload ecosystem.config.json 2>&1 || pm2 start ecosystem.config.json 2>&1
sleep 2
pm2 list
REMOTECMD

echo "[6/6] 验证部署..."
HTTP_CODE=$(curl -s -o /dev/null -w "%{http_code}" https://regou.app/)
if [ "$HTTP_CODE" = "200" ]; then
    echo "✅ 部署成功! HTTP 状态码: $HTTP_CODE"
else
    echo "⚠️ 部署可能异常，HTTP 状态码: $HTTP_CODE"
fi

echo ""
echo "==================================="
echo "部署完成!"
echo "- 站点: https://regou.app"
echo "- 服务器: ${SERVER_USER}@${SERVER_HOST}:${REMOTE_DIR}"
echo "==================================="
