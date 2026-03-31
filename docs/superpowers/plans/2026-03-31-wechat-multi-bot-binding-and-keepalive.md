# Wechat Multi-Bot Binding And Keepalive Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 为 `rgclaw` 和仓库内 `WeClawBot-API` 落地多 Bot 微信绑定、入站回调、真实出站发送和 18 小时保活提醒。

**Architecture:** `WeClawBot-API` 负责多 Bot 登录、显式定向发送和入站文本 callback，`rgclaw` 负责绑定关系、签名匹配码、入站幂等、任务编排和保活判断。实现上先补 `WeClawBot-API` 通道能力，再做 SQLite migration 和 repository，随后替换 callback 与 worker 路径，最后补文档和全量验证。

**Tech Stack:** Go 1.24, Bun, TypeScript, Hono, SQLite, fetch, bun:test

---

## 文件结构

- Create: `WeClawBot-API/main_test.go`
  覆盖显式定向发送、内部 token 和 callback payload。
- Modify: `WeClawBot-API/main.go`
  增加内部 bearer、显式目标发送、文本 callback 辅助函数。
- Modify: `WeClawBot-API/README.md`
  记录 callback 配置和新的发送参数。
- Create: `src/db/migrations/0002_wechat_multi_bot.sql`
  迁移旧版微信绑定表并新增 `wechat_inbound_events`。
- Modify: `src/db/migrate.ts`
  注册 `0002` migration。
- Create: `src/shared/wechat-bind-code.ts`
  生成和校验 `uid:<userId>:<signature>`。
- Modify: `src/shared/config.ts`
  暴露微信 callback、bind secret、keepalive、bot API 配置。
- Modify: `src/db/schema.sql`
  让全新数据库直接落到新 schema。
- Modify: `src/db/repositories/wechat-bindings.ts`
  实现活跃绑定查询、改绑事务、会话时间戳更新和保活扫描。
- Create: `src/db/repositories/wechat-inbound-events.ts`
  记录 callback 幂等事件。
- Modify: `src/db/repositories/notification-jobs.ts`
  增加待发任务查询、成功/失败回写和重试字段。
- Modify: `src/db/repositories/entitlements.ts`
  增加“用户存在未过期 active entitlement”查询。
- Modify: `src/adapters/wechat-bot.ts`
  实现真实 HTTP 发送和固定文案构造。
- Modify: `src/server/routes/user-center.ts`
  输出新的签名绑定码。
- Modify: `src/server/views/user-center.ts`
  展示新的 `uid:` 绑定串。
- Modify: `src/server/routes/wechat.ts`
  替换成完整 callback 处理、绑定迁移和自动回复入队。
- Modify: `src/workers/push-worker.ts`
  新增待发消息下发、保活扫描、发送成功后更新时间戳。
- Modify: `src/workers/run.ts`
  聚合新的 worker 统计。
- Modify: `.env.example`
  替换旧微信配置为新配置。
- Create: `tests/shared/wechat-bind-code.test.ts`
  覆盖签名生成与验签。
- Create: `tests/db/wechat-bindings.test.ts`
  覆盖单活绑定和保活筛选。
- Modify: `tests/db/migrate.test.ts`
  断言 `0002` migration 生效。
- Modify: `tests/server/user-center.test.ts`
  断言页面输出 `uid:` 绑定串。
- Modify: `tests/server/wechat-binding.test.ts`
  改成新 callback payload、改绑、幂等和普通文本回复断言。
- Modify: `tests/workers/push-worker.test.ts`
  覆盖任务下发、保活扫描和失败重试。
- Modify: `tests/workers/run.test.ts`
  断言 worker 一次循环包含 keepalive 和 dispatch 统计。

### Task 1: 给 `WeClawBot-API` 加显式目标发送和内部 Bearer

**Files:**
- Create: `WeClawBot-API/main_test.go`
- Modify: `WeClawBot-API/main.go`

- [ ] **Step 1: 写 `WeClawBot-API` 的失败测试**

`WeClawBot-API/main_test.go`

```go
package main

import (
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

func TestMessagesHandlerUsesExplicitTargetAndContext(t *testing.T) {
	cfg = AppConfig{
		Bots: map[string]*UserConfig{
			"bot-1": {
				BotID:        "bot-1",
				APIToken:     "bot-token",
				IlinkUserID:  "fallback-user",
				ContextToken: "fallback-context",
			},
		},
	}

	var gotTo string
	var gotText string
	var gotContext string
	previous := sendMessageFn
	sendMessageFn = func(user *UserConfig, to string, text string, contextToken string) error {
		gotTo = to
		gotText = text
		gotContext = contextToken
		return nil
	}
	defer func() {
		sendMessageFn = previous
	}()

	handler := buildBotAPIHandler()
	req := httptest.NewRequest(http.MethodPost, "/bots/bot-1/messages", strings.NewReader(`{"text":"hello","toUserId":"wx-user-9","contextToken":"ctx-9"}`))
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Authorization", "Bearer bot-token")
	res := httptest.NewRecorder()

	handler.ServeHTTP(res, req)

	if res.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d", res.Code)
	}
	if gotTo != "wx-user-9" || gotText != "hello" || gotContext != "ctx-9" {
		t.Fatalf("unexpected send args: to=%q text=%q context=%q", gotTo, gotText, gotContext)
	}
}

func TestMessagesHandlerAcceptsInternalToken(t *testing.T) {
	cfg = AppConfig{
		Bots: map[string]*UserConfig{
			"bot-1": {
				BotID:    "bot-1",
				APIToken: "bot-token",
			},
		},
	}
	internalAPIToken = "cluster-token"

	previous := sendMessageFn
	sendMessageFn = func(user *UserConfig, to string, text string, contextToken string) error {
		return nil
	}
	defer func() {
		sendMessageFn = previous
		internalAPIToken = ""
	}()

	handler := buildBotAPIHandler()
	req := httptest.NewRequest(http.MethodPost, "/bots/bot-1/messages", strings.NewReader(`{"text":"hello","toUserId":"wx-user-9","contextToken":"ctx-9"}`))
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Authorization", "Bearer cluster-token")
	res := httptest.NewRecorder()

	handler.ServeHTTP(res, req)

	if res.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d", res.Code)
	}
}
```

- [ ] **Step 2: 跑 Go 测试确认失败**

Run:

```bash
rtk proxy "cd WeClawBot-API && go test ./..."
```

Expected: FAIL，报 `undefined: sendMessageFn` 或 `undefined: buildBotAPIHandler`

- [ ] **Step 3: 实现显式目标发送和内部 token**

`WeClawBot-API/main.go`

