#!/bin/bash
# Push Monitor cron wrapper
# 一次一退出，避免进程卡死或内存泄漏
# 用法: 安装到 crontab: */10 * * * * /root/regou-app/scripts/push-monitor.sh >> /root/regou-app/logs/push-monitor.log 2>&1

set -e

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
APP_DIR="$(dirname "$SCRIPT_DIR")"
LOG_FILE="${APP_DIR}/logs/push-monitor.log"
LOCK_FILE="${APP_DIR}/.push-monitor.lock"

mkdir -p "$(dirname "$LOG_FILE")"

# 防止并发：已有锁文件则跳过
if [ -f "$LOCK_FILE" ]; then
  echo "[$(date -u '+%Y-%m-%dT%H:%M:%SZ')] skip: lock file exists" >> "$LOG_FILE"
  exit 0
fi

trap "rm -f '$LOCK_FILE'" EXIT
echo "$$" > "$LOCK_FILE"

cd "$APP_DIR"

# 加载 bun 环境
[ -f "$HOME/.bashrc" ] && source "$HOME/.bashrc"
export PATH="$HOME/.bun/bin:$HOME/.local/bin:$HOME/npm/bin:$PATH"

TIMESTAMP=$(date -u '+%Y-%m-%dT%H:%M:%SZ')
echo "[$TIMESTAMP] push-monitor start" >> "$LOG_FILE"

# 1. 先跑 pending migrations（确保新表已创建）
bun run src/db/migrate-cli.ts >> "$LOG_FILE" 2>&1

# 2. 跑推送健康检查（最多 5 分钟，防止 BSC RPC 卡死）
timeout 300 bun run src/workers/push-monitor.ts >> "$LOG_FILE" 2>&1
EXIT_CODE=$?

TIMESTAMP=$(date -u '+%Y-%m-%dT%H:%M:%SZ')
if [ $EXIT_CODE -eq 0 ]; then
  echo "[$TIMESTAMP] push-monitor done" >> "$LOG_FILE"
elif [ $EXIT_CODE -eq 124 ]; then
  echo "[$TIMESTAMP] push-monitor timeout (BSC RPC slow)" >> "$LOG_FILE"
else
  echo "[$TIMESTAMP] push-monitor failed (exit=$EXIT_CODE)" >> "$LOG_FILE"
fi

exit 0
