# Regou.app — Meme Token 发射通知服务

> 监控 BSC 链上 pump.fun / 4-byte / GMGN 的 Token 上线事件，事件发生后第一时间通过微信推送给订阅用户。免费试用 3 天，专业版月付/年付解锁全量通知。

---

## 目录

- [系统架构](#系统架构)
- [项目结构](#项目结构)
- [核心模块](#核心模块)
- [数据库](#数据库)
- [微信机器人指令](#微信机器人指令)
- [订阅与计费](#订阅与计费)
- [监控与告警](#监控与告警)
- [部署](#部署)
- [环境变量](#环境变量)
- [开发调试](#开发调试)
- [常见问题](#常见问题)

---

## 系统架构

```
 BSC 链 (pump.fun · 4-byte · GMGN)
        │
        ▼
┌──────────────────────────────┐
│  regouapp-collector (PM2)    │  每分钟轮询 BSC RPC
│  src/collectors/run.ts       │  抓取 TokenCreated 事件
└────────────┬─────────────────┘
             │ launch_events
             ▼
┌──────────────────────────────┐
│  regouapp-worker (PM2)       │  每 10s 轮询 pending jobs
│  src/workers/run.ts          │  创建 notification_jobs
└────────────┬─────────────────┘
             │ notification_jobs (pending/queued)
             ▼
┌──────────────────────────────┐
│  regouapp-web (PM2)          │  Web 服务器
│  src/server/index.ts        │  · HTTP API (事件/订阅/续费/微信回调)
             │                · Queue Poller 每 10s 发微信
             └────────────────┘
                          │
                          ▼
                   微信用户 ←── /start /sub four /plans 等
```

---

## 项目结构

```
regou-app/
├── src/
│   ├── adapters/                  # 外部 API 适配层
│   │   └── wechat-bot.ts          # ilinkai 微信 Bot API 封装
│   ├── collectors/                 # BSC 链上事件采集器
│   │   ├── backfill.ts            # 历史事件回填
│   │   ├── flap.ts                # pump.fun Flap Portal 采集
│   │   ├── four.ts                # 4-byte 合约采集
│   │   ├── rpc.ts                 # BSC JSON-RPC 客户端
│   │   └── run.ts                 # 采集轮询入口
│   ├── db/
│   │   ├── migrate.ts             # SQLite 自动迁移
│   │   ├── sqlite.ts              # DB 连接（bun:sqlite, WAL 模式）
│   │   └── repositories/          # 数据仓储层
│   │       ├── entitlements.ts   # 用户套餐权限
│   │       ├── launch-events.ts   # 链上事件
│   │       ├── notification-jobs.ts # 推送任务队列
│   │       ├── push-monitor.ts    # 推送健康记录
│   │       ├── subscriptions.ts   # 订阅管理
│   │       └── wechat-bindings.ts # 微信绑定
│   ├── server/
│   │   ├── index.ts               # Web 服务器入口 (Hono)
│   │   ├── app.ts                 # 路由注册
│   │   ├── middleware/            # 中间件（会话/认证）
│   │   └── routes/                # API 路由
│   │       ├── auth.ts            # 钱包签名登录
│   │       ├── events.ts          # 事件查询 API
│   │       ├── internal.ts        # 内部监控 API
│   │       ├── renewal.ts         # 续费页面
│   │       ├── user-center.ts     # 用户中心
│   │       ├── webhook.ts         # BSC 转账 Webhook
│   │       └── wechat-direct.ts   # 微信直接消息
│   ├── services/
│   │   └── wechatbot-service.ts   # 机器人指令解析与处理
│   ├── shared/
│   │   ├── config.ts              # 环境变量配置
│   │   └── types.ts               # 全局类型定义
│   └── workers/
│       ├── payment-scanner.ts     # 扫描 BSC 链上付款
│       ├── payment-watcher.ts     # 处理入账，给用户加时长
│       ├── push-monitor.ts        # 推送健康检查（纯函数，供 cron 调用）
│       ├── push-worker.ts         # 推送任务生成与派发
│       └── run.ts                 # Worker 轮询编排
├── scripts/
│   ├── deploy.sh                  # 一键部署脚本
│   └── push-monitor.sh            # 推送监控 cron 脚本（bash + sqlite3）
├── ecosystem.config.json          # PM2 进程管理配置
├── package.json
└── README.md
```

---

## 核心模块

### Collectors — 链上事件采集

| 文件 | 数据源 | 事件类型 |
|------|--------|----------|
| `flap.ts` | Flap Portal 合约 (`0x1aDb7...`) | `TokenCreated` (pump.fun) |
| `four.ts` | 4-byte 合约 (`0x5c952...`) | `TokenCreated` |
| `backfill.ts` | Flap + GMGN 历史事件 | 回填历史记录 |
| `rpc.ts` | 任意 BSC RPC | 底层 JSON-RPC 封装，含重试 |

> **注意**：GMGN 采集在 `backfill.ts` 中，实时采集依赖 Flap Portal 合约事件 + GMGN API 回调查看 `src/collectors/` 目录了解详情。

### Workers — 后台任务

| Worker | 触发频率 | 职责 |
|--------|----------|------|
| `regouapp-collector` | 每 60s | 轮询 BSC 新区块，抓 TokenCreated 事件 |
| `regouapp-worker` | 每 10s | 为新事件创建 notification_jobs |
| Queue Poller (`web`) | 每 10s | 消费 pending_wechat_sends，实际发微信 |
| `payment-scanner` | 每 30s | 扫描 BSC 转账到收款地址 |
| `push-monitor.sh` | 每 10min (cron) | 检查推送覆盖率 + 链上事件采集健康 |

### Web Server — HTTP API

| 端点 | 方法 | 说明 |
|------|------|------|
| `/` | GET | 首页：最新发射事件列表 |
| `/login` | POST | 钱包签名登录 |
| `/user-center` | GET | 用户中心 |
| `/renew` | GET/POST | 续费页面 |
| `/api/events/latest` | GET | 最近事件 JSON |
| `/api/events/latest/:source` | GET | 按来源过滤 |
| `/webhook/bnb-transfer` | POST | BSC 转账通知（外部回调） |
| `/wechat/direct` | GET/POST | 微信直接消息入口 |
| `/internal/push-health` | GET | 推送健康报告（需 INTERNAL_API_KEY） |
| `/internal/push-health/latest` | GET | 推送状态简报（ok/degraded/critical） |

---

## 数据库

### 表结构总览

```
launch_events              链上采集的发射事件
├── id
├── source (flap/four)
├── symbol / token_address / launch_tx
├── event_time
└── block_number

entitlements               用户套餐权限
├── user_id / plan_type (free/pro_monthly/pro_yearly)
├── status (active/expired/revoked)
└── expires_at

subscriptions              推送订阅开关（per source）
├── user_id / source (flap/four)
└── enabled

wechat_bot_bindings        用户微信绑定
├── user_id / user_wx_id
├── bot_token / bot_id / account_id
└── status (active/inactive/expired)

notification_jobs          待推送任务（per user × per event）
├── user_id / launch_event_id
└── status (pending/queued/sent/failed)

pending_wechat_sends       微信发送队列
├── user_wx_id / binding_id / content
└── status (pending/processing/sent/failed)

push_health_check_results  推送健康记录
├── checked_at / lookback_hours
├── events_checked / overall_coverage
└── collector_ok

push_alerts                推送告警
├── alert_level (degraded/critical)
├── message / created_at
└── acknowledged_at
```

> 详细 DDL 见 `src/db/migrations/` 目录下的 SQL 文件。

---

## 微信机器人指令

用户关注微信公众号后，发送以下指令：

| 指令 | 说明 |
|------|------|
| `/start` 或 `/help` | 显示帮助信息 |
| `/status` | 查看当前套餐 + 订阅状态 |
| `/sub four` | 开启 Four 发射通知 |
| `/unsub four` | 关闭 Four 通知 |
| `/sub flap` | 开启 Flap 发射通知 |
| `/unsub flap` | 关闭 Flap 通知 |
| `/plans` | 查看月付/年付套餐详情 |
| `/upgrade` 或 `/renew` | 跳转续费页面 |
| `/history` | 最近 10 条发射事件 |
| `/bnb` | 查看如何用 BNB 续费 |

---

## 订阅与计费

### 套餐

| 套餐 | 价格 | 时长 | 推送 |
|------|------|------|------|
| 免费试用 | 0 | 3 天 | Four + Flap 各 1 次 |
| 专业版月付 | BNB × N | 30 天 | 全量推送 |
| 专业版年付 | BNB × N × 0.8 | 365 天 | 全量推送 + 优先推送 |

### 续费方式

在 `regou.app/renew` 页面选择套餐后，系统生成专属 BNB 收款地址。用户向该地址转账任意 BNB，系统按比例折算时长：

```
1 BNB = 30 天专业版
```

链上转账后 BSC Webhook (`/webhook/bnb-transfer`) 自动确认，给用户加时长。

---

## 监控与告警

### 推送健康检查

```bash
# 手动运行
bash scripts/push-monitor.sh

# 查看最近告警
curl -s -H "Authorization: Bearer $INTERNAL_API_KEY" \
  https://regou.app/internal/push-health

# 简洁状态
curl -s -H "Authorization: Bearer $INTERNAL_API_KEY" \
  https://regou.app/internal/push-health/latest
```

### 推送覆盖率阈值

- **critical**：覆盖率 < 50% 且有用户应收到推送
- **degraded**：覆盖率 < 95% 且有用户应收到推送
- **ok**：覆盖率 ≥ 95%

### Cron 配置（服务器）

```bash
# 每 10 分钟执行一次推送监控
*/10 * * * * cd /root/regou-app && bash scripts/push-monitor.sh >> logs/push-monitor.log 2>&1
```

### PM2 进程状态

```bash
pm2 status
# regouapp-web          → Web 服务器 + Queue Poller
# regouapp-collector    → BSC 事件采集
# regouapp-worker       → 推送任务生成
```

---

## 部署

### 前提

- 服务器：Linux（已测试 Ubuntu）
- 工具：bun ≥ 1.0，`pm2`，`sqlite3`（可选，用于 push-monitor.sh）
- SSH 访问服务器

### 一键部署

```bash
cd ~/code/regou-app
bash scripts/deploy.sh
```

> `deploy.sh` 会：
> 1. 压缩代码 → SCP 上传服务器
> 2. 服务器安装 bun / pm2 依赖
> 3. 执行 DB migration
> 4. `pm2 restart all`
> 5. 验证 `https://regou.app/` HTTP 200

### 单独重启服务

```bash
pm2 restart regouapp-web
pm2 restart regouapp-collector
pm2 restart regouapp-worker
```

---

## 环境变量

| 变量 | 说明 | 示例 |
|------|------|------|
| `DATABASE_PATH` | SQLite 数据库路径 | `./data/app.sqlite` |
| `BSC_RPC_URL` | BSC RPC 节点地址 | `https://public-bsc.nownodes.io/` |
| `COLLECTOR_FROM_BLOCK` | 采集起始区块号 | `35000000` |
| `COLLECTOR_BATCH_SIZE` | 每批处理区块数 | `2000` |
| `COLLECTOR_INTERVAL_MS` | 采集间隔（毫秒） | `60000` |
| `SERVER_PORT` | Web 服务器端口 | `30082` |
| `SESSION_SECRET` | 会话签名密钥 | `change-me-in-production` |
| `BNB_COLLECT_WALLET` | BNB 收款地址 | `0x...` |
| `INTERNAL_API_KEY` | 内部 API 密钥 | `...` |
| `FLAP_API_BASE_URL` | Flap 后端 API | `https://api.flashrot.com` |
| `FLAP_API_KEY` | Flap API 密钥 | `...` |

> 环境变量文件：`.env`（本地）、服务器 `/root/regou-app/.env`

---

## 开发调试

### 本地运行

```bash
bun install
bun run src/server/index.ts
```

### 运行测试

```bash
bun test
```

### 查看数据库

```bash
bunx bunsqlite inspect ./data/app.sqlite
# 或
sqlite3 ./data/app.sqlite
```

### 模拟发送微信消息

```bash
bun run scripts/test-send-message.ts
```

### 手动触发一次采集

```bash
bun run src/collectors/run.ts
```

### 查看 PM2 日志

```bash
pm2 logs regouapp-web --lines 50
pm2 logs regouapp-worker --lines 50
pm2 logs regouapp-collector --lines 50
```

---

## 常见问题

**Q: 微信没有收到推送？**
1. 检查 `pm2 status` 确认三服务全在线
2. `pm2 logs regouapp-worker` 看 job 是否生成
3. `pm2 logs regouapp-web` 看 queue poller 是否执行
4. `SELECT * FROM notification_jobs ORDER BY id DESC LIMIT 10` 查看 job 状态

**Q: ret=-2 错误？**
外部 ilinkai 微信 Bot API 不可用，该消息已标记为永久失败。如持续出现请联系 Bot API 提供方。

**Q: 新事件没采集到？**
1. `pm2 logs regouapp-collector` 看采集日志
2. 检查 `launch_events` 表最新记录时间
3. 确认 BSC_RPC_URL 可访问

**Q: 如何扩容？**
- Collector 和 Worker 本身无状态，可水平扩展（共用同一 SQLite WAL 模式支持多读）
- Queue Poller 只在 Web 服务中，扩展时注意 `pending_wechat_sends` 的 claim 竞争

---

*最后更新：$(git log -1 --format='%ci') · commit $(git rev-parse --short HEAD)*