```go
var (
	configPath       = "./config/auth.json"
	cfg              AppConfig
	configLock       sync.Mutex
	activeUser       string
	internalAPIToken string
	sendMessageFn    = sendMessage
)

func bearerToken(r *http.Request) string {
	authHeader := r.Header.Get("Authorization")
	if strings.HasPrefix(authHeader, "Bearer ") {
		return strings.TrimPrefix(authHeader, "Bearer ")
	}
	return ""
}

func requestAuthorized(user *UserConfig, r *http.Request, jsonBody map[string]interface{}) bool {
	token := bearerToken(r)
	if token == "" {
		token = getReqParam(r, "token", jsonBody)
	}
	if internalAPIToken != "" && token == internalAPIToken {
		return true
	}
	return token != "" && token == user.APIToken
}

func buildBotAPIHandler() http.Handler {
	mux := http.NewServeMux()
	mux.HandleFunc("/bots/", func(w http.ResponseWriter, r *http.Request) {
		path := strings.TrimPrefix(r.URL.Path, "/bots/")
		parts := strings.Split(path, "/")
		if len(parts) < 2 {
			sendJSON(w, http.StatusNotFound, map[string]interface{}{"code": 404, "error": "Not Found"})
			return
		}

		botID := parts[0]
		action := parts[1]
		jsonBody := make(map[string]interface{})
		ct := r.Header.Get("Content-Type")
		if strings.Contains(ct, "application/json") {
			body, _ := io.ReadAll(r.Body)
			json.Unmarshal(body, &jsonBody)
		} else if strings.Contains(ct, "multipart/form-data") {
			r.ParseMultipartForm(10 << 20)
		} else {
			r.ParseForm()
		}

		configLock.Lock()
		user, exists := cfg.Bots[botID]
		configLock.Unlock()
		if !exists {
			sendJSON(w, http.StatusNotFound, map[string]interface{}{"code": 404, "error": "Bot not found"})
			return
		}
		if !requestAuthorized(user, r, jsonBody) {
			sendJSON(w, http.StatusUnauthorized, map[string]interface{}{"code": 401, "error": "Unauthorized"})
			return
		}

		switch action {
		case "messages":
			text := getReqParam(r, "text", jsonBody)
			toUserID := getReqParam(r, "toUserId", jsonBody)
			contextToken := getReqParam(r, "contextToken", jsonBody)
			if text == "" {
				sendJSON(w, http.StatusBadRequest, map[string]interface{}{"code": 400, "error": "Missing text"})
				return
			}
			if toUserID == "" {
				toUserID = user.IlinkUserID
			}
			if contextToken == "" {
				contextToken = user.ContextToken
			}
			if toUserID == "" || contextToken == "" {
				sendJSON(w, http.StatusBadRequest, map[string]interface{}{"code": 400, "error": "Context not ready"})
				return
			}
			if err := sendMessageFn(user, toUserID, text, contextToken); err != nil {
				sendJSON(w, http.StatusInternalServerError, map[string]interface{}{"code": 500, "error": err.Error()})
				return
			}
			sendJSON(w, http.StatusOK, map[string]interface{}{"code": 200, "message": "OK"})
		}
	})
	return mux
}

func startAPIServer(port int) {
	addr := fmt.Sprintf(":%d", port)
	fmt.Printf("API Server listening on http://0.0.0.0%s\n", addr)
	http.ListenAndServe(addr, buildBotAPIHandler())
}
```

并在 `main()` 里把内部 token 从环境变量读出来：

```go
internalAPIToken = os.Getenv("WECLAWBOT_INTERNAL_TOKEN")
```

- [ ] **Step 4: 重新跑 Go 测试确认通过**

Run:

```bash
rtk proxy "cd WeClawBot-API && go test ./..."
```

Expected: PASS，输出 `ok  	weclawbot-api`

- [ ] **Step 5: 提交**

```bash
rtk git add WeClawBot-API/main.go WeClawBot-API/main_test.go
rtk git commit -m "feat: support explicit wechat targets"
```

### Task 2: 给 `WeClawBot-API` 加文本 callback 并更新 README

**Files:**
- Modify: `WeClawBot-API/main_test.go`
- Modify: `WeClawBot-API/main.go`
- Modify: `WeClawBot-API/README.md`

- [ ] **Step 1: 追加 callback 的失败测试**

`WeClawBot-API/main_test.go`

```go
func TestForwardInboundTextCallbackPostsPayload(t *testing.T) {
	internalAPIToken = ""
	callbackURL = ""

	var gotBody string
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		body, _ := io.ReadAll(r.Body)
		gotBody = string(body)
		w.WriteHeader(http.StatusOK)
	}))
	defer server.Close()

	callbackURL = server.URL
	defer func() {
		callbackURL = ""
	}()

	err := forwardInboundTextCallback(&UserConfig{BotID: "bot-1"}, inboundTextCallback{
		BotID:        "bot-1",
		FromUserID:   "wx-user-1",
		Text:         "uid:user-1:abc",
		ContextToken: "ctx-1",
		MessageID:    "bot-1:msg-1",
		ReceivedAt:   "2026-03-31T01:00:00.000Z",
		RawPayload:   json.RawMessage(`{"text":"uid:user-1:abc"}`),
	})
	if err != nil {
		t.Fatalf("expected nil error, got %v", err)
	}
	if !strings.Contains(gotBody, `"botId":"bot-1"`) || !strings.Contains(gotBody, `"messageId":"bot-1:msg-1"`) {
		t.Fatalf("unexpected callback payload: %s", gotBody)
	}
}
```

- [ ] **Step 2: 跑 Go 测试确认失败**

Run:

```bash
rtk proxy "cd WeClawBot-API && go test ./..."
```

Expected: FAIL，报 `undefined: callbackURL` 或 `undefined: forwardInboundTextCallback`

- [ ] **Step 3: 实现 callback helper 并在 `monitorWeixin` 调用**

`WeClawBot-API/main.go`

```go
type inboundTextCallback struct {
	BotID        string          `json:"botId"`
	FromUserID   string          `json:"fromUserId"`
	Text         string          `json:"text"`
	ContextToken string          `json:"contextToken"`
	MessageID    string          `json:"messageId"`
	ReceivedAt   string          `json:"receivedAt"`
	RawPayload   json.RawMessage `json:"rawPayload"`
}

var callbackURL string

func forwardInboundTextCallback(user *UserConfig, payload inboundTextCallback) error {
	if callbackURL == "" {
		return nil
	}
	body, err := json.Marshal(payload)
	if err != nil {
		return err
	}
	req, err := http.NewRequest(http.MethodPost, callbackURL, bytes.NewReader(body))
	if err != nil {
		return err
	}
	req.Header.Set("Content-Type", "application/json")
	res, err := (&http.Client{Timeout: 5 * time.Second}).Do(req)
	if err != nil {
		return err
	}
	defer res.Body.Close()
	if res.StatusCode < 200 || res.StatusCode >= 300 {
		return fmt.Errorf("callback status %d", res.StatusCode)
	}
	return nil
}

func callbackMessageID(botID string, msg WeixinMessage, text string) string {
	return fmt.Sprintf("%s:%s:%s:%s", botID, msg.FromUserID, msg.ContextToken, text)
}
```

在 `main()` 里读取：

```go
callbackURL = os.Getenv("WECLAWBOT_CALLBACK_URL")
```

在 `monitorWeixin` 里处理文本项时追加：

```go
rawMessage, _ := json.Marshal(msg)
payload := inboundTextCallback{
	BotID:        user.BotID,
	FromUserID:   msg.FromUserID,
	Text:         item.TextItem.Text,
	ContextToken: msg.ContextToken,
	MessageID:    callbackMessageID(user.BotID, msg, item.TextItem.Text),
	ReceivedAt:   time.Now().UTC().Format(time.RFC3339Nano),
	RawPayload:   rawMessage,
}
if err := forwardInboundTextCallback(user, payload); err != nil {
	log.Printf("[Bot: %s] callback failed: %v\n", user.BotID, err)
}
```

- [ ] **Step 4: 更新 README 的配置和调用示例**

`WeClawBot-API/README.md`

````md
### 回调配置

可通过环境变量启用入站文本消息回调：

```bash
WECLAWBOT_CALLBACK_URL=http://rgclaw:3000/wechat/callback
WECLAWBOT_INTERNAL_TOKEN=replace-me
```

文本消息到达后，`WeClawBot-API` 会向 callback 地址发送：

```json
{
  "botId": "xxx@im.bot",
  "fromUserId": "wx-user-1",
  "text": "uid:user-1:signature",
  "contextToken": "context-token",
  "messageId": "bot-1:msg-1",
  "receivedAt": "2026-03-31T01:00:00.000Z",
  "rawPayload": {}
}
```

### 显式目标发送

`/bots/{bot_id}/messages` 现在支持：

- `text`
- `toUserId`
- `contextToken`
````

- [ ] **Step 5: 重新跑 Go 测试确认通过**

Run:

```bash
rtk proxy "cd WeClawBot-API && go test ./..."
```

