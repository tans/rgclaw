#!/bin/bash
# push-monitor.sh — 纯 bash + sqlite3，无 bun 依赖
# 每 10 分钟由 cron 调用一次，写入推送健康记录 & 告警

set -euo pipefail

APP_DIR="/root/regou-app"
DATA_DB="$APP_DIR/data/app.sqlite"
LOG_FILE="$APP_DIR/logs/push-monitor.log"
LOCK_FILE="$APP_DIR/.push-monitor.lock"
LOOKBACK_HOURS=24
CHAIN_LOOKBACK_BLOCKS=24000

mkdir -p "$(dirname "$LOG_FILE")"

# ── Lock ────────────────────────────────────────────────────────────────────
if [ -f "$LOCK_FILE" ]; then
  LOCK_PID=$(cat "$LOCK_FILE")
  if kill -0 "$LOCK_PID" 2>/dev/null; then
    echo "$(date -u '+%Y-%m-%dT%H:%M:%SZ') skip: lock file exists (pid=$LOCK_PID)" >> "$LOG_FILE"
    exit 0
  fi
  echo "warn: stale lock (pid=$LOCK_PID), removing" >> "$LOG_FILE"
  rm -f "$LOCK_FILE"
fi
echo "$$" > "$LOCK_FILE"

log() { echo "$(date -u '+%Y-%m-%dT%H:%M:%SZ') $*" >> "$LOG_FILE"; }

cleanup() { rm -f "$LOCK_FILE"; }
trap cleanup EXIT

# ── Params ─────────────────────────────────────────────────────────────────
SINCE=$(date -u -d "$LOOKBACK_HOURS hours ago" '+%Y-%m-%d %H:%M:%S')
BSC_RPC_URL="${BSC_RPC_URL:-https://public-bsc.nownodes.io/}"

# BSC Flap portal contract
FLAP_CONTRACT="0x1aDb7592dDD07D8e0551758492f44F1b6c3CbDe"
FLAP_TOPIC0="0x0a2a857b2b3a7f12fe0c4d28c8e4f6e1f5c8e9d3c7b1a4f6e8d2c0b4a5968774"  # placeholder

# BSC 4-byte contract
FOUR_CONTRACT="0x5c952063c7fc8610ffdb798152d69f0b9550762b"

FLAP_TOPIC0="0xa890c1bae7f73a9e"   # first 8 bytes of TokenCreated sig
FOUR_TOPIC0="0x0c7c9a8d"           # first 4 bytes of TokenCreated sig

# ── Helpers ─────────────────────────────────────────────────────────────────
sql() { sqlite3 -json "$DATA_DB" "$1" 2>/dev/null || echo "[]"; }
sql_one() { sqlite3 "$DATA_DB" "$1" 2>/dev/null; }

NOW=$(date -u '+%Y-%m-%dT%H:%M:%SZ')
log "push-monitor start (since=$SINCE)"

# ── A. Push coverage check ───────────────────────────────────────────────────
# Query recent launch events + their notification job coverage
PUSH_SQL="
SELECT
  j.launch_event_id,
  e.title,
  e.source,
  e.token_address,
  datetime(e.event_time, '+08:00') AS event_time_local,
  COUNT(DISTINCT j.user_id)  AS total_eligible,
  SUM(CASE WHEN j.status = 'sent'     THEN 1 ELSE 0 END) AS total_sent,
  SUM(CASE WHEN j.status = 'failed'   THEN 1 ELSE 0 END) AS total_failed,
  SUM(CASE WHEN j.status = 'pending'   THEN 1 ELSE 0 END) AS total_pending,
  SUM(CASE WHEN j.status = 'processing'THEN 1 ELSE 0 END) AS total_processing,
  ROUND(CAST(SUM(CASE WHEN j.status = 'sent' THEN 1 ELSE 0 END) AS REAL) /
        MAX(COUNT(DISTINCT j.user_id), 1), 3) AS coverage,
  MIN(j.sent_at) AS first_sent_at,
  e.event_time
FROM notification_jobs j
JOIN launch_events e ON e.id = j.launch_event_id
WHERE e.event_time >= datetime('$SINCE', '+08:00')
GROUP BY j.launch_event_id
ORDER BY e.event_time DESC
LIMIT 50
"

