# 2026-03-31 微信多 Bot 绑定与保活设计

## 目标

为当前 `rgclaw` 项目接入仓库内的 `WeClawBot-API`，形成可落地的微信通知通道，覆盖：

- `WeClawBot-API -> rgclaw` 的入站消息回调
- 多 Bot、多用户绑定关系
- 基于用户主动发送匹配码的绑定与改绑
- 通知消息通过已绑定 Bot 定向发出
- 18 到 19 小时窗口内的保活提醒
- 绑定后普通文本的统一自动回复

本阶段的目标不是做完整微信交互产品，而是先把通知通道、绑定关系和 24 小时互动窗口维持机制建立起来。

## 范围

本阶段包含：

- 在 `WeClawBot-API` 中新增入站文本消息回调能力
- 在 `rgclaw` 中扩展微信 callback 处理、绑定迁移和消息路由
- 扩展微信绑定数据模型以支持多 Bot
- 扩展 worker，完成真实出站发送和保活任务调度
- 新增必要测试，覆盖绑定、改绑、保活和多用户路由

本阶段不包含：

- 微信内“查询”功能
- 微信内“狙击”功能
- 复杂指令系统
- 回调签名鉴权
- 图片、媒体消息处理

## 关键约束

本设计以以下已确认约束为准：

- 采用多 Bot 设计，一个 Bot 可服务多个站内用户
- 用户不在站内选择 Bot，而是向某个 Bot 主动发送匹配码完成绑定
- 匹配码以 `uid:` 开头，采用可校验签名格式，不直接暴露裸可枚举 ID
- 同一站内用户给新 Bot 发送匹配码时，旧 Bot 绑定失效，新 Bot 接管
- 同一微信号给新用户发送匹配码时，旧用户绑定失效，新用户接管
- 普通文本暂不进入业务功能，统一回复“查询和狙击功能开发中”
- 保活任务每小时执行一次，只针对上一次系统成功发送时间位于 18 到 19 小时前的绑定关系
- 回调先按内网访问控制，不做签名鉴权

## 总体架构

系统拆分为 3 层职责：

1. `WeClawBot-API` 作为通道层
   - 负责登录和维持多个微信 Bot
   - 负责调用微信底层能力收消息、发消息
   - 负责把入站文本消息回调给 `rgclaw`

2. `rgclaw` 作为业务编排层
   - 接收入站 callback
   - 识别和校验 `uid:` 匹配码
   - 维护“用户 <-> Bot <-> 微信会话”的当前活跃绑定
   - 决定普通文本如何自动回复
   - 决定哪些通知发给哪些绑定
   - 决定哪些绑定需要保活提醒

3. worker 作为异步执行层
   - 扫描通知任务与系统消息任务
   - 查询当前活跃绑定
   - 通过正确的 Bot 把消息发送给正确的微信会话
   - 在发送成功后回写保活相关时间戳

设计原则：

- `WeClawBot-API` 不承载业务绑定规则，只承载微信通道能力
- `rgclaw` 是绑定和通知路由的唯一真相源
- 每个站内用户任一时刻只允许一个活跃微信绑定
- 每个微信会话任一时刻也只归属一个站内用户

## 绑定模型

### 绑定对象

一条活跃绑定由以下三元组确定：

- `user_id`
- `bot_id`
- `bot_wechat_user_id`

其中：

- `user_id` 是 `rgclaw` 内部站内用户
- `bot_id` 是 `WeClawBot-API` 中的登录 Bot 标识
- `bot_wechat_user_id` 是该 Bot 视角下的微信对端用户 ID

### 单活规则

系统强制执行以下规则：

- 一个 `user_id` 只能存在一条活跃绑定
- 一个 `(bot_id, bot_wechat_user_id)` 只能存在一条活跃绑定
- 新绑定生效时，冲突的旧绑定自动失活

这套规则直接覆盖两类改绑场景：

- 用户对新 Bot 发送匹配码，旧 Bot 绑定失效
- 同一微信号对新用户发送匹配码，旧用户绑定失效

### 匹配码格式

匹配码采用可校验签名格式，固定形式：

- `uid:<userId>:<signature>`

其中 `signature` 基于服务端密钥生成，例如对 `userId` 做 HMAC。

目标：

- 文本以 `uid:` 开头，便于机器人识别
- 不要求预先创建一次性待绑定码记录
- 避免直接暴露可枚举的用户真实 ID 规则
- `rgclaw` 收到入站消息后可直接验签并得到目标用户

## 回调协议设计

### 回调方向

新增回调链路：

- `WeClawBot-API -> POST rgclaw /wechat/callback`

### 回调范围

首期只回调文本消息。非文本消息由 `WeClawBot-API` 直接忽略，不进入 `rgclaw`。

### 回调字段

`WeClawBot-API` 回调必须上送以下字段：

- `botId`
- `fromUserId`
- `text`
- `contextToken`
- `messageId`
- `receivedAt`
- `rawPayload`

字段语义：

