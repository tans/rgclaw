#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/../.." && pwd)"
cd "$ROOT_DIR"

if [ -f .env ]; then
  set -a
  . ./.env
  set +a
fi

PORT="${PORT:-3000}"
BASE_URL="${HEALTHCHECK_BASE_URL:-http://127.0.0.1:${PORT}}"

if ! command -v curl >/dev/null 2>&1; then
  echo "curl is required"
  exit 1
fi

request_status() {
  local url="$1"
  local code

  if ! code="$(curl --connect-timeout 3 --max-time 5 -s -o /dev/null -w '%{http_code}' "$url")"; then
    echo "request failed: $url"
    exit 1
  fi

  printf '%s\n' "$code"
}

for app in rgclaw-web rgclaw-collector rgclaw-worker; do
  if ! pm2 describe "$app" | grep -Eq 'status[[:space:]]*online'; then
    echo "pm2 app not online: $app"
    exit 1
  fi
done

home_code="$(request_status "${BASE_URL}/")"
renew_code="$(request_status "${BASE_URL}/renew")"

if [ "$home_code" != "200" ]; then
  echo "unexpected / status: $home_code"
  exit 1
fi

if [ "$renew_code" != "302" ]; then
  echo "unexpected /renew status: $renew_code"
  exit 1
fi

echo "healthcheck ok: pm2 apps online and web routes reachable"