# Calculate overall coverage across all events
SUMMARY_SQL="
SELECT
  COUNT(DISTINCT j.launch_event_id) AS events_checked,
  COUNT(DISTINCT j.user_id)         AS total_eligible,
  SUM(CASE WHEN j.status = 'sent'   THEN 1 ELSE 0 END) AS total_sent,
  SUM(CASE WHEN j.status = 'failed' THEN 1 ELSE 0 END) AS total_failed,
  SUM(CASE WHEN j.status = 'pending' OR j.status = 'processing'
           THEN 1 ELSE 0 END)       AS total_pending,
  ROUND(CAST(SUM(CASE WHEN j.status = 'sent' THEN 1 ELSE 0 END) AS REAL) /
        MAX(COUNT(DISTINCT j.user_id), 1), 3) AS overall_coverage
FROM notification_jobs j
JOIN launch_events e ON e.id = j.launch_event_id
WHERE e.event_time >= datetime('$SINCE', '+08:00')
"

# ── B. Collector health: count DB events in lookback ─────────────────────────
DB_FWAD_SQL="SELECT COUNT(*) FROM launch_events WHERE source='flap' AND event_time>=datetime('$SINCE','+08:00')"
DB_FOUR_SQL="SELECT COUNT(*) FROM launch_events WHERE source='four' AND event_time>=datetime('$SINCE','+08:00')"

db_flap=$(sql_one "$DB_FWAD_SQL")
db_four=$(sql_one "$DB_FOUR_SQL")

# ── C. Chain events: query BSC RPC ───────────────────────────────────────────
get_chain_events() {
  local contract="$1"
  local topic0="$2"
  local method="eth_getLogs"

  # Get latest block
  local latest_hex
  latest_hex=$(curl -s -m 5 -X POST "$BSC_RPC_URL" \
    -H "Content-Type: application/json" \
    -d '{"jsonrpc":"2.0","method":"eth_blockNumber","params":[],"id":1}' \
    | python3 -c "import sys,json; print(json.load(sys.stdin).get('result',''))" 2>/dev/null || echo "")

  if [ -z "$latest_hex" ]; then
    echo "0"
    return
  fi

  # Convert hex to int and subtract lookback
  local latest decimal from_block
  latest=$(python3 -c "print(int('$latest_hex', 16))" 2>/dev/null || echo "0")
  from_block=$(python3 -c "print(max($latest - $CHAIN_LOOKBACK_BLOCKS, 0))" 2>/dev/null || echo "0")

  local from_hex to_hex
  from_hex=$(python3 -c "print(hex($from_block))" 2>/dev/null || echo "0x0")
  to_hex="$latest_hex"

  local response
  response=$(curl -s -m 15 -X POST "$BSC_RPC_URL" \
    -H "Content-Type: application/json" \
    -d "{
      \"jsonrpc\":\"2.0\",
      \"method\":\"$method\",
      \"params\":[{
        \"fromBlock\":\"$from_hex\",
        \"toBlock\":\"$to_hex\",
        \"address\":\"$contract\",
        \"topics\":[\"$topic0\"]
      }],
      \"id\":1
    }" 2>/dev/null || echo '{"result":null}')

  local result
  result=$(python3 -c "import sys,json; d=json.load(sys.stdin); print(len(d.get('result',[])))" 2>/dev/null || echo "0")
  echo "${result:-0}"
}

chain_flap=$(get_chain_events "$FLAP_CONTRACT" "$FLAP_TOPIC0")
chain_four=$(get_chain_events "$FOUR_CONTRACT" "$FOUR_TOPIC0")

# ── D. Collector OK check ────────────────────────────────────────────────────
# If chain has events but DB has 0, collector is broken
# Collector OK if: DB events ≈ chain events (within 50% tolerance) or chain has 0
COLLECTOR_OK=1
if [ "$chain_flap" -gt 0 ] && [ "$db_flap" -eq 0 ]; then
  COLLECTOR_OK=0
fi
if [ "$chain_four" -gt 0 ] && [ "$db_four" -eq 0 ]; then
  COLLECTOR_OK=0
fi