Expected: PASS，输出 `ok  	weclawbot-api`

- [ ] **Step 6: 提交**

```bash
rtk git add WeClawBot-API/main.go WeClawBot-API/main_test.go WeClawBot-API/README.md
rtk git commit -m "feat: add wechat inbound callback"
```

### Task 3: 加 SQLite migration，把 schema 升级到多 Bot 绑定模型

**Files:**
- Create: `src/db/migrations/0002_wechat_multi_bot.sql`
- Modify: `src/db/migrate.ts`
- Modify: `src/db/schema.sql`
- Modify: `tests/db/migrate.test.ts`

- [ ] **Step 1: 写 migration 的失败测试**

`tests/db/migrate.test.ts`

```ts
test("执行 0002 migration 后存在 wechat_inbound_events 和新绑定字段", () => {
  runMigrations(testDbPath);
  const db = openDb(testDbPath);

  const inboundTable = db
    .query("select name from sqlite_master where type = 'table' and name = 'wechat_inbound_events'")
    .get() as { name: string } | null;
  const bindingColumns = db
    .query("pragma table_info(user_wechat_bindings)")
    .all() as Array<{ name: string }>;
  const activeIndex = db
    .query("select name from sqlite_master where type = 'index' and name = 'idx_user_wechat_bindings_active_user'")
    .get() as { name: string } | null;

  expect(inboundTable?.name).toBe("wechat_inbound_events");
  expect(bindingColumns.map((column) => column.name)).toContain("bot_id");
  expect(bindingColumns.map((column) => column.name)).toContain("last_keepalive_sent_at");
  expect(activeIndex?.name).toBe("idx_user_wechat_bindings_active_user");
});
```

- [ ] **Step 2: 跑 migration 测试确认失败**

Run:

```bash
rtk bun test tests/db/migrate.test.ts
```

Expected: FAIL，报缺少 `wechat_inbound_events` 或 `bot_id`

- [ ] **Step 3: 实现 `0002` migration 和新 schema**

`src/db/migrations/0002_wechat_multi_bot.sql`

```sql
create table if not exists user_wechat_bindings_v2 (
  id text primary key,
  user_id text not null,
  bot_id text not null,
  bot_wechat_user_id text not null,
  status text not null,
  bound_at text,
  unbound_at text,
  last_inbound_at text,
  last_outbound_at text,
  last_keepalive_sent_at text,
  last_context_token text,
  last_error text,
  created_at text not null,
  updated_at text not null
);

insert into user_wechat_bindings_v2 (
  id,
  user_id,
  bot_id,
  bot_wechat_user_id,
  status,
  bound_at,
  unbound_at,
  last_inbound_at,
  last_outbound_at,
  last_keepalive_sent_at,
  last_context_token,
  last_error,
  created_at,
  updated_at
)
select
  id,
  user_id,
  'legacy',
  coalesce(wechat_user_id, ''),
  case when bind_status = 'bound' then 'active' else 'inactive' end,
  bound_at,
  null,
  bound_at,
  null,
  null,
  null,
  last_error,
  coalesce(bound_at, datetime('now')),
  coalesce(bound_at, datetime('now'))
from user_wechat_bindings;

drop table user_wechat_bindings;
alter table user_wechat_bindings_v2 rename to user_wechat_bindings;

create unique index if not exists idx_user_wechat_bindings_active_user
  on user_wechat_bindings(user_id)
  where status = 'active';

create unique index if not exists idx_user_wechat_bindings_active_conversation
  on user_wechat_bindings(bot_id, bot_wechat_user_id)
  where status = 'active';

create table if not exists wechat_inbound_events (
  id text primary key,
  message_id text not null unique,
  bot_id text not null,
  from_user_id text not null,
  text text not null,
  received_at text not null,
  process_status text not null,
  raw_payload text not null,
  created_at text not null
);
```

`src/db/migrate.ts`

```ts
const defaultMigrations: Migration[] = [
  {
    id: "0001_initial_schema",
    sql: readFileSync(new URL("./schema.sql", import.meta.url), "utf8"),
  },
  {
    id: "0002_wechat_multi_bot",
    sql: readFileSync(new URL("./migrations/0002_wechat_multi_bot.sql", import.meta.url), "utf8"),
  },
];
```

并把 `src/db/schema.sql` 里的 `user_wechat_bindings` 定义直接改成新列，同时追加 `wechat_inbound_events`。

- [ ] **Step 4: 重新跑 migration 测试确认通过**

Run:

```bash
rtk bun test tests/db/migrate.test.ts
```

Expected: PASS，输出 `4 pass` 或更多且无失败

- [ ] **Step 5: 提交**

```bash
rtk git add src/db/migrations/0002_wechat_multi_bot.sql src/db/migrate.ts src/db/schema.sql tests/db/migrate.test.ts
rtk git commit -m "feat: migrate wechat bindings for multi-bot"
```

### Task 4: 实现签名绑定码和用户中心展示

**Files:**
- Create: `src/shared/wechat-bind-code.ts`
- Modify: `src/shared/config.ts`
- Modify: `src/adapters/wechat-bot.ts`
- Modify: `src/server/routes/user-center.ts`
- Modify: `src/server/views/user-center.ts`
- Create: `tests/shared/wechat-bind-code.test.ts`
- Modify: `tests/server/user-center.test.ts`
- Modify: `.env.example`

- [ ] **Step 1: 写绑定码和页面展示的失败测试**

`tests/shared/wechat-bind-code.test.ts`

```ts
import { describe, expect, test } from "bun:test";
import { buildWechatBindCode, parseWechatBindCode } from "../../src/shared/wechat-bind-code";

describe("wechat bind code", () => {
  test("buildWechatBindCode 和 parseWechatBindCode 成对工作", () => {
    const code = buildWechatBindCode("user-1", "secret-1");

    expect(code.startsWith("uid:user-1:")).toBe(true);
    expect(parseWechatBindCode(code, "secret-1")).toEqual({ userId: "user-1" });
    expect(parseWechatBindCode(code, "wrong-secret")).toBeNull();
  });
});
```

在 `tests/server/user-center.test.ts` 追加：

```ts
expect(html).toContain("uid:");
expect(html).toContain(user.id);
```

- [ ] **Step 2: 跑用户中心和绑定码测试确认失败**

Run:

```bash
rtk bun test tests/shared/wechat-bind-code.test.ts tests/server/user-center.test.ts
```

Expected: FAIL，报缺少 `wechat-bind-code.ts` 或页面未输出 `uid:`

- [ ] **Step 3: 实现绑定码工具、配置和展示**

`src/shared/wechat-bind-code.ts`

```ts
import { createHmac, timingSafeEqual } from "node:crypto";

function signatureFor(userId: string, secret: string) {
  return createHmac("sha256", secret).update(userId).digest("hex").slice(0, 16);
}

export function buildWechatBindCode(userId: string, secret: string) {
  return `uid:${userId}:${signatureFor(userId, secret)}`;
}

export function parseWechatBindCode(text: string, secret: string) {
  const [prefix, userId, signature] = text.trim().split(":");
  if (prefix !== "uid" || !userId || !signature) {
    return null;
  }
  const expected = signatureFor(userId, secret);
  if (!timingSafeEqual(Buffer.from(signature), Buffer.from(expected))) {
    return null;
  }
  return { userId };
}
```

`src/shared/config.ts`

