# 2026-03-29 执行交接记录

## 当前结论

- Task 1 已完成，并通过 spec review 与 code quality review。
- Task 2 已完成，并通过 spec review 与 code quality review。
- Task 3 已完成，并通过 spec review 与 code quality review。
- Task 4 已完成，并已独立提交。
- Task 5 已完成，并已独立提交。
- Task 6 已完成，并已独立提交。
- Task 7 已完成，并已独立提交。
- Task 8 已完成，并已独立提交。
- Task 9 已完成，并已独立提交。
- Task 10 已完成，并已独立提交。
- 一期计划中的 Task 1-10 已全部落地，当前无未完成的计划内实现项。

## 相关文档

- 设计文档：
  [docs/superpowers/specs/2026-03-29-meme-launch-notification-platform-design.md](/Users/ke/code/rgclaw/docs/superpowers/specs/2026-03-29-meme-launch-notification-platform-design.md)
- 实施计划：
  [docs/superpowers/plans/2026-03-29-meme-launch-platform-phase-1.md](/Users/ke/code/rgclaw/docs/superpowers/plans/2026-03-29-meme-launch-platform-phase-1.md)

## 已落地提交

- `bb9c860` `feat: bootstrap bun hono web app`
- `8b0ae5c` `fix: align task 1 bootstrap dependencies`
- `e758c35` `feat: add sqlite schema and migration runner`
- `37c5acc` `fix: harden sqlite migration bootstrap`
- `b7c2e1d` `fix: make sqlite migrations atomic`
- `fe13fc7` `feat: add email auth and session flow`
- `278e29b` `chore: ignore local worktrees`
- `f7e8f38` `fix: harden auth session flow`
- `4e76259` `docs: update execution handoff status`
- `bddb630` `feat: add public launch feed and repo rtk instructions`
- `ab9d503` `feat: add user center with wallet and subscriptions`
- `d156127` `feat: add wechat binding and trial entitlement`
- `799a2e2` `feat: add launch event collectors`
- `580c34f` `feat: use live bsc rpc for launch collectors`
- `418dec6` `feat: add push dispatch and renewal reminders`
- `62f6d87` `feat: add renewal page and bnb auto-renewal`
- `0ce2435` `feat: wire workers and complete smoke coverage`

## Task 1 状态

已完成。

完成内容：

- 建立 `Bun + Hono` 服务骨架
- 首页 `GET /` 返回 `最新发射事件`
- 建立 `package.json`、`tsconfig.json`
- Task 1 测试通过

验证结果：

- `bun test tests/server/app.test.ts` 通过

## Task 2 状态

已完成。

完成内容：

- 建立 SQLite 连接层
- 建立一期 schema
- 建立 migration 入口
- 补齐默认路径自举、migration bookkeeping、事务原子性
- 补齐 migration 测试

验证结果：

- `bun test tests/db/migrate.test.ts` 通过
- `bun run src/db/migrate.ts` 通过

关键文件：

- [src/db/sqlite.ts](/Users/ke/code/rgclaw/src/db/sqlite.ts)
- [src/db/schema.sql](/Users/ke/code/rgclaw/src/db/schema.sql)
- [src/db/migrate.ts](/Users/ke/code/rgclaw/src/db/migrate.ts)
- [tests/db/migrate.test.ts](/Users/ke/code/rgclaw/tests/db/migrate.test.ts)

## Task 3 状态

已完成。

完成内容：

- `fe13fc7` `feat: add email auth and session flow`
- `f7e8f38` `fix: harden auth session flow`

当前实现文件：

- [src/shared/types.ts](/Users/ke/code/rgclaw/src/shared/types.ts)
- [src/db/repositories/users.ts](/Users/ke/code/rgclaw/src/db/repositories/users.ts)
- [src/db/repositories/sessions.ts](/Users/ke/code/rgclaw/src/db/repositories/sessions.ts)
- [src/server/middleware/session.ts](/Users/ke/code/rgclaw/src/server/middleware/session.ts)
- [src/server/routes/auth.ts](/Users/ke/code/rgclaw/src/server/routes/auth.ts)
- [src/server/app.ts](/Users/ke/code/rgclaw/src/server/app.ts)
- [tests/server/auth.test.ts](/Users/ke/code/rgclaw/tests/server/auth.test.ts)