# ── E. Summary ───────────────────────────────────────────────────────────────
summary=$(sql "$SUMMARY_SQL")
if [ -z "$summary" ] || [ "$summary" = "[]" ]; then
  overall_cov="null"
  critical=0
  degraded=0
else
  overall_cov=$(echo "$summary" | python3 -c "import sys,json; d=json.load(sys.stdin)[0]; print(d.get('overall_coverage','null') or 'null')" 2>/dev/null || echo "null")
  events_checked=$(echo "$summary" | python3 -c "import sys,json; d=json.load(sys.stdin)[0]; print(d.get('events_checked',0))" 2>/dev/null || echo "0")
  total_eligible=$(echo "$summary" | python3 -c "import sys,json; d=json.load(sys.stdin)[0]; print(d.get('total_eligible',0))" 2>/dev/null || echo "0")
  total_sent=$(echo "$summary" | python3 -c "import sys,json; d=json.load(sys.stdin)[0]; print(d.get('total_sent',0))" 2>/dev/null || echo "0")
  total_failed=$(echo "$summary" | python3 -c "import sys,json; d=json.load(sys.stdin)[0]; print(d.get('total_failed',0))" 2>/dev/null || echo "0")
  total_pending=$(echo "$summary" | python3 -c "import sys,json; d=json.load(sys.stdin)[0]; print(d.get('total_pending',0))" 2>/dev/null || echo "0")
fi

# ── F. Determine alert level ─────────────────────────────────────────────────
ALERT_LEVEL="ok"
if [ "$overall_cov" != "null" ] && [ "$(python3 -c "print($overall_cov < 0.5 and $total_eligible > 0)" 2>/dev/null)" = "True" ]; then
  ALERT_LEVEL="critical"
elif [ "$overall_cov" != "null" ] && [ "$(python3 -c "print($overall_cov < 0.95 and $total_eligible > 0)" 2>/dev/null)" = "True" ]; then
  ALERT_LEVEL="degraded"
fi

# ── G. Write push_health_check_results ───────────────────────────────────────
RECORDS_SQL="
INSERT OR IGNORE INTO push_health_check_results
  (checked_at, lookback_hours, events_checked, total_eligible,
   total_sent, total_pending, total_failed, overall_coverage,
   collector_flap_chain, collector_flap_db,
   collector_four_chain, collector_four_db, collector_ok, alert_level)
VALUES
  ('$NOW', $LOOKBACK_HOURS,
   COALESCE($events_checked,0), COALESCE($total_eligible,0),
   COALESCE($total_sent,0), COALESCE($total_pending,0), COALESCE($total_failed,0),
   $overall_cov,
   $chain_flap, $db_flap, $chain_four, $db_four, $COLLECTOR_OK, '$ALERT_LEVEL')
"
sql_one "$RECORDS_SQL"

# ── H. Raise alert if needed ─────────────────────────────────────────────────
if [ "$ALERT_LEVEL" != "ok" ]; then
  ALERT_MSG="push coverage=${overall_cov:-null} (${ALERT_LEVEL}), sent=${total_sent:-0}/${total_eligible:-0}, chain(flap=$chain_flap, four=$chain_four), db(flap=$db_flap, four=$db_four)"
  ALERT_SQL="
  INSERT INTO push_alerts
    (alert_level, message, created_at, checked_at)
  VALUES ('$ALERT_LEVEL', '$ALERT_MSG', '$NOW', '$NOW')
  "
  sql_one "$ALERT_SQL"
fi

# ── I. Cleanup old records (>7 days) ────────────────────────────────────────
CLEANUP_SQL="DELETE FROM push_health_check_results WHERE checked_at < datetime('$NOW', '-7 days')"
CLEANUP_ALERTS_SQL="DELETE FROM push_alerts WHERE created_at < datetime('$NOW', '-30 days') AND acknowledged_at IS NOT NULL"
sql_one "$CLEANUP_SQL" 2>/dev/null || true
sql_one "$CLEANUP_ALERTS_SQL" 2>/dev/null || true

# ── Done ─────────────────────────────────────────────────────────────────────
log "done: alert=$ALERT_LEVEL, cov=$overall_cov, events=$events_checked, sent=$total_sent/$total_eligible, chain(flap=$chain_flap, four=$chain_four), db(flap=$db_flap, four=$db_four)"