```ts
export const config = {
  databasePath: process.env.DATABASE_PATH ?? "./data/app.sqlite",
  bscRpcUrl: process.env.BSC_RPC_URL ?? "https://public-bsc.nownodes.io/",
  collectorLookbackBlocks: Number(process.env.COLLECTOR_LOOKBACK_BLOCKS ?? 200),
  collectorBatchBlocks: Number(process.env.COLLECTOR_BATCH_BLOCKS ?? 50),
  bnbCollectionWallet: "0xaCEa067c6751083e4e652543A436638c1e777777",
  priceUnitWei: "5000000000000000",
  trialDays: 3,
  reminderLeadDays: 1,
  wechatBotApiBaseUrl: process.env.WECHAT_BOT_API_BASE_URL ?? "http://127.0.0.1:26322",
  wechatBotApiToken: process.env.WECHAT_BOT_API_TOKEN ?? "",
  wechatBindSecret: process.env.WECHAT_BIND_SECRET ?? "dev-secret",
  wechatCallbackAllowlist: (process.env.WECHAT_CALLBACK_ALLOWLIST ?? "127.0.0.1,::1").split(","),
  wechatKeepaliveEnabled: process.env.WECHAT_KEEPALIVE_ENABLED !== "false",
};
```

`src/server/routes/user-center.ts`

```ts
import { buildWechatBindCode } from "../../shared/wechat-bind-code";
import { config } from "../../shared/config";
const bindCode = buildWechatBindCode(userId, config.wechatBindSecret);

// 在 renderUserCenter 调用处改成：
bindInstruction: buildBindInstruction(bindCode),
```

`src/adapters/wechat-bot.ts`

```ts
export function buildBindInstruction(bindCode: string) {
  return `请把这串匹配码发给任意已登录微信 Bot：${bindCode}`;
}
```

`.env.example`

```dotenv
WECHAT_BOT_API_BASE_URL=http://127.0.0.1:26322
WECHAT_BOT_API_TOKEN=replace-me
WECHAT_BIND_SECRET=replace-me
WECHAT_CALLBACK_ALLOWLIST=127.0.0.1,::1
WECHAT_KEEPALIVE_ENABLED=true
```

- [ ] **Step 4: 重新跑绑定码和用户中心测试确认通过**

Run:

```bash
rtk bun test tests/shared/wechat-bind-code.test.ts tests/server/user-center.test.ts
```

Expected: PASS，输出 `2 pass`

- [ ] **Step 5: 提交**

```bash
rtk git add src/shared/wechat-bind-code.ts src/shared/config.ts src/adapters/wechat-bot.ts src/server/routes/user-center.ts src/server/views/user-center.ts tests/shared/wechat-bind-code.test.ts tests/server/user-center.test.ts .env.example
rtk git commit -m "feat: add signed wechat bind codes"
```

### Task 5: 重写微信 callback 路径、绑定仓库和幂等事件

**Files:**
- Modify: `src/db/repositories/wechat-bindings.ts`
- Create: `src/db/repositories/wechat-inbound-events.ts`
- Modify: `src/db/repositories/entitlements.ts`
- Modify: `src/db/repositories/notification-jobs.ts`
- Modify: `src/server/routes/wechat.ts`
- Modify: `tests/server/wechat-binding.test.ts`
- Create: `tests/db/wechat-bindings.test.ts`

- [ ] **Step 1: 写仓库和 callback 的失败测试**

`tests/db/wechat-bindings.test.ts`

```ts
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, test } from "bun:test";
import { runMigrations } from "../../src/db/migrate";
import { replaceActiveWechatBinding, findActiveBindingByUserId, listBindingsNeedingKeepalive } from "../../src/db/repositories/wechat-bindings";

function setupDb() {
  const dir = mkdtempSync(join(tmpdir(), "rgclaw-wechat-bindings-"));
  const dbPath = join(dir, "app.sqlite");
  process.env.DATABASE_PATH = dbPath;
  runMigrations(dbPath);
  return {
    cleanup() {
      rmSync(dir, { recursive: true, force: true });
      delete process.env.DATABASE_PATH;
    },
  };
}

describe("wechat bindings repository", () => {
  test("replaceActiveWechatBinding 让用户保持单活绑定", () => {
    const { cleanup } = setupDb();
    try {
      replaceActiveWechatBinding({
        userId: "u1",
        botId: "bot-a",
        botWechatUserId: "wx-a",
        contextToken: "ctx-a",
        now: "2026-03-31T01:00:00.000Z",
      });
      replaceActiveWechatBinding({
        userId: "u1",
        botId: "bot-b",
        botWechatUserId: "wx-b",
        contextToken: "ctx-b",
        now: "2026-03-31T02:00:00.000Z",
      });

      expect(findActiveBindingByUserId("u1")?.bot_id).toBe("bot-b");
    } finally {
      cleanup();
    }
  });
});
```

在 `tests/server/wechat-binding.test.ts` 改成：

```ts
const callbackRes = await app.request("http://localhost/wechat/callback", {
  method: "POST",
  headers: {
    "content-type": "application/json",
    "x-forwarded-for": "127.0.0.1",
  },
  body: JSON.stringify({
    botId: "bot-a",
    fromUserId: "wx-user-1",
    text: bindCode,
    contextToken: "ctx-1",
    messageId: "msg-1",
    receivedAt: "2026-03-31T01:00:00.000Z",
    rawPayload: { text: bindCode },
  }),
});

expect(callbackRes.status).toBe(200);
expect(html).toContain("已绑定");
```

并把 `setupWechatBindingTestApp()` 扩成返回 `dbPath`，再追加两个 case：

```ts
test("重复 messageId 不重复创建自动回复任务", async () => {
  const { app, dbPath, cleanup } = setupWechatBindingTestApp();
  const db = openDb(dbPath);

  try {
    db.exec(`
      insert into users (id, email, password_hash, created_at, updated_at)
      values ('u1', 'u1@example.com', 'x', '2026-03-31T00:00:00.000Z', '2026-03-31T00:00:00.000Z');
      insert into user_wechat_bindings (
        id, user_id, bot_id, bot_wechat_user_id, status, bound_at, last_context_token, created_at, updated_at
      ) values (
        'b1', 'u1', 'bot-a', 'wx-user-1', 'active', '2026-03-31T00:00:00.000Z', 'ctx-1', '2026-03-31T00:00:00.000Z', '2026-03-31T00:00:00.000Z'
      );
    `);

    const payload = {
      botId: "bot-a",
      fromUserId: "wx-user-1",
      text: "hello",
      contextToken: "ctx-1",
      messageId: "msg-dup-1",
      receivedAt: "2026-03-31T01:00:00.000Z",
      rawPayload: { text: "hello" },
    };

    await app.request("http://localhost/wechat/callback", {
      method: "POST",
      headers: { "content-type": "application/json", "x-forwarded-for": "127.0.0.1" },
      body: JSON.stringify(payload),
    });
    await app.request("http://localhost/wechat/callback", {
      method: "POST",
      headers: { "content-type": "application/json", "x-forwarded-for": "127.0.0.1" },
      body: JSON.stringify(payload),
    });

    const row = db.query("select count(*) as count from system_message_jobs where user_id = 'u1' and message_type = 'auto_reply'").get() as { count: number };
    expect(row.count).toBe(1);
  } finally {
    db.close();
    cleanup();
  }
});

test("已绑定用户发普通文本时创建固定自动回复任务", async () => {
  const { app, dbPath, cleanup } = setupWechatBindingTestApp();
  const db = openDb(dbPath);

  try {
    db.exec(`
      insert into users (id, email, password_hash, created_at, updated_at)
      values ('u1', 'u1@example.com', 'x', '2026-03-31T00:00:00.000Z', '2026-03-31T00:00:00.000Z');
      insert into user_wechat_bindings (
        id, user_id, bot_id, bot_wechat_user_id, status, bound_at, last_context_token, created_at, updated_at
      ) values (
        'b1', 'u1', 'bot-a', 'wx-user-1', 'active', '2026-03-31T00:00:00.000Z', 'ctx-1', '2026-03-31T00:00:00.000Z', '2026-03-31T00:00:00.000Z'
      );
    `);

    await app.request("http://localhost/wechat/callback", {
      method: "POST",
      headers: { "content-type": "application/json", "x-forwarded-for": "127.0.0.1" },
      body: JSON.stringify({
        botId: "bot-a",
        fromUserId: "wx-user-1",
        text: "hello",
        contextToken: "ctx-1",
        messageId: "msg-auto-1",
        receivedAt: "2026-03-31T01:00:00.000Z",
        rawPayload: { text: "hello" },
      }),
    });

    const row = db.query("select payload from system_message_jobs where user_id = 'u1' and message_type = 'auto_reply'").get() as { payload: string } | null;
    expect(row?.payload).toBe("查询和狙击功能开发中");
  } finally {
    db.close();
    cleanup();
  }
});
```

