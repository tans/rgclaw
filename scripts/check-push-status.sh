#!/bin/bash
# check-push-status.sh - 检查推送系统状态

DB_PATH="${1:-/root/regou-app/data/app.sqlite}"

echo "=== Push System Status Check ==="
echo "Database: $DB_PATH"
echo ""

echo "1. Launch Events (last 24h):"
sqlite3 "$DB_PATH" "SELECT COUNT(*) as total, COUNT(DISTINCT token_address) as unique_tokens FROM launch_events WHERE created_at >= datetime('now', '-24 hours');"
echo ""

echo "2. Active Users:"
sqlite3 "$DB_PATH" "SELECT COUNT(*) FROM users;"
echo ""

echo "3. Active WeChat Bindings:"
sqlite3 "$DB_PATH" "SELECT COUNT(*) FROM wechat_bot_bindings WHERE status='active';"
echo ""

echo "4. Active Entitlements:"
sqlite3 "$DB_PATH" "SELECT COUNT(*) FROM user_entitlements WHERE status='active' AND datetime(expires_at) > datetime('now');"
echo ""

echo "5. Enabled Subscriptions:"
sqlite3 "$DB_PATH" "SELECT source, COUNT(*) as count FROM user_source_subscriptions WHERE enabled=1 GROUP BY source;"
echo ""

echo "6. Notification Jobs (last 24h):"
sqlite3 "$DB_PATH" "SELECT status, COUNT(*) as count FROM notification_jobs WHERE created_at >= datetime('now', '-24 hours') GROUP BY status;"
echo ""

echo "7. Recent Launch Events:"
sqlite3 "$DB_PATH" "SELECT source, token_address, symbol, datetime(event_time, '+8 hours') as event_time_local FROM launch_events ORDER BY event_time DESC LIMIT 5;"
echo ""

echo "8. Push Coverage Check:"
sqlite3 "$DB_PATH" "
SELECT
  COUNT(DISTINCT le.id) as events,
  COUNT(DISTINCT nj.id) as jobs_created,
  SUM(CASE WHEN nj.status='sent' THEN 1 ELSE 0 END) as sent,
  SUM(CASE WHEN nj.status='failed' THEN 1 ELSE 0 END) as failed,
  SUM(CASE WHEN nj.status='pending' THEN 1 ELSE 0 END) as pending
FROM launch_events le
LEFT JOIN notification_jobs nj ON nj.launch_event_id = le.id
WHERE le.created_at >= datetime('now', '-24 hours');
"
