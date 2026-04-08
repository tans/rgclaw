#!/bin/bash
# deploy-migration.sh - 在远程服务器上部署迁移和检查推送状态

set -e

REMOTE_HOST="${1:-root@your-server}"
APP_DIR="/root/regou-app"

echo "=== Deploying Migration & Checking Push Status ==="
echo "Remote: $REMOTE_HOST"
echo ""

# 1. 上传迁移文件
echo "1. Uploading migration file..."
scp src/db/migrations/0008_add_token_address_unique_constraint.sql \
    "$REMOTE_HOST:$APP_DIR/src/db/migrations/"

# 2. 上传检查脚本
echo "2. Uploading check script..."
scp scripts/check-push-status.sh "$REMOTE_HOST:$APP_DIR/scripts/"

# 3. 在远程执行迁移
echo "3. Running migration..."
ssh "$REMOTE_HOST" "cd $APP_DIR && /root/.bun/bin/bun run src/db/migrate.ts"

# 4. 检查推送状态
echo "4. Checking push status..."
ssh "$REMOTE_HOST" "cd $APP_DIR && bash scripts/check-push-status.sh"

# 5. 检查 collector 日志
echo "5. Checking collector logs (last 20 lines)..."
ssh "$REMOTE_HOST" "tail -20 $APP_DIR/logs/regouapp-collector.out.log"

# 6. 检查 worker 日志
echo "6. Checking worker logs (last 20 lines)..."
ssh "$REMOTE_HOST" "tail -20 $APP_DIR/logs/regouapp-worker.out.log"

echo ""
echo "=== Deployment Complete ==="