- [ ] **Step 2: 跑 callback 和 repository 测试确认失败**

Run:

```bash
rtk bun test tests/db/wechat-bindings.test.ts tests/server/wechat-binding.test.ts
```

Expected: FAIL，报缺少 `replaceActiveWechatBinding`、callback payload 不匹配或老字段仍是 `bindCode`

- [ ] **Step 3: 实现绑定仓库、入站事件仓库和 callback**

`src/db/repositories/wechat-bindings.ts`

```ts
import { openDb } from "../sqlite";

export type ActiveWechatBinding = {
  id: string;
  user_id: string;
  bot_id: string;
  bot_wechat_user_id: string;
  status: string;
  last_context_token: string | null;
  last_inbound_at: string | null;
  last_outbound_at: string | null;
};

export function replaceActiveWechatBinding(input: {
  userId: string;
  botId: string;
  botWechatUserId: string;
  contextToken: string;
  now: string;
}) {
  const db = openDb();
  try {
    db.transaction(() => {
      db.query("update user_wechat_bindings set status = 'inactive', unbound_at = ?, updated_at = ? where status = 'active' and user_id = ?").run(input.now, input.now, input.userId);
      db.query("update user_wechat_bindings set status = 'inactive', unbound_at = ?, updated_at = ? where status = 'active' and bot_id = ? and bot_wechat_user_id = ?").run(input.now, input.now, input.botId, input.botWechatUserId);
      db.query(`insert into user_wechat_bindings (
        id, user_id, bot_id, bot_wechat_user_id, status, bound_at, unbound_at,
        last_inbound_at, last_outbound_at, last_keepalive_sent_at, last_context_token,
        last_error, created_at, updated_at
      ) values (?, ?, ?, ?, 'active', ?, null, ?, null, null, ?, null, ?, ?)`).run(
        crypto.randomUUID(),
        input.userId,
        input.botId,
        input.botWechatUserId,
        input.now,
        input.now,
        input.contextToken,
        input.now,
        input.now,
      );
    })();
  } finally {
    db.close();
  }
}

export function findActiveBindingByUserId(userId: string) {
  const db = openDb();
  try {
    return db.query("select id, user_id, bot_id, bot_wechat_user_id, status, last_context_token, last_inbound_at, last_outbound_at from user_wechat_bindings where user_id = ? and status = 'active'").get(userId) as ActiveWechatBinding | null;
  } finally {
    db.close();
  }
}
```

`src/db/repositories/wechat-inbound-events.ts`

```ts
import { openDb } from "../sqlite";

export function recordInboundEvent(input: {
  messageId: string;
  botId: string;
  fromUserId: string;
  text: string;
  receivedAt: string;
  rawPayload: string;
}) {
  const db = openDb();
  try {
    db.query("insert or ignore into wechat_inbound_events (id, message_id, bot_id, from_user_id, text, received_at, process_status, raw_payload, created_at) values (?, ?, ?, ?, ?, ?, ?, ?, ?)").run(
      crypto.randomUUID(),
      input.messageId,
      input.botId,
      input.fromUserId,
      input.text,
      input.receivedAt,
      "received",
      input.rawPayload,
      new Date().toISOString(),
    );

    const row = db.query("select process_status from wechat_inbound_events where message_id = ?").get(input.messageId) as { process_status: string };
    return row.process_status === "received";
  } finally {
    db.close();
  }
}

export function markInboundEventProcessed(messageId: string, status: string) {
  const db = openDb();
  try {
    db.query("update wechat_inbound_events set process_status = ? where message_id = ?").run(status, messageId);
  } finally {
    db.close();
  }
}
```

`src/server/routes/wechat.ts`

```ts
import { Hono } from "hono";
import { ensureTrialEntitlement } from "../../db/repositories/entitlements";
import { createSystemMessageJob } from "../../db/repositories/notification-jobs";
import { findActiveBindingByConversation, replaceActiveWechatBinding, touchActiveBindingInbound } from "../../db/repositories/wechat-bindings";
import { markInboundEventProcessed, recordInboundEvent } from "../../db/repositories/wechat-inbound-events";
import { buildBindingSuccessMessage, buildGenericWechatAutoReply } from "../../adapters/wechat-bot";
import { config } from "../../shared/config";
import { parseWechatBindCode } from "../../shared/wechat-bind-code";

export function wechatRoutes() {
  const app = new Hono();

  app.post("/wechat/callback", async (c) => {
    const forwardedFor = c.req.header("x-forwarded-for") ?? "";
    if (!config.wechatCallbackAllowlist.some((item) => forwardedFor.includes(item))) {
      return c.text("forbidden", 403);
    }

    const body = await c.req.json();
    const payload = {
      botId: typeof body.botId === "string" ? body.botId.trim() : "",
      fromUserId: typeof body.fromUserId === "string" ? body.fromUserId.trim() : "",
      text: typeof body.text === "string" ? body.text.trim() : "",
      contextToken: typeof body.contextToken === "string" ? body.contextToken.trim() : "",
      messageId: typeof body.messageId === "string" ? body.messageId.trim() : "",
      receivedAt: typeof body.receivedAt === "string" ? body.receivedAt.trim() : new Date().toISOString(),
      rawPayload: JSON.stringify(body.rawPayload ?? body),
    };
    if (!payload.botId || !payload.fromUserId || !payload.messageId) {
      return c.text("invalid payload", 400);
    }

    const inserted = recordInboundEvent(payload);
    if (!inserted) {
      return c.json({ ok: true, duplicate: true });
    }

    touchActiveBindingInbound({
      botId: payload.botId,
      botWechatUserId: payload.fromUserId,
      contextToken: payload.contextToken,
      receivedAt: payload.receivedAt,
    });

    const parsed = parseWechatBindCode(payload.text, config.wechatBindSecret);
    if (parsed) {
      replaceActiveWechatBinding({
        userId: parsed.userId,
        botId: payload.botId,
        botWechatUserId: payload.fromUserId,
        contextToken: payload.contextToken,
        now: payload.receivedAt,
      });
      ensureTrialEntitlement(parsed.userId);
      createSystemMessageJob({
        userId: parsed.userId,
        messageType: "binding_success",
        payload: buildBindingSuccessMessage(),
      });
      markInboundEventProcessed(payload.messageId, "bound");
      return c.json({ ok: true, action: "bound" });
    }

    const binding = findActiveBindingByConversation(payload.botId, payload.fromUserId);
    if (!binding) {
      markInboundEventProcessed(payload.messageId, "unbound_reply");
      return c.json({ ok: true, action: "ignored" });
    }

    createSystemMessageJob({
      userId: binding.user_id,
      messageType: "auto_reply",
      payload: buildGenericWechatAutoReply(),
    });
    markInboundEventProcessed(payload.messageId, "auto_reply");
    return c.json({ ok: true, action: "auto_reply" });
  });

  return app;
}
```

并在同一个文件里继续补上：

