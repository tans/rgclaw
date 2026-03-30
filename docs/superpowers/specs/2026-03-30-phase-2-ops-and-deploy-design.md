# 2026-03-30 Phase 2 运维与部署设计

## 目标

为当前一期已完成的 `rgclaw` 系统补齐 Linux 服务器上的标准运行与交付方式，覆盖：

- `pm2` 进程编排
- 环境变量模板
- 首发部署与日常重启脚本
- 健康检查脚本
- Nginx 对接说明

本阶段不直接实现真实微信发送与真实链上到账监听逻辑，只为后续接入提供稳定运行骨架与文档边界。

## 范围

本阶段包含：

- 新增 `pm2 ecosystem` 配置
- 新增 `.env.example`
- 新增 `scripts/ops/` 运维脚本
- 新增部署文档
- 提供 Nginx 反向代理参考片段

本阶段不包含：

- 真实微信机器人发送实现
- 真实链上到账 watcher 常驻监听实现
- Docker / Compose 部署方案
- CI/CD 自动发布流水线

## 运行拓扑

目标部署环境：

- Linux 服务器
- 已存在 Nginx
- 应用进程由 `pm2` 管理

进程拆分为 3 个独立 app：

1. `web`
   运行 `bun run src/server/index.ts`
   对外提供 HTTP 服务，由 Nginx 反向代理。

2. `collector`
   运行 `bun run src/collectors/run.ts`
   负责拉取 BSC 上 `four` / `flap` 事件并写入 `launch_events`。

3. `worker`
   运行 `bun run src/workers/run.ts`
   负责推送任务生成、续费提醒以及后续扩展出的后台任务。

## 配置设计

### `.env.example`

仓库根目录新增 `.env.example`，至少包含：

- `PORT`
- `DATABASE_PATH`
- `BSC_RPC_URL`
- `COLLECTOR_LOOKBACK_BLOCKS`
- `COLLECTOR_BATCH_BLOCKS`
- `WECHAT_BOT_ENDPOINT`
- `WECHAT_BOT_TOKEN`
- `PAYMENT_WATCHER_ENABLED`
- `PAYMENT_CONFIRMATIONS`

规则：

- 当前已实现且代码实际使用的变量要给默认示例值
- 未来要接真实适配层的变量先给占位说明
- 不在示例中出现真实密钥或真实生产地址

## `pm2` 配置设计

新增仓库根目录 `ecosystem.config.json`。

要求：

- 统一从 `.env` 读取环境变量
- 3 个 app 分别声明
- 指定工作目录、脚本、解释器与日志路径
- 日志落到仓库内 `logs/` 目录
- 进程失败自动重启

建议 app：

- `rgclaw-web`
- `rgclaw-collector`
- `rgclaw-worker`

## 运维脚本设计

新增目录：

- `scripts/ops/`

包含以下脚本：

1. `bootstrap.sh`
   作用：
   - 安装依赖
   - 准备日志目录
   - 用 `pm2 ecosystem.config.json` 首次启动应用
   - 输出后续常用命令提示

2. `restart.sh`
   作用：
   - 重启 `web`、`collector`、`worker`
   - 支持在发布后快速重载

3. `status.sh`
   作用：
   - 输出 `pm2 status`
   - 输出最近若干日志查看方式提示

4. `healthcheck.sh`
   作用：
   - 检查 `pm2` 中 3 个 app 是否在线
   - 检查首页 `/` 返回 200
   - 检查 `/renew` 未登录返回 302
   - 任一检查失败时返回非 0 退出码

脚本约束：

- 使用 `bash`
- 默认在仓库根目录执行
- 不依赖项目外的私有路径
- 失败时快速退出

## 部署文档设计

新增部署文档，建议路径：

- `docs/superpowers/deploy/2026-03-30-phase-2-linux-pm2-deploy.md`

文档内容包括：

### 1. 前置要求

- Linux 服务器已安装 Bun
- 已安装 `pm2`
- 已安装并配置 Nginx
- 已创建部署目录

### 2. 首次部署

- 拉代码
- 配置 `.env`
- 执行 `scripts/ops/bootstrap.sh`
- 验证 `pm2 status`
- 执行健康检查

### 3. 日常更新

- 拉最新代码
- 安装依赖
- 执行 `scripts/ops/restart.sh`
- 执行健康检查

### 4. 日志与排障

- `pm2 logs`
- `pm2 monit`
- 查看 `logs/` 目录

### 5. 回滚

- 切回指定 commit
- 重装依赖
- 重启进程
- 再次执行健康检查

## Nginx 对接方式

本阶段不直接提交面向某台服务器的完整 Nginx 配置文件。

原因：

- 线上机器通常已有既有目录结构、证书路径、域名与日志策略
- 把强耦合配置硬编码进仓库容易误用

因此只在部署文档中提供一个参考片段，内容包括：

- `location /` 反向代理到 `127.0.0.1:$PORT`
- 传递 `Host`、`X-Forwarded-For`、`X-Forwarded-Proto`
- 合理的超时配置

## 错误处理

### 部署阶段

- 缺 `.env` 时脚本直接失败
- `pm2` 不存在时脚本直接失败并提示安装
- 健康检查失败时返回非 0 并提示查看日志

### 运行阶段

- `pm2` 负责崩溃后的自动重启
- 业务错误仍写入 app 日志，由 `pm2 logs` 与 `logs/` 统一查看

## 测试与验证

本阶段实现后的验证至少包括：

1. `bun test`
   保证现有业务回归不受影响

2. `bash scripts/ops/healthcheck.sh`
   在本地或目标环境验证脚本逻辑

3. `pm2 start ecosystem.config.json`
   验证 `pm2` 配置能拉起 3 个 app

4. 通过 Nginx 访问首页
   确认反向代理链路成立

## 交付物

本阶段完成后，仓库应新增：

- `.env.example`
- `ecosystem.config.json`
- `scripts/ops/bootstrap.sh`
- `scripts/ops/restart.sh`
- `scripts/ops/status.sh`
- `scripts/ops/healthcheck.sh`
- `docs/superpowers/deploy/2026-03-30-phase-2-linux-pm2-deploy.md`

## 风险与后续

### 已知风险

- 当前 `wechat-bot.ts` 仍是 stub，运维化不等于真实消息发送已可用
- 当前 `payment-watcher.ts` 是函数入口，不是链上守护进程
- `src/shared/types.ts` 中 `LaunchSource` 仍未统一为 `four | flap`

### 后续顺序

1. 先完成本阶段运维化与部署文档
2. 再单独做真实微信发送接入
3. 再单独做真实链上到账监听常驻化
4. 最后做发布前端到端走查
