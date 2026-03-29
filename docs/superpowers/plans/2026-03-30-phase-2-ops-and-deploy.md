# Phase 2 Ops And Deploy Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 为当前一期已完成的 `rgclaw` 系统补齐 Linux + Nginx + pm2 的标准运维与部署骨架，交付 `pm2 ecosystem`、环境变量模板、运维脚本与部署文档。

**Architecture:** 保持现有应用结构不变，继续以 `web`、`collector`、`worker` 三个进程拆分运行。通过 `pm2` 管理进程生命周期，使用仓库内 `scripts/ops/` 承接首发部署、重启、状态与健康检查，并通过部署文档把 Nginx 对接与日常运维流程固定下来。

**Tech Stack:** Bun, TypeScript, Hono, SQLite, pm2, Bash, Nginx

---

## 文件结构

- Create: `.env.example`
  环境变量模板，列出现有运行所需变量和未来真实接入的预留变量。
- Create: `ecosystem.config.cjs`
  `pm2` 进程编排配置，统一声明 `web`、`collector`、`worker`。
- Create: `scripts/ops/bootstrap.sh`
  首发部署与首次启动脚本。
- Create: `scripts/ops/restart.sh`
  发布后统一重启脚本。
- Create: `scripts/ops/status.sh`
  运维状态查看脚本。
- Create: `scripts/ops/healthcheck.sh`
  轻量健康检查脚本。
- Create: `docs/superpowers/deploy/2026-03-30-phase-2-linux-pm2-deploy.md`
  Linux + Nginx + pm2 的部署与运维说明。
- Test/Verify: 复用现有 `bun test`
  确保运维化改动不破坏业务实现。

### Task 1: 补齐环境变量模板与 pm2 配置

**Files:**
- Create: `.env.example`
- Create: `ecosystem.config.cjs`

- [ ] **Step 1: 写配置文件存在性失败测试**

用命令验证目标文件当前不存在：

```bash
test -f .env.example
test -f ecosystem.config.cjs
```

- [ ] **Step 2: 运行检查确认失败**

Run:

```bash
test -f .env.example && test -f ecosystem.config.cjs
```

Expected: FAIL，至少一个文件不存在

- [ ] **Step 3: 写最小 `.env.example`**

`.env.example`

```dotenv
# Web
PORT=3000

# Database
DATABASE_PATH=./data/app.sqlite

# BSC collector
BSC_RPC_URL=https://public-bsc.nownodes.io/
COLLECTOR_LOOKBACK_BLOCKS=200
COLLECTOR_BATCH_BLOCKS=50

# Future real integrations
WECHAT_BOT_ENDPOINT=https://example.invalid/wechat
WECHAT_BOT_TOKEN=replace-me
PAYMENT_WATCHER_ENABLED=false
PAYMENT_CONFIRMATIONS=3
```

- [ ] **Step 4: 写最小 `pm2 ecosystem` 配置**

`ecosystem.config.cjs`

```js
const path = require("node:path");

const root = __dirname;
const logsDir = path.join(root, "logs");
const envFile = path.join(root, ".env");
const bun = process.env.BUN_BIN || "bun";

function app(name, script) {
  return {
    name,
    cwd: root,
    script,
    interpreter: bun,
    interpreterArgs: "run",
    env_file: envFile,
    autorestart: true,
    watch: false,
    out_file: path.join(logsDir, `${name}.out.log`),
    error_file: path.join(logsDir, `${name}.error.log`),
    merge_logs: true,
    time: true,
  };
}

module.exports = {
  apps: [
    app("rgclaw-web", "src/server/index.ts"),
    app("rgclaw-collector", "src/collectors/run.ts"),
    app("rgclaw-worker", "src/workers/run.ts"),
  ],
};
```

- [ ] **Step 5: 运行检查确认通过**

Run:

```bash
test -f .env.example && test -f ecosystem.config.cjs
```

Expected: PASS，无输出

- [ ] **Step 6: 提交**

```bash
git add .env.example ecosystem.config.cjs
git commit -m "chore: add pm2 environment and process config"
```