```ts
export function findActiveBindingByConversation(botId: string, botWechatUserId: string) {
  const db = openDb();
  try {
    return db.query("select id, user_id, bot_id, bot_wechat_user_id, status, last_context_token, last_inbound_at, last_outbound_at from user_wechat_bindings where bot_id = ? and bot_wechat_user_id = ? and status = 'active'").get(botId, botWechatUserId) as ActiveWechatBinding | null;
  } finally {
    db.close();
  }
}

export function touchActiveBindingInbound(input: {
  botId: string;
  botWechatUserId: string;
  contextToken: string;
  receivedAt: string;
}) {
  const db = openDb();
  try {
    db.query("update user_wechat_bindings set last_inbound_at = ?, last_context_token = ?, updated_at = ? where bot_id = ? and bot_wechat_user_id = ? and status = 'active'").run(
      input.receivedAt,
      input.contextToken,
      input.receivedAt,
      input.botId,
      input.botWechatUserId,
    );
  } finally {
    db.close();
  }
}
```

- [ ] **Step 4: 重新跑 callback 和 repository 测试确认通过**

Run:

```bash
rtk bun test tests/db/wechat-bindings.test.ts tests/server/wechat-binding.test.ts
```

Expected: PASS，绑定、幂等和自动回复断言全部通过

- [ ] **Step 5: 提交**

```bash
rtk git add src/db/repositories/wechat-bindings.ts src/db/repositories/wechat-inbound-events.ts src/db/repositories/entitlements.ts src/db/repositories/notification-jobs.ts src/server/routes/wechat.ts tests/db/wechat-bindings.test.ts tests/server/wechat-binding.test.ts
rtk git commit -m "feat: handle inbound wechat callbacks"
```

### Task 6: 实现真实微信 adapter、未绑定即时回复和系统消息下发

**Files:**
- Modify: `src/adapters/wechat-bot.ts`
- Modify: `src/db/repositories/notification-jobs.ts`
- Modify: `src/db/repositories/wechat-bindings.ts`
- Modify: `src/server/routes/wechat.ts`
- Modify: `src/workers/push-worker.ts`
- Modify: `tests/server/wechat-binding.test.ts`
- Modify: `tests/workers/push-worker.test.ts`

- [ ] **Step 1: 写 adapter、未绑定即时回复和系统消息下发的失败测试**

在 `tests/server/wechat-binding.test.ts` 追加：

```ts
test("未绑定用户发普通文本时即时返回绑定引导", async () => {
  const { app, cleanup } = setupWechatBindingTestApp();

  try {
    const response = await app.request("http://localhost/wechat/callback", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-forwarded-for": "127.0.0.1",
      },
      body: JSON.stringify({
        botId: "bot-a",
        fromUserId: "wx-user-unbound",
        text: "hello",
        contextToken: "ctx-unbound",
        messageId: "msg-unbound-1",
        receivedAt: "2026-03-31T01:00:00.000Z",
        rawPayload: { text: "hello" },
      }),
    });

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true, action: "unbound_reply" });
  } finally {
    cleanup();
  }
});
```

在 `tests/workers/push-worker.test.ts` 追加：

```ts
test("发送成功后把 system_message_jobs 标记为 sent 并刷新 last_outbound_at", async () => {
  const { dbPath, cleanup } = setupPushWorkerTestDb();
  const db = openDb(dbPath);

  try {
    db.exec(`
      insert into users (id, email, password_hash, created_at, updated_at)
      values ('u1', 'u1@example.com', 'x', '2026-03-31T00:00:00.000Z', '2026-03-31T00:00:00.000Z');
      insert into user_wechat_bindings (
        id, user_id, bot_id, bot_wechat_user_id, status, bound_at, last_context_token, created_at, updated_at
      ) values (
        'b1', 'u1', 'bot-a', 'wx-1', 'active', '2026-03-31T00:00:00.000Z', 'ctx-1', '2026-03-31T00:00:00.000Z', '2026-03-31T00:00:00.000Z'
      );
      insert into system_message_jobs (
        id, user_id, message_type, payload, status, attempt_count, created_at
      ) values (
        'm1', 'u1', 'auto_reply', '查询和狙击功能开发中', 'pending', 0, '2026-03-31T00:00:00.000Z'
      );
    `);

    const sent = await dispatchPendingSystemMessages({
      sendMessage: async (input) => {
        expect(input.botId).toBe("bot-a");
        expect(input.toUserId).toBe("wx-1");
        expect(input.contextToken).toBe("ctx-1");
        return { ok: true };
      },
    });

    const row = db.query("select status, sent_at from system_message_jobs where id = 'm1'").get() as { status: string; sent_at: string | null };
    expect(sent).toBe(1);
    expect(row.status).toBe("sent");
    expect(row.sent_at).toBeTruthy();
  } finally {
    db.close();
    cleanup();
  }
});
```

- [ ] **Step 2: 跑服务端和 worker 测试确认失败**

Run:

```bash
rtk bun test tests/server/wechat-binding.test.ts tests/workers/push-worker.test.ts
```

Expected: FAIL，报缺少 `dispatchPendingSystemMessages`、callback 没有返回 `unbound_reply` 或任务字段未更新

- [ ] **Step 3: 实现 adapter、系统消息仓库和即时未绑定回复**

`src/adapters/wechat-bot.ts`

```ts
import { config } from "../shared/config";

export function buildBindingSuccessMessage() {
  return "绑定成功，后续通知会通过这个微信发送。";
}

export function buildGenericWechatAutoReply() {
  return "查询和狙击功能开发中";
}

export function buildUnboundWechatReply() {
  return "请先发送绑定码完成绑定";
}

export function buildKeepaliveReminder() {
  return "为保持通知能力，请回复任意消息。";
}

export async function sendWechatMessage(input: {
  botId: string;
  toUserId: string;
  contextToken: string;
  content: string;
}) {
  const res = await fetch(`${config.wechatBotApiBaseUrl}/bots/${input.botId}/messages`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      Authorization: `Bearer ${config.wechatBotApiToken}`,
    },
    body: JSON.stringify({
      text: input.content,
      toUserId: input.toUserId,
      contextToken: input.contextToken,
    }),
  });

  if (!res.ok) {
    return { ok: false as const, error: await res.text() };
  }

  return { ok: true as const };
}
```

`src/db/repositories/notification-jobs.ts`

```ts
export function listPendingSystemMessageJobs(limit = 50) {
  const db = openDb();
  try {
    return db.query(`
      select id, user_id, message_type, payload, status, attempt_count
      from system_message_jobs
      where status = 'pending'
      order by created_at asc
      limit ?
    `).all(limit) as Array<{
      id: string;
      user_id: string;
      message_type: string;
      payload: string;
      status: string;
      attempt_count: number;
    }>;
  } finally {
    db.close();
  }
}

export function markSystemMessageJobSent(id: string, sentAt: string) {
  const db = openDb();
  try {
    db.query("update system_message_jobs set status = 'sent', sent_at = ?, attempt_count = attempt_count + 1 where id = ?").run(sentAt, id);
  } finally {
    db.close();
  }
}

export function markSystemMessageJobRetried(id: string, error: string, failed: boolean) {
  const db = openDb();
  try {
    db.query("update system_message_jobs set status = ?, attempt_count = attempt_count + 1, last_error = ? where id = ?").run(failed ? "failed" : "pending", error, id);
  } finally {
    db.close();
  }
}
```

`src/db/repositories/wechat-bindings.ts`

```ts
export function markBindingOutboundSent(bindingId: string, sentAt: string, keepalive: boolean) {
  const db = openDb();
  try {
    db.query(`
      update user_wechat_bindings
      set last_outbound_at = ?, last_keepalive_sent_at = case when ? then ? else last_keepalive_sent_at end, updated_at = ?
      where id = ?
    `).run(sentAt, keepalive ? 1 : 0, sentAt, sentAt, bindingId);
  } finally {
    db.close();
  }
}
```

`src/workers/push-worker.ts`