- `botId`：收到该消息的 Bot 标识
- `fromUserId`：发送消息的微信用户 ID
- `text`：文本内容
- `contextToken`：当前会话上下文，用于后续定向回复
- `messageId`：消息幂等标识
- `receivedAt`：`WeClawBot-API` 收到消息的时间
- `rawPayload`：完整原始消息，用于排障

### 幂等要求

`rgclaw` 以 `messageId` 做 callback 幂等处理：

- 已处理过的 `messageId` 直接返回成功
- 不重复创建回复任务
- 不重复执行绑定迁移

## 入站处理流程

`rgclaw` 在收到 callback 后按以下顺序处理：

1. 校验请求来源
   - 仅接受内网访问
   - 非法来源直接拒绝

2. 校验 payload
   - 缺少 `botId`、`fromUserId`、`messageId` 时返回 `400`
   - 非文本消息直接返回 `200`

3. 记录入站事件
   - 保存原始 payload 与处理状态
   - 为后续排障与幂等提供依据

4. 刷新会话状态
   - 对当前 `(botId, fromUserId)` 记录最新 `last_inbound_at`
   - 若 callback 带 `contextToken`，同步更新为最新会话上下文

5. 判断是否是匹配码
   - 文本以 `uid:` 开头时进入绑定流程
   - 验签通过则拿到目标 `user_id`
   - 验签失败按普通文本处理

6. 绑定流程
   - 失活该 `user_id` 现有活跃绑定
   - 失活该 `(botId, fromUserId)` 现有活跃绑定
   - 写入新的活跃绑定记录
   - 记录 `bound_at`、`last_inbound_at`、`last_context_token`
   - 创建一条“绑定成功”系统消息任务

7. 普通文本处理
   - 若当前 `(botId, fromUserId)` 已绑定站内用户，创建自动回复任务，内容固定为“查询和狙击功能开发中”
   - 若未绑定，创建一条“请先发送绑定码完成绑定”的引导消息任务

所有绑定迁移步骤必须在一个数据库事务内完成，避免中间态。

## 出站消息设计

### 消息路由原则

每一条待发送消息都必须通过当前活跃绑定路由到：

- 正确的 `bot_id`
- 正确的 `bot_wechat_user_id`
- 对应的 `last_context_token`

不得依赖 Bot 级别的“最近一次活跃会话”全局状态，否则多用户场景会串消息。

### `WeClawBot-API` 出站能力要求

当前仓库内 `WeClawBot-API` 的 `/bots/{bot_id}/messages` 更接近“向 Bot 当前上下文对象发消息”的实现。

为支持本设计，必须扩展为显式定向发送：

- 请求路径仍可保留 `/bots/{bot_id}/messages`
- 请求体需支持显式传入 `toUserId`
- 请求体需支持显式传入 `contextToken`
- 实际发送时以请求体传入的目标会话为准，而不是 Bot 全局保存的单一上下文

这是多用户设计成立的前提条件。

### 出站任务类型

沿用现有任务模型：

- `notification_jobs`
  - 用于发币通知等事件驱动消息
- `system_message_jobs`
  - 用于绑定成功回执、续费提醒、普通文本自动回复、保活提醒

worker 负责从上述任务表中扫描待发消息并执行真实发送。

### 发送成功后的状态更新

出站成功后需回写：

- 任务 `status = sent`
- 任务 `sent_at`
- 绑定记录 `last_outbound_at = now`
- 如为保活提醒，再更新 `last_keepalive_sent_at = now`

出站失败后需回写：

- 任务状态保持 `pending`
- `attempt_count`
- `last_error`

worker 采用简单重试模型：

- 默认保留 `pending` 等待下轮重试
- `attempt_count >= 3` 后标记为 `failed`

若失败原因是 24 小时窗口已关闭或上下文失效，必须记录明确错误文本，便于后续处理。

## 保活设计

### 目的

微信通道在超过 24 小时无互动后不能继续推送，因此需要在窗口关闭前主动发送一条提醒，促使用户回复任意消息。

### 执行频率

保活扫描每小时执行一次。

### 触发条件

只有同时满足以下条件的活跃绑定才进入保活发送：

- 存在活跃绑定
- 上一次系统成功发送时间 `last_outbound_at` 落在当前时间的 18 到 19 小时前
- 当前绑定具备继续接收通知的资格
- 当前小时尚未发送过保活提醒

“具备继续接收通知资格”固定判定为：

- 用户仍处于活跃绑定状态
- 用户已启用微信通知来源
- 用户存在未过期的 `active` entitlement

### 保活文案

保活提醒使用纯保活文案：

- “为保持通知能力，请回复任意消息。”

### 用户回复后的行为

用户在收到保活提醒后回复任意文本：

- callback 会刷新 `last_inbound_at`
- 若用户已绑定，则创建固定自动回复任务“查询和狙击功能开发中”
- 该互动将重新打开微信窗口

## 普通文本行为

本阶段不实现真实查询或狙击功能。

规则如下：

- 已绑定用户发送普通文本：回复“查询和狙击功能开发中”
- 未绑定用户发送普通文本：回复“请先发送绑定码完成绑定”

后续如果新增查询和狙击能力，可在当前分发点按命令前缀继续扩展。