当前验证结果：

- `bun test tests/server/auth.test.ts` 通过
- `bun test` 通过

### Task 3 已完成项

- spec review: 通过
- code quality review: 通过
- 注册流程事务化，避免 session 创建失败留下半成功用户
- session cookie 补齐 `SameSite=Lax`，并在生产环境下启用 `Secure`
- 补齐 `/me` 访问控制、无效登录、伪造或过期 session、cookie 属性、注册原子性测试

## Task 4 状态

已完成。

完成内容：

- 首页 `GET /` 从 `launch_events` 读取公开事件流
- 新增 `launch-events repository` 与首页视图渲染
- 首页按 `event_time desc` 展示最新发射事件

关键文件：

- [src/db/repositories/launch-events.ts](/Users/ke/code/rgclaw/src/db/repositories/launch-events.ts)
- [src/server/views/home.ts](/Users/ke/code/rgclaw/src/server/views/home.ts)
- [tests/server/home-feed.test.ts](/Users/ke/code/rgclaw/tests/server/home-feed.test.ts)

## Task 5 状态

已完成。

完成内容：

- 用户中心展示邮箱、钱包地址、权益有效期
- 首次访问用户中心时自动补齐 `four` / `flap` 默认来源订阅
- 支持 `POST /me/wallet` 更新登记钱包地址

关键文件：

- [src/db/repositories/subscriptions.ts](/Users/ke/code/rgclaw/src/db/repositories/subscriptions.ts)
- [src/db/repositories/entitlements.ts](/Users/ke/code/rgclaw/src/db/repositories/entitlements.ts)
- [src/server/routes/user-center.ts](/Users/ke/code/rgclaw/src/server/routes/user-center.ts)
- [src/server/views/user-center.ts](/Users/ke/code/rgclaw/src/server/views/user-center.ts)
- [tests/server/user-center.test.ts](/Users/ke/code/rgclaw/tests/server/user-center.test.ts)

## Task 6 状态

已完成。

完成内容：

- 用户中心显示微信绑定状态与绑定码
- 新增 `/wechat/callback`，完成绑定后发放 3 天试用资格
- 绑定与试用状态在用户中心中可见

关键文件：

- [src/db/repositories/wechat-bindings.ts](/Users/ke/code/rgclaw/src/db/repositories/wechat-bindings.ts)
- [src/server/routes/wechat.ts](/Users/ke/code/rgclaw/src/server/routes/wechat.ts)
- [tests/server/wechat-binding.test.ts](/Users/ke/code/rgclaw/tests/server/wechat-binding.test.ts)

## Task 7 状态

已完成。

完成内容：

- 新增 `four` 与 `flap` 的事件标准化逻辑
- collector 已切换为正式 BSC RPC：`https://public-bsc.nownodes.io/`
- collector 使用分页 `eth_getLogs` + 轻量重试，避免大范围查询触发节点连接重置
- 实测 live collector 可写入真实链上事件，样本验证中写入 `119` 条记录，其中 `four=95`、`flap=24`

关键文件：

- [src/shared/config.ts](/Users/ke/code/rgclaw/src/shared/config.ts)
- [src/collectors/rpc.ts](/Users/ke/code/rgclaw/src/collectors/rpc.ts)
- [src/collectors/four.ts](/Users/ke/code/rgclaw/src/collectors/four.ts)
- [src/collectors/flap.ts](/Users/ke/code/rgclaw/src/collectors/flap.ts)
- [src/collectors/run.ts](/Users/ke/code/rgclaw/src/collectors/run.ts)
- [tests/collectors/normalize-events.test.ts](/Users/ke/code/rgclaw/tests/collectors/normalize-events.test.ts)

## Task 8 状态

已完成。

完成内容：

- 新增 `notification_jobs` 与 `system_message_jobs` 入队入口
- worker 可为符合条件的用户生成微信推送任务
- 权益在 1 天内到期且未提醒时，worker 会生成续费提醒并写回 `renewal_reminded_at`

关键文件：

- [src/db/repositories/notification-jobs.ts](/Users/ke/code/rgclaw/src/db/repositories/notification-jobs.ts)
- [src/workers/push-worker.ts](/Users/ke/code/rgclaw/src/workers/push-worker.ts)
- [tests/workers/push-worker.test.ts](/Users/ke/code/rgclaw/tests/workers/push-worker.test.ts)

