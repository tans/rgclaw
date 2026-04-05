#!/bin/bash
# rgclaw 一键部署脚本
# 用法: ./scripts/deploy.sh

set -e

# 配置
SERVER_HOST="139.224.105.241"
SERVER_USER="root"
SSH_KEY="./ssh/139.224.105.241_20260404233402_id_rsa"
REMOTE_DIR="/root/rgclaw"
APP_NAME="rgclaw"

echo "==================================="
echo "RgClaw 一键部署脚本"
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
tar czf /tmp/rgclaw-deploy.tar.gz \
    --exclude='.git' \
    --exclude='node_modules' \
    --exclude='data/*.sqlite*' \
    --exclude='logs' \
    --exclude='.DS_Store' \
    . 2>/dev/null

# 上传代码
echo "[3/6] 上传代码到服务器..."
scp -i "$SSH_KEY" -o StrictHostKeyChecking=no \
    /tmp/rgclaw-deploy.tar.gz "${SERVER_USER}@${SERVER_HOST}:${REMOTE_DIR}.tar.gz"

# 远程执行部署
echo "[4/6] 解压并安装依赖..."
ssh -i "$SSH_KEY" -o StrictHostKeyChecking=no "${SERVER_USER}@${SERVER_HOST}" << 'REMOTECMD'
cd /root
if [ ! -d "/root/rgclaw" ]; then
    mkdir -p /root/rgclaw
fi
rm -rf /root/rgclaw_backup_*
cp -r /root/rgclaw /root/rgclaw_backup_$(date +%Y%m%d_%H%M%S) 2>/dev/null || true
tar xzf /root/rgclaw.tar.gz -C /root/rgclaw --overwrite
cd /root/rgclaw
export PATH="$HOME/.bun/bin:$PATH"
bun install 2>&1 | tail -5
REMOTECMD

echo "[5/6] 重启服务..."
ssh -i "$SSH_KEY" -o StrictHostKeyChecking=no "${SERVER_USER}@${SERVER_HOST}" << 'REMOTECMD'
cd /root/rgclaw
export PATH="$HOME/.bun/bin:$PATH"
pm2 reload ecosystem.config.json 2>&1 || pm2 start ecosystem.config.json 2>&1
sleep 2
pm2 list
REMOTECMD

echo "[6/6] 验证部署..."
HTTP_CODE=$(curl -s -o /dev/null -w "%{http_code}" https://rgclaw.ali.minapp.xin/)
if [ "$HTTP_CODE" = "200" ]; then
    echo "✅ 部署成功! HTTP 状态码: $HTTP_CODE"
else
    echo "⚠️ 部署可能异常，HTTP 状态码: $HTTP_CODE"
fi

echo ""
echo "==================================="
echo "部署完成!"
echo "- 站点: https://rgclaw.ali.minapp.xin"
echo "- 服务器: ${SERVER_USER}@${SERVER_HOST}:${REMOTE_DIR}"
echo "==================================="
