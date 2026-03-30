#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/../.." && pwd)"
cd "$ROOT_DIR"

pm2 status
echo
echo "Log hints:"
echo "  pm2 restart rgclaw"
echo "  pm2 logs rgclaw"
echo "  bash scripts/ops/logs.sh"
echo "  ls -lah logs/"
