#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/../.." && pwd)"
cd "$ROOT_DIR"

pm2 status
echo
echo "Log hints:"
echo "  pm2 logs rgclaw-web"
echo "  pm2 logs rgclaw-collector"
echo "  pm2 logs rgclaw-worker"
echo "  ls -lah logs/"