### Task 2: 补齐运维脚本

**Files:**
- Create: `scripts/ops/bootstrap.sh`
- Create: `scripts/ops/restart.sh`
- Create: `scripts/ops/status.sh`
- Create: `scripts/ops/healthcheck.sh`

- [ ] **Step 1: 写脚本存在性失败检查**

Run:

```bash
test -f scripts/ops/bootstrap.sh && test -f scripts/ops/restart.sh && test -f scripts/ops/status.sh && test -f scripts/ops/healthcheck.sh
```

Expected: FAIL，脚本目录尚不存在

- [ ] **Step 2: 写 `bootstrap.sh`**

`scripts/ops/bootstrap.sh`

```bash
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

echo "bootstrap complete"
echo "use: pm2 status"
echo "use: bash scripts/ops/healthcheck.sh"
```

- [ ] **Step 3: 写 `restart.sh`**

`scripts/ops/restart.sh`

```bash
#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/../.." && pwd)"
cd "$ROOT_DIR"

pm2 restart rgclaw-web rgclaw-collector rgclaw-worker
```

- [ ] **Step 4: 写 `status.sh`**

`scripts/ops/status.sh`

```bash
#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/../.." && pwd)"
cd "$ROOT_DIR"

pm2 status
echo
echo "Logs:"
echo "  pm2 logs rgclaw-web"
echo "  pm2 logs rgclaw-collector"
echo "  pm2 logs rgclaw-worker"
echo "  ls -lah logs/"
```

- [ ] **Step 5: 写 `healthcheck.sh`**

`scripts/ops/healthcheck.sh`

```bash
#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/../.." && pwd)"
cd "$ROOT_DIR"

PORT="${PORT:-3000}"
BASE_URL="${HEALTHCHECK_BASE_URL:-http://127.0.0.1:${PORT}}"

for app in rgclaw-web rgclaw-collector rgclaw-worker; do
  if ! pm2 describe "$app" >/dev/null 2>&1; then
    echo "missing pm2 app: $app"
    exit 1
  fi
done

home_code="$(curl -s -o /dev/null -w '%{http_code}' "${BASE_URL}/")"
renew_code="$(curl -s -o /dev/null -w '%{http_code}' "${BASE_URL}/renew")"

if [ "$home_code" != "200" ]; then
  echo "unexpected / status: $home_code"
  exit 1
fi

if [ "$renew_code" != "302" ]; then
  echo "unexpected /renew status: $renew_code"
  exit 1
fi

echo "healthcheck ok"
```

- [ ] **Step 6: 加执行权限并确认脚本存在**

Run:

```bash
chmod +x scripts/ops/bootstrap.sh scripts/ops/restart.sh scripts/ops/status.sh scripts/ops/healthcheck.sh
test -x scripts/ops/bootstrap.sh && test -x scripts/ops/restart.sh && test -x scripts/ops/status.sh && test -x scripts/ops/healthcheck.sh
```

Expected: PASS，无输出

- [ ] **Step 7: 提交**

```bash
git add scripts/ops/bootstrap.sh scripts/ops/restart.sh scripts/ops/status.sh scripts/ops/healthcheck.sh
git commit -m "chore: add pm2 operation scripts"
```

### Task 3: 补齐 Linux + Nginx + pm2 部署文档

**Files:**
- Create: `docs/superpowers/deploy/2026-03-30-phase-2-linux-pm2-deploy.md`

- [ ] **Step 1: 写部署文档存在性失败检查**

Run:

```bash
test -f docs/superpowers/deploy/2026-03-30-phase-2-linux-pm2-deploy.md
```

Expected: FAIL，文档尚不存在

- [ ] **Step 2: 写最小部署文档**

`docs/superpowers/deploy/2026-03-30-phase-2-linux-pm2-deploy.md`