```ts
import { sendWechatMessage } from "../adapters/wechat-bot";
import { findActiveBindingByUserId, markBindingOutboundSent } from "../db/repositories/wechat-bindings";
import { listPendingSystemMessageJobs, markSystemMessageJobRetried, markSystemMessageJobSent } from "../db/repositories/notification-jobs";

export async function dispatchPendingSystemMessages(options: {
  sendMessage?: typeof sendWechatMessage;
} = {}) {
  const sendMessage = options.sendMessage ?? sendWechatMessage;
  const jobs = listPendingSystemMessageJobs();
  let sent = 0;

  for (const job of jobs) {
    const binding = findActiveBindingByUserId(job.user_id);
    if (!binding || !binding.last_context_token) {
      markSystemMessageJobRetried(job.id, "binding missing", true);
      continue;
    }

    const result = await sendMessage({
      botId: binding.bot_id,
      toUserId: binding.bot_wechat_user_id,
      contextToken: binding.last_context_token,
      content: job.payload,
    });
    if (!result.ok) {
      markSystemMessageJobRetried(job.id, result.error, job.attempt_count + 1 >= 3);
      continue;
    }

    const sentAt = new Date().toISOString();
    markSystemMessageJobSent(job.id, sentAt);
    markBindingOutboundSent(binding.id, sentAt, job.message_type === "keepalive");
    sent += 1;
  }

  return sent;
}
```

`src/server/routes/wechat.ts`

```ts
import { buildUnboundWechatReply, sendWechatMessage } from "../../adapters/wechat-bot";

const binding = findActiveBindingByConversation(payload.botId, payload.fromUserId);
if (!binding) {
  if (payload.contextToken) {
    await sendWechatMessage({
      botId: payload.botId,
      toUserId: payload.fromUserId,
      contextToken: payload.contextToken,
      content: buildUnboundWechatReply(),
    });
  }
  markInboundEventProcessed(payload.messageId, "unbound_reply");
  return c.json({ ok: true, action: "unbound_reply" });
}
```

- [ ] **Step 4: 重新跑服务端和 worker 测试确认通过**

Run:

```bash
rtk bun test tests/server/wechat-binding.test.ts tests/workers/push-worker.test.ts
```

Expected: PASS，未绑定即时回复和系统消息下发都通过

- [ ] **Step 5: 提交**

```bash
rtk git add src/adapters/wechat-bot.ts src/db/repositories/notification-jobs.ts src/db/repositories/wechat-bindings.ts src/server/routes/wechat.ts src/workers/push-worker.ts tests/server/wechat-binding.test.ts tests/workers/push-worker.test.ts
rtk git commit -m "feat: send system wechat messages"
```

### Task 7: 实现通知消息下发、保活扫描和 worker 汇总

**Files:**
- Modify: `src/db/repositories/wechat-bindings.ts`
- Modify: `src/db/repositories/notification-jobs.ts`
- Modify: `src/workers/push-worker.ts`
- Modify: `src/workers/run.ts`
- Modify: `tests/workers/push-worker.test.ts`
- Modify: `tests/workers/run.test.ts`

- [ ] **Step 1: 写保活和 worker 汇总的失败测试**

在 `tests/workers/push-worker.test.ts` 再追加：

```ts
test("发送成功后把 notification_jobs 标记为 sent", async () => {
  const { dbPath, cleanup } = setupPushWorkerTestDb();
  const db = openDb(dbPath);

  try {
    db.exec(`
      insert into users (id, email, password_hash, created_at, updated_at)
      values ('u1', 'u1@example.com', 'x', '2026-03-31T00:00:00.000Z', '2026-03-31T00:00:00.000Z');
      insert into user_wechat_bindings (
        id, user_id, bot_id, bot_wechat_user_id, status, bound_at, last_context_token, created_at, updated_at
      ) values (
        'b1', 'u1', 'bot-a', 'wx-1', 'active', '2026-03-31T00:00:00.000Z', 'ctx-1', '2026-03-31T00:00:00.000Z', '2026-03-31T00:00:00.000Z'
      );
      insert into launch_events (id, source, source_event_id, token_address, symbol, title, event_time, chain, raw_payload, dedupe_key, created_at)
      values ('evt1', 'flap', 'source-1', '0xabc', 'DOG', 'DOG 发射', '2026-03-31T00:00:00.000Z', 'bsc', '{}', 'flap:1', '2026-03-31T00:00:00.000Z');
      insert into notification_jobs (id, launch_event_id, user_id, channel, status, attempt_count, created_at)
      values ('n1', 'evt1', 'u1', 'wechat', 'pending', 0, '2026-03-31T00:00:00.000Z');
    `);

    const sent = await dispatchPendingNotificationMessages({
      sendMessage: async (input) => {
        expect(input.content).toContain("DOG 发射");
        return { ok: true };
      },
    });

    const row = db.query("select status, sent_at from notification_jobs where id = 'n1'").get() as { status: string; sent_at: string | null };
    expect(sent).toBe(1);
    expect(row.status).toBe("sent");
    expect(row.sent_at).toBeTruthy();
  } finally {
    db.close();
    cleanup();
  }
});

test("18 到 19 小时窗口内创建一次 keepalive 任务", async () => {
  const { dbPath, cleanup } = setupPushWorkerTestDb();
  const db = openDb(dbPath);

  try {
    db.exec(`
      insert into users (id, email, password_hash, created_at, updated_at)
      values ('u1', 'u1@example.com', 'x', '2026-03-31T00:00:00.000Z', '2026-03-31T00:00:00.000Z');
      insert into user_wechat_bindings (
        id, user_id, bot_id, bot_wechat_user_id, status, bound_at, last_outbound_at, created_at, updated_at
      ) values (
        'b1', 'u1', 'bot-a', 'wx-1', 'active', '2026-03-31T00:00:00.000Z', datetime('now', '-18 hours', '-30 minutes'), '2026-03-31T00:00:00.000Z', '2026-03-31T00:00:00.000Z'
      );
      insert into user_source_subscriptions (id, user_id, source, enabled, created_at, updated_at)
      values ('s1', 'u1', 'flap', 1, '2026-03-31T00:00:00.000Z', '2026-03-31T00:00:00.000Z');
      insert into user_entitlements (id, user_id, plan_type, status, starts_at, expires_at, source, created_at, updated_at)
      values ('e1', 'u1', 'trial', 'active', '2026-03-31T00:00:00.000Z', '2099-03-31T00:00:00.000Z', 'trial_signup', '2026-03-31T00:00:00.000Z', '2026-03-31T00:00:00.000Z');
    `);

    const count = await enqueueKeepaliveReminders();
    const row = db.query("select message_type, payload from system_message_jobs where user_id = 'u1'").get() as { message_type: string; payload: string };

    expect(count).toBe(1);
    expect(row.message_type).toBe("keepalive");
    expect(row.payload).toContain("请回复任意消息");
  } finally {
    db.close();
    cleanup();
  }
});
```

在 `tests/workers/run.test.ts` 改成：

```ts
expect(result.keepalives).toBe(1);
expect(result.sentNotifications).toBeGreaterThanOrEqual(0);
expect(result.sentSystemMessages).toBeGreaterThanOrEqual(0);
```

- [ ] **Step 2: 跑 worker 测试确认失败**

Run:

```bash
rtk bun test tests/workers/push-worker.test.ts tests/workers/run.test.ts
```

Expected: FAIL，报缺少 `dispatchPendingNotificationMessages`、`enqueueKeepaliveReminders` 或 `result.keepalives`

- [ ] **Step 3: 实现通知下发、保活扫描和 run 汇总**

`src/db/repositories/wechat-bindings.ts`