## Task 9 状态

已完成。

完成内容：

- 新增 `/renew` 续费页，展示固定收款地址与价格
- 支持按登记钱包匹配到用户
- 支持 `0.005 BNB / 30 天` 的自动续期结算
- `0.01 BNB` 会折算为 `60` 天续期并写入 `payment_records`

关键文件：

- [src/db/repositories/payment-records.ts](/Users/ke/code/rgclaw/src/db/repositories/payment-records.ts)
- [src/server/routes/renewal.ts](/Users/ke/code/rgclaw/src/server/routes/renewal.ts)
- [src/server/views/renewal.ts](/Users/ke/code/rgclaw/src/server/views/renewal.ts)
- [src/workers/payment-watcher.ts](/Users/ke/code/rgclaw/src/workers/payment-watcher.ts)
- [tests/server/renewal-page.test.ts](/Users/ke/code/rgclaw/tests/server/renewal-page.test.ts)
- [tests/workers/payment-watcher.test.ts](/Users/ke/code/rgclaw/tests/workers/payment-watcher.test.ts)

## Task 10 状态

已完成。

完成内容：

- 新增 `src/workers/run.ts`，统一驱动推送任务与续费提醒处理
- `src/server/index.ts` 启动前执行 migration 自举
- 新增 smoke regression，确认首页、用户中心、续费页三条核心路由存在

关键文件：

- [src/workers/run.ts](/Users/ke/code/rgclaw/src/workers/run.ts)
- [src/server/index.ts](/Users/ke/code/rgclaw/src/server/index.ts)
- [tests/server/smoke.test.ts](/Users/ke/code/rgclaw/tests/server/smoke.test.ts)
- [tests/workers/run.test.ts](/Users/ke/code/rgclaw/tests/workers/run.test.ts)

## 当前验证结果

- `rtk test bun test` 通过
  结果：`27 pass / 0 fail / 98 expect() calls`
- `DATABASE_PATH=/tmp/rgclaw-live-collector-3.sqlite bun run src/collectors/run.ts` 已执行
  结果：使用正式节点成功写入真实事件
- `sqlite3 /tmp/rgclaw-live-collector-3.sqlite 'select source, count(*) from launch_events group by source order by source;'`
  结果：`flap|24`、`four|95`

## 下一步建议

计划内实现已经结束。后续工作建议按下面顺序开展：

1. 运维化 collector / worker
   把 `collector` 与 `worker` 做成长期运行进程，补齐 supervisor、日志与重启策略。

2. 环境变量与部署文档
   补充 `.env` 说明、生产运行方式、BSC RPC、微信/支付相关配置说明。

3. 真实消息发送与支付监听接入
   当前 worker 已能入队与结算，但真实微信发送与链上到账监听还停留在最小实现，需要进一步对接生产适配层。

4. 最终 review / 发布前检查
   做一次端到端人工走查，确认注册、绑定、首页事件流、续费页、自动续期闭环。

## 建议复跑命令

- `rtk test bun test`
- `DATABASE_PATH=/tmp/rgclaw-live-collector.sqlite bun run src/collectors/run.ts`
- `sqlite3 /tmp/rgclaw-live-collector.sqlite 'select source, count(*) from launch_events group by source order by source;'`
- `rtk git log --oneline -12`
- `rtk git status --short`

## 当前工作区状态

截至这次更新：

- `.worktrees/` 已被 `.gitignore` 忽略
- 当前 `main` 工作区干净，无已跟踪文件脏改动
- 当前实现已覆盖一期计划中的核心流程：公开事件流、账号体系、微信绑定、来源订阅、试用、提醒、续费页、自动续期、worker 启动入口

## 备注

- Task 2 中为测试原子性引入了 `beforeRecordMigration` 测试注入点。
  这不是当前阻塞项，但后续可以考虑收敛为更内部的测试辅助接口。
- `src/shared/types.ts` 里的 `LaunchSource` 当前仍保留旧值：`pump_fun | four_meme | gmgn`。
  这不阻塞当前实现，因为现阶段订阅与 collector 逻辑没有依赖该类型，但后续如果要继续收敛类型系统，应统一为 `four | flap`。
