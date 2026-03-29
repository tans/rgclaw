#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/../.." && pwd)"
cd "$ROOT_DIR"

if ! command -v bun >/dev/null 2>&1; then
  echo "bun is required"
  exit 1
fi

if ! command -v pm2 >/dev/null 2>&1; then
  echo "pm2 is required"
  exit 1
fi

if [ ! -f .env ]; then
  echo ".env is required"
  exit 1
fi

mkdir -p logs
bun install
pm2 start ecosystem.config.cjs
pm2 save

echo "bootstrap complete"
echo "follow up:"
echo "  pm2 status"
echo "  pm2 startup"
echo "  bash scripts/ops/healthcheck.sh"