```ts
export function listBindingsNeedingKeepalive(limit = 50) {
  const db = openDb();
  try {
    return db.query(`
      select uwb.id, uwb.user_id
      from user_wechat_bindings uwb
      join user_entitlements ue on ue.user_id = uwb.user_id and ue.status = 'active' and datetime(ue.expires_at) > datetime('now')
      join user_source_subscriptions uss on uss.user_id = uwb.user_id and uss.enabled = 1
      where uwb.status = 'active'
        and uwb.last_outbound_at is not null
        and datetime(uwb.last_outbound_at) <= datetime('now', '-18 hours')
        and datetime(uwb.last_outbound_at) > datetime('now', '-19 hours')
        and (uwb.last_keepalive_sent_at is null or datetime(uwb.last_keepalive_sent_at) <= datetime('now', '-1 hour'))
      limit ?
    `).all(limit) as Array<{ id: string; user_id: string }>;
  } finally {
    db.close();
  }
}

export function markBindingOutboundSent(bindingId: string, sentAt: string, keepalive: boolean) {
  const db = openDb();
  try {
    db.query(`
      update user_wechat_bindings
      set last_outbound_at = ?, last_keepalive_sent_at = case when ? then ? else last_keepalive_sent_at end, updated_at = ?
      where id = ?
    `).run(sentAt, keepalive ? 1 : 0, sentAt, sentAt, bindingId);
  } finally {
    db.close();
  }
}
```

`src/workers/push-worker.ts`

```ts
import { buildKeepaliveReminder, buildLaunchMessage, sendWechatMessage } from "../adapters/wechat-bot";
import { findActiveBindingByUserId, listBindingsNeedingKeepalive, markBindingOutboundSent } from "../db/repositories/wechat-bindings";
import {
  listPendingNotificationJobs,
  listPendingSystemMessageJobs,
  markNotificationJobRetried,
  markNotificationJobSent,
  markSystemMessageJobRetried,
  markSystemMessageJobSent,
  createSystemMessageJob,
} from "../db/repositories/notification-jobs";
import { openDb } from "../db/sqlite";

export async function enqueueKeepaliveReminders() {
  const rows = listBindingsNeedingKeepalive();
  for (const row of rows) {
    createSystemMessageJob({
      userId: row.user_id,
      messageType: "keepalive",
      payload: buildKeepaliveReminder(),
    });
  }
  return rows.length;
}

export async function dispatchPendingSystemMessages(options: {
  sendMessage?: typeof sendWechatMessage;
} = {}) {
  const sendMessage = options.sendMessage ?? sendWechatMessage;
  const jobs = listPendingSystemMessageJobs();
  let sent = 0;

  for (const job of jobs) {
    const binding = findActiveBindingByUserId(job.user_id);
    if (!binding || !binding.last_context_token) {
      markSystemMessageJobRetried(job.id, "binding missing", true);
      continue;
    }

    const result = await sendMessage({
      botId: binding.bot_id,
      toUserId: binding.bot_wechat_user_id,
      contextToken: binding.last_context_token,
      content: job.payload,
    });
    if (!result.ok) {
      markSystemMessageJobRetried(job.id, result.error, job.attempt_count + 1 >= 3);
      continue;
    }

    const sentAt = new Date().toISOString();
    markSystemMessageJobSent(job.id, sentAt);
    markBindingOutboundSent(binding.id, sentAt, job.message_type === "keepalive");
    sent += 1;
  }

  return sent;
}

export async function dispatchPendingNotificationMessages(options: {
  sendMessage?: typeof sendWechatMessage;
} = {}) {
  const sendMessage = options.sendMessage ?? sendWechatMessage;
  const jobs = listPendingNotificationJobs();
  let sent = 0;

  for (const job of jobs) {
    const binding = findActiveBindingByUserId(job.user_id);
    if (!binding || !binding.last_context_token) {
      markNotificationJobRetried(job.id, "binding missing", true);
      continue;
    }

    const db = openDb();
    const launch = db.query("select title, token_address from launch_events where id = ?").get(job.launch_event_id) as { title: string; token_address: string } | null;
    db.close();
    if (!launch) {
      markNotificationJobRetried(job.id, "launch event missing", true);
      continue;
    }

    const result = await sendMessage({
      botId: binding.bot_id,
      toUserId: binding.bot_wechat_user_id,
      contextToken: binding.last_context_token,
      content: buildLaunchMessage(launch.title, launch.token_address),
    });
    if (!result.ok) {
      markNotificationJobRetried(job.id, result.error, job.attempt_count + 1 >= 3);
      continue;
    }

    const sentAt = new Date().toISOString();
    markNotificationJobSent(job.id, sentAt);
    markBindingOutboundSent(binding.id, sentAt, false);
    sent += 1;
  }

  return sent;
}
```

`src/db/repositories/notification-jobs.ts`

```ts
export function listPendingNotificationJobs(limit = 50) {
  const db = openDb();
  try {
    return db.query(`
      select id, launch_event_id, user_id, channel, status, attempt_count
      from notification_jobs
      where status = 'pending'
      order by created_at asc
      limit ?
    `).all(limit) as Array<{
      id: string;
      launch_event_id: string;
      user_id: string;
      channel: string;
      status: string;
      attempt_count: number;
    }>;
  } finally {
    db.close();
  }
}

export function markNotificationJobSent(id: string, sentAt: string) {
  const db = openDb();
  try {
    db.query("update notification_jobs set status = 'sent', sent_at = ?, attempt_count = attempt_count + 1 where id = ?").run(sentAt, id);
  } finally {
    db.close();
  }
}

export function markNotificationJobRetried(id: string, error: string, failed: boolean) {
  const db = openDb();
  try {
    db.query("update notification_jobs set status = ?, attempt_count = attempt_count + 1, last_error = ? where id = ?").run(failed ? "failed" : "pending", error, id);
  } finally {
    db.close();
  }
}
```

`src/workers/run.ts`

```ts
export async function runWorkersOnce() {
  const notifications = await processLaunchPushes();
  const reminders = await processRenewalReminders();
  const keepalives = await enqueueKeepaliveReminders();
  const sentNotifications = await dispatchPendingNotificationMessages();
  const sentSystemMessages = await dispatchPendingSystemMessages();

  return {
    notifications,
    reminders,
    keepalives,
    sentNotifications,
    sentSystemMessages,
  };
}
```

- [ ] **Step 4: 重新跑 worker 测试确认通过**

Run:

```bash
rtk bun test tests/workers/push-worker.test.ts tests/workers/run.test.ts tests/workers/run-loop.test.ts
```

Expected: PASS，launch 通知、keepalive、run entry、run loop 全部通过

- [ ] **Step 5: 提交**

```bash
rtk git add src/db/repositories/wechat-bindings.ts src/db/repositories/notification-jobs.ts src/workers/push-worker.ts src/workers/run.ts tests/workers/push-worker.test.ts tests/workers/run.test.ts
rtk git commit -m "feat: dispatch wechat notifications and keepalives"
```

### Task 8: 做最终回归验证

**Files:**
- Test/Verify only

- [ ] **Step 1: 跑 `WeClawBot-API` 全量测试**

Run:

```bash
rtk proxy "cd WeClawBot-API && go test ./..."
```

Expected: PASS，输出 `ok  	weclawbot-api`

- [ ] **Step 2: 跑 `rgclaw` 全量 Bun 测试**

Run:

```bash
rtk bun test
```

Expected: PASS，所有 `bun:test` 用例通过

- [ ] **Step 3: 查看工作区确认只有本阶段改动**

Run:

```bash
rtk git status --short
```

Expected: 只包含本计划涉及的 `WeClawBot-API`、`src/`、`tests/`、`.env.example` 文件改动

- [ ] **Step 4: 提交最终集成改动**

```bash
rtk git add WeClawBot-API/main.go WeClawBot-API/main_test.go WeClawBot-API/README.md .env.example src tests
rtk git commit -m "feat: add wechat multi-bot binding pipeline"
```

- [ ] **Step 5: 记录验证结果到执行备注**

```bash
rtk git log --oneline -5
```