## 数据模型调整

### `user_wechat_bindings`

当前表只适用于单 Bot 和简化绑定，需要扩展为支持多 Bot 和保活。

固定字段：

- `id`
- `user_id`
- `bot_id`
- `bot_wechat_user_id`
- `status`
- `bound_at`
- `unbound_at`
- `last_inbound_at`
- `last_outbound_at`
- `last_keepalive_sent_at`
- `last_context_token`
- `last_error`
- `created_at`
- `updated_at`

字段规则：

- `status` 取值限定为 `active` 或 `inactive`
- `user_id` 的活跃绑定全局唯一
- `(bot_id, bot_wechat_user_id)` 的活跃绑定全局唯一

### `wechat_inbound_events`

新增一张入站事件表，用于 callback 幂等与排障。

固定字段：

- `id`
- `message_id`
- `bot_id`
- `from_user_id`
- `text`
- `received_at`
- `process_status`
- `raw_payload`
- `created_at`

约束：

- `message_id` 唯一

### 现有任务表

现有 `notification_jobs` 与 `system_message_jobs` 可继续使用，不需要为本阶段新增第三种消息任务表。

现有任务表允许做最小补充，只增加以下两个字段：

- `updated_at`
- `next_attempt_at`

不引入新的任务系统。

## 配置设计

新增以下环境变量：

- `WECHAT_BOT_API_BASE_URL`
- `WECHAT_BOT_CALLBACK_ALLOWLIST`
- `WECHAT_BIND_SECRET`
- `WECHAT_KEEPALIVE_ENABLED`

说明：

- `WECHAT_BOT_API_BASE_URL`：`rgclaw` 调用 `WeClawBot-API` 的地址
- `WECHAT_BOT_CALLBACK_ALLOWLIST`：允许访问 callback 的内网来源
- `WECHAT_BIND_SECRET`：生成与校验 `uid:` 签名码的密钥
- `WECHAT_KEEPALIVE_ENABLED`：用于按环境开关保活任务

## 错误处理

### callback 侧

- 非法来源返回 `403`
- 缺少必要字段返回 `400`
- 重复消息返回 `200`
- 验签失败不视为系统异常
- 绑定迁移失败返回 `500` 并记录入站事件失败原因

### 出站侧

- 通道层返回非 200 时记录 `last_error`
- 临时故障允许重试
- 永久故障可标记为失败
- 上下文失效或 24 小时窗口关闭需要写清楚错误类型

## 测试范围

本阶段至少覆盖以下测试：

1. 匹配码绑定
   - 有效 `uid:` 签名码可成功绑定
   - 无效签名码不会错误绑定

2. 用户改绑
   - 同一用户向新 Bot 发送匹配码后，旧 Bot 绑定失活

3. 微信号改绑
   - 同一微信号向新用户发送匹配码后，旧用户绑定失活

4. 普通文本回调
   - 已绑定用户发普通文本会创建固定回复任务
   - 未绑定用户发普通文本会创建引导回复任务

5. 回调幂等
   - 重复 `messageId` 不重复创建任务，不重复改绑

6. 多用户消息路由
   - 同一个 Bot 服务多个微信用户时，worker 能按绑定精确路由消息

7. 保活扫描
   - `last_outbound_at` 位于 18 到 19 小时窗口内时命中
   - 小于 18 小时或大于 19 小时时不命中
   - 同一小时内不重复发保活

## 落地边界

本阶段预期修改如下：

### `rgclaw`

- 扩展 [`src/db/schema.sql`](/Users/ke/code/rgclaw/src/db/schema.sql)
- 重写 [`src/db/repositories/wechat-bindings.ts`](/Users/ke/code/rgclaw/src/db/repositories/wechat-bindings.ts)
- 扩展 [`src/server/routes/wechat.ts`](/Users/ke/code/rgclaw/src/server/routes/wechat.ts)
- 实现 [`src/adapters/wechat-bot.ts`](/Users/ke/code/rgclaw/src/adapters/wechat-bot.ts) 的真实发送逻辑和匹配码生成逻辑
- 扩展 worker，使其真正执行出站发送和保活扫描
- 新增测试

### `WeClawBot-API`

- 新增入站消息 callback 能力
- 在文本消息到达时主动回调 `rgclaw`
- 扩展发消息接口，允许显式指定目标微信用户与上下文 token
- 更新 README，写清 callback 协议与新的发送参数

## 风险与后续

### 已知风险

- 当前 `WeClawBot-API` 代码依赖 Bot 级别上下文发送消息，如果不扩展为显式目标会话，多用户一定会串消息
- 当前 callback 不做签名，仅靠内网限制，部署时需要明确网络边界
- 保活提醒会增加额外消息量，后续需要观察真实稳定性

### 后续顺序

实现顺序固定为：

1. 先扩展 `WeClawBot-API` 的 callback 与显式定向发送能力
2. 再扩展 `rgclaw` 的表结构与 repository
3. 然后落地 callback 处理与绑定迁移
4. 再补真实出站 worker
5. 最后补保活扫描和测试