```md
# 2026-03-30 Linux + Nginx + pm2 部署说明

## 前置要求

- Linux 服务器已安装 Bun
- Linux 服务器已安装 pm2
- Nginx 已安装并可用
- 代码已部署到目标目录

## 首次部署

1. 复制环境变量模板

```bash
cp .env.example .env
```

2. 根据服务器实际情况编辑 `.env`

3. 启动应用

```bash
bash scripts/ops/bootstrap.sh
```

4. 查看状态

```bash
bash scripts/ops/status.sh
```

5. 执行健康检查

```bash
bash scripts/ops/healthcheck.sh
```

## 日常更新

```bash
git pull
bun install
bash scripts/ops/restart.sh
bash scripts/ops/healthcheck.sh
```

## 回滚

```bash
git checkout <commit>
bun install
bash scripts/ops/restart.sh
bash scripts/ops/healthcheck.sh
```

## Nginx 参考片段

```nginx
location / {
    proxy_pass http://127.0.0.1:3000;
    proxy_set_header Host $host;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;
    proxy_read_timeout 60s;
}
```

## 常用命令

```bash
pm2 status
pm2 logs rgclaw-web
pm2 logs rgclaw-collector
pm2 logs rgclaw-worker
pm2 monit
```
```

- [ ] **Step 3: 运行检查确认通过**

Run:

```bash
test -f docs/superpowers/deploy/2026-03-30-phase-2-linux-pm2-deploy.md
```

Expected: PASS，无输出

- [ ] **Step 4: 提交**

```bash
git add docs/superpowers/deploy/2026-03-30-phase-2-linux-pm2-deploy.md
git commit -m "docs: add linux pm2 deployment guide"
```

### Task 4: 验证运维骨架与现有业务不回归

**Files:**
- Verify: `.env.example`
- Verify: `ecosystem.config.cjs`
- Verify: `scripts/ops/bootstrap.sh`
- Verify: `scripts/ops/restart.sh`
- Verify: `scripts/ops/status.sh`
- Verify: `scripts/ops/healthcheck.sh`
- Verify: `docs/superpowers/deploy/2026-03-30-phase-2-linux-pm2-deploy.md`

- [ ] **Step 1: 运行现有业务测试**

Run:

```bash
bun test
```

Expected: PASS，输出包含 `0 fail`

- [ ] **Step 2: 校验 `pm2 ecosystem` 语法**

Run:

```bash
node -e "const cfg = require('./ecosystem.config.cjs'); if (!cfg.apps || cfg.apps.length !== 3) throw new Error('invalid ecosystem'); console.log(cfg.apps.map(app => app.name).join(','));"
```

Expected: PASS，输出 `rgclaw-web,rgclaw-collector,rgclaw-worker`

- [ ] **Step 3: 校验运维脚本具备执行权限**

Run:

```bash
test -x scripts/ops/bootstrap.sh && test -x scripts/ops/restart.sh && test -x scripts/ops/status.sh && test -x scripts/ops/healthcheck.sh
```

Expected: PASS，无输出

- [ ] **Step 4: 提交**

```bash
git add .env.example ecosystem.config.cjs scripts/ops/bootstrap.sh scripts/ops/restart.sh scripts/ops/status.sh scripts/ops/healthcheck.sh docs/superpowers/deploy/2026-03-30-phase-2-linux-pm2-deploy.md
git commit -m "chore: add phase 2 ops and deploy assets"
```

## 自检结果

### 1. Spec 覆盖核对

- `pm2` 进程编排：Task 1
- 环境变量模板：Task 1
- 运维脚本：Task 2
- Linux + Nginx + pm2 部署文档：Task 3
- Nginx 参考片段：Task 3
- 验证与回归：Task 4

未发现 spec 中未覆盖项。

### 2. Placeholder 扫描

- 未使用 `TBD`、`TODO`、`implement later`
- 每个任务都给出具体文件、命令、期望结果

### 3. 类型与命名一致性

- `pm2` app 名称统一为 `rgclaw-web`、`rgclaw-collector`、`rgclaw-worker`
- 环境变量命名与现有代码中的 `config` 保持一致
- 文档与脚本都以 `scripts/ops/` 和 `ecosystem.config.cjs` 为统一入口
