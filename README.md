# Regou.app — Meme Token 发射通知服务

**微信推送 · BSC 链上事件 · 付费订阅**

> 监控 pump.fun、4-byte、GMGN 的 Token 上线事件，事件发生后第一时间通过微信推送订阅用户，支持免费试用与付费专业版。

---

## 目录

- [系统架构](#系统架构)
- [目录结构](#目录结构)
- [核心模块](#核心模块)
- [数据库表](#数据库表)
- [机器人指令](#机器人指令)
- [订阅与计费](#订阅与计费)
- [部署指南](#部署指南)
- [环境变量](#环境变量)
- [开发调试](#开发调试)

---

## 系统架构

```
 BSC 链上事件 (pump.fun / 4-byte / GMGN)
          │
          ▼
  ┌─────────────────────────┐
  │  regouapp-collector     │  ← 每分钟轮询 BSC RPC，抓取 NewToken 事件
  │  src/collectors/run.ts  │    结果写入 launch_events 表
  └────────┬────────────────┘
           │ notification_jobs (pending)
           ▼
  ┌─────────────────────────┐
  │  regouapp-worker        │  ← 每 10s 轮询 pending 任务，找用户、找微信绑定、
  │  src/workers/run.ts     │    发推送消息
  └────────┬────────────────┘
           │ pending_wechat_sends
           ▼
  ┌─────────────────────────┐
  │  regouapp-web           │  ← Web 服务器 (Hono, port 30082)
  │  src/server/index.ts   │    · HTTP API (事件/订阅/续费)
           │                · WeChat 回调 (webhook)
           │                · 微信消息派发 (queue poller, 每 10s)
           └────────────────┘
                          │
                          ▼
                    微信用户 ←── /start /sub /status 等指令

  ┌─────────────────────────┐
  │  push-monitor (cron)    │  ← 每 10 分钟触发一次，写入健康记录 & 告警
  │  scripts/push-monitor.sh│
  └─────────────────────────┘
```

### 服务进程 (PM2)

| 进程名 | 入口文件 | 职责 |
|--------|---------|------|
| `regouapp-web` | `src/server/index.ts` | HTTP 服务器、WeChat 回调、消息派发轮询 |
| `regouapp-collector` | `src/collectors/run.ts` | 区块链事件采集 |
| `regouapp-worker` | `src/workers/run.ts` | 推送任务、续费提醒、保活提醒、支付扫描 |
| `push-monitor` | `scripts/push-monitor.sh` (cron) | 推送覆盖率 + 链上采集健康检查 |

---

## 目录结构

```
src/
├── adapters/
│   └── wechat-bot.ts          # WeChat Bot HTTP API 适配器
├── collectors/
│   ├── client.ts               # HTTP collector 客户端 (GMGN 等)
│   ├── flap.ts                 # Flap/Portal 合约事件采集
│   ├── four.ts                 # 4-byte 合约事件采集
│   ├── rpc.ts                 # BSC JSON-RPC 封装
│   └── run.ts                 # Collector 主循环
├── db/
│   ├── sqlite.ts              # SQLite 连接 (bun:sqlite, WAL)
│   ├── migrate.ts             # 迁移执行器
│   ├── schema.sql            # 建表语句
│   ├── migrations/           # SQL 迁移文件
│   │   ├── 0001_initial.sql
│   │   ├── 0002_fix_duplicate_subscriptions.sql
│   │   ├── 0003_dedupe_launch_events.sql
│   │   ├── 0004_pending_wechat_sends.sql
│   │   └── 0005_push_monitor.sql
│   └── repositories/        # 数据访问层
│       ├── entitlements.ts
│       ├── launch-events.ts
│       ├── notification-jobs.ts
│       ├── payment-records.ts
│       ├── push-monitor.ts   # 推送健康记录读写
│       ├── subscriptions.ts
│       ├── users.ts
│       ├── wechat-bindings.ts
│       └── wechat-inbound-events.ts
├── server/
│   ├── index.ts              # HTTP 入口 (PM2 启动文件)
│   ├── app.ts               # Hono 应用工厂
│   ├── middleware/
│   │   └── session.ts       # 会话中间件
│   ├── routes/
│   │   ├── auth.ts          # 登录
│   │   ├── events.ts        # /api/events/*
│   │   ├── internal.ts      # /internal/push-health
│   │   ├── renewal.ts       # /renew
│   │   ├── user-center.ts  # /user-center
│   │   ├── webhook.ts      # WeChat 回调 / BSC 支付 webhook
│   │   └── wechat-direct.ts # 微信直连登录
│   └── views/               # 内联 HTML 模板
├── services/
│   └── wechatbot-service.ts # 微信机器人: 指令解析、消息构建、Bot 生命周期
├── shared/
│   ├── config.ts            # 环境变量配置
│   ├── types.ts            # 核心类型定义
│   ├── polling-loop.ts     # 通用轮询循环工具
│   └── wechat-bind-code.ts
└── workers/
    ├── run.ts              # Worker 主循环 (被 PM2 调用)
    ├── push-worker.ts      # 推送任务: 事件推送 / 续费提醒 / 保活提醒
    ├── payment-scanner.ts  # BscScan API 轮询支付
    ├── payment-watcher.ts  # BNB 转账 → 积分 → 延长订阅
    ├── payment-webhook.ts  # BSC 支付 webhook (Webhook3.io)
    └── push-monitor.ts     # 推送健康检查 (一次一退出，cron 调用)

scripts/
├── deploy.sh               # 一键部署脚本 (本地执行)
└── push-monitor.sh         # push-monitor cron wrapper (部署到服务器后执行)
```

---

## 核心模块

### 1. 事件采集 (`collectors/`)

- **Flap**: 监听 Flap Portal 合约 `LaunchedToDEX` 事件 (pump.fun)
- **Four**: 监听 4-byte 合约 `TokenCreated` 事件
- **GMGN**: 调用 GMGN API 获取实时期权

每个事件写入 `launch_events`，通过 `backfill-progress` 跟踪采集进度。

### 2. 推送任务 (`workers/push-worker.ts`)

`processLaunchPushes()` 在每个新事件写入后，为所有**有效订阅 + 已绑定微信的用户**创建 `notification_jobs`（状态 pending）。

`dispatchPendingNotificationMessages()` 每 10s 扫描 pending → 读取事件内容 → 找到微信绑定 → 发消息 → 标记 sent。

另有：
- `processRenewalReminders()`: 到期前 1 天提醒续费
- `dispatchPendingSystemMessageJobs()`: 保活提醒（超过 18h 无互动发提醒消息）

### 3. 微信机器人 (`services/wechatbot-service.ts`)

核心逻辑：指令解析 → 权限判断 → 状态查询 → 回复消息。

支持**两套绑定方式**：
- **直连模式**: 微信用户扫码绑定，用户名=wxid，无需服务器中转
- **Bot 模式**: 通过 WeChat Bot HTTP API 推送（`sendWechatMessage`）

服务器通过 `bootstrapDirectWeChatBots()` 在启动时恢复所有活跃 Bot 的 WebSocket 连接。

### 4. 推送监控 (`workers/push-monitor.ts`)

一次一退出，被 `scripts/push-monitor.sh`（cron, 每 10 分钟）调用：

**检查 A — 推送覆盖率**  
查询 `notification_jobs`，对每个事件计算 `sent/eligible` 覆盖率：
- coverage < 50% → **critical** 告警
- coverage < 95% → **degraded** 告警

**检查 B — 链上采集健康**  
直接查 BSC RPC，轮询 Flap/4-byte 合约事件，与 DB `launch_events` 对比，检测漏采集。

结果写入 `push_health_check_results` 和 `push_alerts` 表，可通过 `/internal/push-health` API 访问。

### 5. 支付计费 (`workers/payment-*.ts`)

- **payment-webhook**: BSC 支付 webhook（Webhook3.io），验证签名后调用 watcher
- **payment-scanner**: BscScan API 兜底轮询，通过 `_meta` 表记录扫描进度
- **payment-watcher**: 验证收款地址和金额，1 BNB = 30 天 pro，写入 `payment_records` 和 `entitlements`

---

## 数据库表

| 表名 | 用途 |
|------|------|
| `users` | 钱包地址登录、会话 |
| `wechat_bindings` | 钱包 ↔ wxid 绑定关系 |
| `wechat_bot_bindings` | 独立 Bot 模式的绑定 |
| `subscriptions` | source (flap/four) × enabled 订阅开关 |
| `entitlements` | plan_type / status / expires_at |
| `launch_events` | 链上采集的 Token 事件 |
| `notification_jobs` | 推送任务 (pending → processing → sent/failed) |
| `pending_wechat_sends` | 实际发微信的队列 (由 web server 的 queue poller 消费) |
| `wechat_inbound_events` | 收到的微信消息记录 |
| `payment_records` | BNB 充值历史 |
| `backfill_progress` | 各 collector 的采集进度 |
| `push_health_check_results` | 推送健康检查快照 |
| `push_alerts` | 推送告警记录 |

---

## 机器人指令

用户在微信里给机器人发消息，实时响应：

| 指令 | 说明 |
|------|------|
| `/start` | 开始绑定引导 |
| `/help` | 显示帮助，含套餐引导 |
| `/status` | 查看当前订阅状态和推送状态 |
| `/sub four` | 开启 Four 推送 |
| `/sub flap` | 开启 Flap 推送 |
| `/unsub four` | 关闭 Four 推送 |
| `/unsub flap` | 关闭 Flap 推送 |
| `/history` | 查看最近事件列表 |
| `/plans` | 展示月付/年付价格 |
| `/upgrade` | 获取续费页面链接 |

> **幂等性**: `/sub` 强制开启，`/unsub` 强制关闭，避免 toggle 反转问题。

---

## 订阅与计费

| 套餐 | 价格 | 时长 | 来源 |
|------|------|------|------|
| Free (试用) | — | 3 天 | 首次登录自动开通 |
| Pro 月付 | 0.005 BNB | 30 天 | 充值 |
| Pro 年付 | 0.05 BNB | 365 天 | 充值 |

**续费流程**: 用户访问 `/renew` → 页面显示钱包地址 → 转 BNB 到收款地址 → webhook 验证后自动到账。

收款地址: `0xaCEa067c6751083e4e652543A436638c1e777777` (config.bnbCollectionWallet)

---

## 部署指南

### 一键部署 (本地执行)

```bash
bash scripts/deploy.sh
```

部署流程：
1. 压缩源码 → SCP 到服务器 `/root/regou-app.tar.gz`
2. SSH 远程执行：
   - `bun install`
   - 解压覆盖
   - `pm2 delete all` → `pm2 start ecosystem.config.json`
   - `pm2 save`
3. 验证 `curl -sf http://127.0.0.1:30082/`

### 安装 push-monitor cron

部署完成后，在服务器上执行一次：

```bash
# 添加 cron（每 10 分钟执行）
(crontab -l 2>/dev/null; echo "*/10 * * * * /root/regou-app/scripts/push-monitor.sh >> /root/regou-app/logs/push-monitor.log 2>&1") | crontab -

# 手动触发一次测试
bash /root/regou-app/scripts/push-monitor.sh
```

日志在 `/root/regou-app/logs/push-monitor.log`。

---

## 环境变量

| 变量 | 默认值 | 说明 |
|------|--------|------|
| `DATABASE_PATH` | `./data/app.sqlite` | SQLite 数据库路径 |
| `BSC_RPC_URL` | `https://public-bsc.nownodes.io/` | BSC RPC |
| `PORT` | `30082` | Web 服务器端口 |
| `COLLECTOR_LOOKBACK_BLOCKS` | `200` | Collector 初始回溯区块数 |
| `COLLECTOR_BATCH_BLOCKS` | `50` | Collector 每批轮询区块数 |
| `WECHAT_BOT_API_BASE_URL` | `https://example.invalid/wechat` | WeChat Bot API 地址 |
| `WECHAT_BOT_API_TOKEN` | `replace-me` | Bot API 认证 Token |
| `WECHAT_BIND_SECRET` | `dev-wechat-bind-secret` | 微信绑定签名密钥 |
| `WECHAT_CALLBACK_ALLOWLIST` | `127.0.0.1,::1` | Webhook IP 白名单 |
| `WECHAT_KEEPALIVE_ENABLED` | `false` | 是否启用保活提醒 |
| `INTERNAL_API_KEY` | _(无)_ | 内部监控 API 密钥（生产建议设置） |

---

## 开发调试

```bash
# 安装 bun
curl -fsSL https://bun.sh/install | bash

# 启动 web 服务器（热重载）
bun run src/server/index.ts

# 启动 collector
bun run src/collectors/run.ts

# 启动 worker
bun run src/workers/run.ts

# 推送健康检查（一次）
bun run src/workers/push-monitor.ts

# 跑测试
bun test

# 发送测试微信消息
bun run scripts/test-send-message.ts
```

### 内部监控 API

```bash
# 推送健康详情
curl -H "INTERNAL_API_KEY: xxx" http://localhost:30082/internal/push-health

# 推送状态快速检查
curl -H "INTERNAL_API_KEY: xxx" http://localhost:30082/internal/push-health/latest
```

---

## 技术栈

- **运行时**: Bun
- **框架**: Hono
- **数据库**: SQLite (bun:sqlite, WAL 模式)
- **部署**: PM2 + bash cron
- **机器人**: WeChat Bot HTTP API / 直连 WebSocket
- **区块链**: BSC (Ethereum EVM), JSON-RPC
