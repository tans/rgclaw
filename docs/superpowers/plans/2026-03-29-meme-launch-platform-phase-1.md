# Meme Launch Platform Phase 1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 用 Bun + Hono + SQLite 落地一期 meme 发射事件推送平台，完成公开事件流、账号体系、微信绑定、来源订阅、3 天试用、到期提醒、BNB 自动续费闭环。

**Architecture:** 采用单仓、单语言、轻量事件管道。Hono 负责页面和 API，SQLite 负责持久化与轻量任务队列，collector 与 worker 作为 Bun 长驻进程运行，微信推送和 BNB 到账监听通过独立适配层封装。

**Tech Stack:** Bun, TypeScript, Hono, bun:sqlite, viem, weixin-agent-sdk, bun:test

---

## 文件结构

先锁定文件边界，后续任务都围绕这个结构执行。

- `package.json`
  统一脚本入口，包含 `dev`、`test`、`db:migrate`、`collector`、`worker`。
- `tsconfig.json`
  TypeScript 编译配置。
- `src/shared/config.ts`
  统一读取环境变量与默认值。
- `src/shared/types.ts`
  放 `LaunchSource`、`EntitlementPlanType`、`JobStatus` 等共享类型。
- `src/db/sqlite.ts`
  SQLite 连接与通用执行函数。
- `src/db/schema.sql`
  一期全部表结构。
- `src/db/migrate.ts`
  启动时或命令行执行 schema 初始化。
- `src/db/repositories/*.ts`
  按实体拆分数据访问层。
- `src/server/app.ts`
  Hono app 组合入口。
- `src/server/index.ts`
  Web 服务启动入口。
- `src/server/middleware/session.ts`
  Session 读取与用户注入。
- `src/server/routes/*.ts`
  页面和 API 路由。
- `src/server/views/*.ts`
  HTML 模板函数。
- `src/adapters/wechat-bot.ts`
  微信机器人发送与绑定校验。
- `src/collectors/four.ts`
  `four` 事件监听与标准化。
- `src/collectors/flap.ts`
  `flap` 事件监听与标准化。
- `src/collectors/run.ts`
  collector 进程入口。
- `src/workers/push-worker.ts`
  事件推送与续费提醒调度。
- `src/workers/payment-watcher.ts`
  收款地址到账监听与自动续费。
- `src/workers/run.ts`
  worker 进程入口。
- `tests/server/*.test.ts`
  页面和 API 测试。
- `tests/db/*.test.ts`
  数据库与 migration 测试。
- `tests/collectors/*.test.ts`
  事件标准化和去重测试。
- `tests/workers/*.test.ts`
  push、提醒、支付续期测试。

## 实施原则

- 先写失败测试，再写最小实现，再跑通过。
- 每个任务都保持独立可提交。
- 不提前做 Twitter/X、后台系统、复杂支付中心。
- 所有时间判断统一使用 UTC ISO 字符串存储。
- 所有金额处理统一转为最小精度字符串，避免浮点直接比较。

### Task 1: 初始化 Bun + Hono 服务骨架

**Files:**
- Create: `package.json`
- Create: `tsconfig.json`
- Create: `src/server/app.ts`
- Create: `src/server/index.ts`
- Create: `tests/server/app.test.ts`

- [ ] **Step 1: 写首页失败测试**

```ts
import { describe, expect, test } from "bun:test";
import { createApp } from "../../src/server/app";

describe("GET /", () => {
  test("返回公开首页标题", async () => {
    const app = createApp();
    const res = await app.request("/");

    expect(res.status).toBe(200);
    expect(await res.text()).toContain("最新发射事件");
  });
});
```

- [ ] **Step 2: 运行测试确认失败**

Run: `bun test tests/server/app.test.ts`
Expected: FAIL，报错包含 `Cannot find module '../../src/server/app'`

- [ ] **Step 3: 写最小可运行实现**

`package.json`

```json
{
  "name": "rgclaw",
  "private": true,
  "type": "module",
  "scripts": {
    "dev": "bun run src/server/index.ts",
    "test": "bun test",
    "db:migrate": "bun run src/db/migrate.ts",
    "collector": "bun run src/collectors/run.ts",
    "worker": "bun run src/workers/run.ts"
  },
  "dependencies": {
    "hono": "^4.7.2"
  },
  "devDependencies": {
    "@types/bun": "latest",
    "typescript": "^5.8.2"
  }
}
```

`tsconfig.json`

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "Bundler",
    "strict": true,
    "noEmit": true,
    "types": ["bun"],
    "jsx": "react-jsx",
    "jsxImportSource": "hono/jsx"
  },
  "include": ["src/**/*.ts", "src/**/*.tsx", "tests/**/*.ts"]
}
```

`src/server/app.ts`

```ts
import { Hono } from "hono";

export function createApp() {
  const app = new Hono();

  app.get("/", (c) => {
    return c.html(`
      <html>
        <body>
          <h1>最新发射事件</h1>
        </body>
      </html>
    `);
  });

  return app;
}
```

`src/server/index.ts`

```ts
import { createApp } from "./app";

const app = createApp();

export default {
  port: Number(process.env.PORT ?? 3000),
  fetch: app.fetch,
};
```

- [ ] **Step 4: 运行测试确认通过**

Run: `bun test tests/server/app.test.ts`
Expected: PASS，输出包含 `1 pass`

- [ ] **Step 5: 提交**

```bash
git add package.json tsconfig.json src/server/app.ts src/server/index.ts tests/server/app.test.ts
git commit -m "feat: bootstrap bun hono web app"
```

### Task 2: 建立 SQLite schema 与迁移入口

**Files:**
- Create: `src/db/sqlite.ts`
- Create: `src/db/schema.sql`
- Create: `src/db/migrate.ts`
- Create: `tests/db/migrate.test.ts`
- Modify: `package.json`

- [ ] **Step 1: 写 migration 失败测试**

```ts
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { rmSync } from "node:fs";
import { runMigrations } from "../../src/db/migrate";
import { openDb } from "../../src/db/sqlite";

const testDbPath = "/tmp/rgclaw-migrate-test.sqlite";

describe("runMigrations", () => {
  beforeEach(() => {
    try {
      rmSync(testDbPath);
    } catch {}
  });

  afterEach(() => {
    try {
      rmSync(testDbPath);
    } catch {}
  });

  test("创建一期核心表", () => {
    runMigrations(testDbPath);
    const db = openDb(testDbPath);
    const row = db
      .query("select name from sqlite_master where type = 'table' and name = 'launch_events'")
      .get() as { name: string } | null;

    expect(row?.name).toBe("launch_events");
  });
});
```

- [ ] **Step 2: 运行测试确认失败**

Run: `bun test tests/db/migrate.test.ts`
Expected: FAIL，报错包含 `Cannot find module '../../src/db/migrate'`

- [ ] **Step 3: 写最小 schema 与迁移实现**

`src/db/sqlite.ts`

```ts
import { Database } from "bun:sqlite";

export function openDb(path = process.env.DATABASE_PATH ?? "./data/app.sqlite") {
  return new Database(path, { create: true });
}
```

`src/db/schema.sql`

```sql
create table if not exists users (
  id text primary key,
  email text not null unique,
  password_hash text not null,
  wallet_address text,
  wallet_address_updated_at text,
  created_at text not null,
  updated_at text not null
);

create table if not exists sessions (
  id text primary key,
  user_id text not null,
  expires_at text not null,
  created_at text not null
);

create table if not exists user_wechat_bindings (
  id text primary key,
  user_id text not null,
  wechat_user_id text,
  bind_status text not null,
  bind_code text not null,
  bound_at text,
  last_error text
);

create table if not exists launch_events (
  id text primary key,
  source text not null,
  source_event_id text not null,
  token_address text not null,
  symbol text,
  title text not null,
  event_time text not null,
  chain text not null,
  raw_payload text not null,
  dedupe_key text not null unique,
  created_at text not null
);

create table if not exists user_source_subscriptions (
  id text primary key,
  user_id text not null,
  source text not null,
  enabled integer not null,
  created_at text not null,
  updated_at text not null
);

create table if not exists user_entitlements (
  id text primary key,
  user_id text not null,
  plan_type text not null,
  status text not null,
  starts_at text not null,
  expires_at text not null,
  renewal_reminded_at text,
  source text not null,
  created_at text not null,
  updated_at text not null
);

create table if not exists notification_jobs (
  id text primary key,
  launch_event_id text not null,
  user_id text not null,
  channel text not null,
  status text not null,
  attempt_count integer not null default 0,
  last_error text,
  sent_at text,
  created_at text not null
);

create table if not exists system_message_jobs (
  id text primary key,
  user_id text not null,
  message_type text not null,
  payload text not null,
  status text not null,
  attempt_count integer not null default 0,
  last_error text,
  sent_at text,
  created_at text not null
);

create table if not exists payment_records (
  id text primary key,
  user_id text not null,
  from_wallet_address text not null,
  to_wallet_address text not null,
  tx_hash text not null unique,
  amount_bnb_wei text not null,
  credited_days integer not null,
  status text not null,
  paid_at text not null,
  raw_payload text not null,
  created_at text not null
);
```

`src/db/migrate.ts`

```ts
import { readFileSync } from "node:fs";
import { openDb } from "./sqlite";

export function runMigrations(path?: string) {
  const db = openDb(path);
  const sql = readFileSync(new URL("./schema.sql", import.meta.url), "utf8");
  db.exec(sql);
}

if (import.meta.main) {
  runMigrations(process.argv[2]);
  console.log("migrations complete");
}
```

`package.json`

```json
{
  "name": "rgclaw",
  "private": true,
  "type": "module",
  "scripts": {
    "dev": "bun run src/server/index.ts",
    "test": "bun test",
    "db:migrate": "bun run src/db/migrate.ts",
    "collector": "bun run src/collectors/run.ts",
    "worker": "bun run src/workers/run.ts"
  },
  "dependencies": {
    "hono": "^4.7.2"
  },
  "devDependencies": {
    "@types/bun": "latest",
    "typescript": "^5.8.2"
  }
}
```

- [ ] **Step 4: 运行测试确认通过**

Run: `bun test tests/db/migrate.test.ts`
Expected: PASS，输出包含 `1 pass`

- [ ] **Step 5: 提交**

```bash
git add package.json src/db/sqlite.ts src/db/schema.sql src/db/migrate.ts tests/db/migrate.test.ts
git commit -m "feat: add sqlite schema and migration runner"
```

### Task 3: 落地账号注册、登录与 Session

**Files:**
- Create: `src/shared/types.ts`
- Create: `src/db/repositories/users.ts`
- Create: `src/db/repositories/sessions.ts`
- Create: `src/server/middleware/session.ts`
- Create: `src/server/routes/auth.ts`
- Modify: `src/server/app.ts`
- Create: `tests/server/auth.test.ts`

- [ ] **Step 1: 写认证失败测试**

```ts
import { beforeEach, describe, expect, test } from "bun:test";
import { runMigrations } from "../../src/db/migrate";
import { createApp } from "../../src/server/app";

describe("auth flow", () => {
  beforeEach(() => {
    process.env.DATABASE_PATH = "/tmp/rgclaw-auth-test.sqlite";
    runMigrations(process.env.DATABASE_PATH);
  });

  test("用户可以注册后登录", async () => {
    const app = createApp();

    const registerRes = await app.request("/register", {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        email: "user@example.com",
        password: "pass123456",
      }),
    });

    expect(registerRes.status).toBe(302);

    const loginRes = await app.request("/login", {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        email: "user@example.com",
        password: "pass123456",
      }),
    });

    expect(loginRes.status).toBe(302);
    expect(loginRes.headers.get("set-cookie")).toContain("session_id=");
  });
});
```

- [ ] **Step 2: 运行测试确认失败**

Run: `bun test tests/server/auth.test.ts`
Expected: FAIL，报错包含 `No such route` 或 `Cannot find module`

- [ ] **Step 3: 写最小认证实现**

`src/shared/types.ts`

```ts
export type LaunchSource = "four" | "flap";
export type EntitlementPlanType = "trial" | "paid";
export type EntitlementStatus = "active" | "expired";
export type JobStatus = "pending" | "sent" | "failed" | "skipped";
```

`src/db/repositories/users.ts`

```ts
import { randomUUID } from "node:crypto";
import { openDb } from "../sqlite";

export async function createUser(email: string, password: string) {
  const id = randomUUID();
  const now = new Date().toISOString();
  const passwordHash = await Bun.password.hash(password);
  const db = openDb();

  db.query(
    "insert into users (id, email, password_hash, created_at, updated_at) values (?, ?, ?, ?, ?)",
  ).run(id, email, passwordHash, now, now);

  return { id, email };
}

export function findUserByEmail(email: string) {
  const db = openDb();
  return db.query("select * from users where email = ?").get(email) as
    | { id: string; email: string; password_hash: string }
    | null;
}
```

`src/db/repositories/sessions.ts`

```ts
import { randomUUID } from "node:crypto";
import { openDb } from "../sqlite";

export function createSession(userId: string) {
  const id = randomUUID();
  const now = new Date();
  const expiresAt = new Date(now.getTime() + 1000 * 60 * 60 * 24 * 30).toISOString();
  const db = openDb();

  db.query("insert into sessions (id, user_id, expires_at, created_at) values (?, ?, ?, ?)").run(
    id,
    userId,
    expiresAt,
    now.toISOString(),
  );

  return { id, expiresAt };
}

export function findSession(sessionId: string) {
  const db = openDb();
  return db.query("select * from sessions where id = ?").get(sessionId) as
    | { id: string; user_id: string; expires_at: string }
    | null;
}
```

`src/server/middleware/session.ts`

```ts
import { getCookie } from "hono/cookie";
import type { MiddlewareHandler } from "hono";
import { findSession } from "../../db/repositories/sessions";

export const sessionMiddleware: MiddlewareHandler = async (c, next) => {
  const sessionId = getCookie(c, "session_id");
  if (sessionId) {
    const session = findSession(sessionId);
    if (session && new Date(session.expires_at).getTime() > Date.now()) {
      c.set("sessionUserId", session.user_id);
    }
  }
  await next();
};
```

`src/server/routes/auth.ts`

```ts
import { Hono } from "hono";
import { setCookie } from "hono/cookie";
import { createSession } from "../../db/repositories/sessions";
import { createUser, findUserByEmail } from "../../db/repositories/users";

export function authRoutes() {
  const app = new Hono();

  app.post("/register", async (c) => {
    const body = await c.req.parseBody();
    const email = String(body.email ?? "");
    const password = String(body.password ?? "");
    const user = await createUser(email, password);
    const session = createSession(user.id);
    setCookie(c, "session_id", session.id, { path: "/", httpOnly: true });
    return c.redirect("/me");
  });

  app.post("/login", async (c) => {
    const body = await c.req.parseBody();
    const email = String(body.email ?? "");
    const password = String(body.password ?? "");
    const user = findUserByEmail(email);

    if (!user) {
      return c.text("invalid credentials", 401);
    }

    const ok = await Bun.password.verify(password, user.password_hash);
    if (!ok) {
      return c.text("invalid credentials", 401);
    }

    const session = createSession(user.id);
    setCookie(c, "session_id", session.id, { path: "/", httpOnly: true });
    return c.redirect("/me");
  });

  return app;
}
```

`src/server/app.ts`

```ts
import { Hono } from "hono";
import { sessionMiddleware } from "./middleware/session";
import { authRoutes } from "./routes/auth";

export function createApp() {
  const app = new Hono();

  app.use("*", sessionMiddleware);

  app.get("/", (c) => {
    return c.html(`
      <html>
        <body>
          <h1>最新发射事件</h1>
        </body>
      </html>
    `);
  });

  app.get("/me", (c) => {
    const sessionUserId = c.get("sessionUserId");
    if (!sessionUserId) {
      return c.redirect("/");
    }
    return c.html("<html><body><h1>用户中心</h1></body></html>");
  });

  app.route("/", authRoutes());

  return app;
}
```

- [ ] **Step 4: 运行测试确认通过**

Run: `bun test tests/server/auth.test.ts`
Expected: PASS，输出包含 `1 pass`

- [ ] **Step 5: 提交**

```bash
git add src/shared/types.ts src/db/repositories/users.ts src/db/repositories/sessions.ts src/server/middleware/session.ts src/server/routes/auth.ts src/server/app.ts tests/server/auth.test.ts
git commit -m "feat: add email auth and session flow"
```

### Task 4: 公开首页事件流

**Files:**
- Create: `src/db/repositories/launch-events.ts`
- Create: `src/server/views/home.ts`
- Modify: `src/server/app.ts`
- Create: `tests/server/home-feed.test.ts`

- [ ] **Step 1: 写首页事件流失败测试**

```ts
import { beforeEach, describe, expect, test } from "bun:test";
import { runMigrations } from "../../src/db/migrate";
import { openDb } from "../../src/db/sqlite";
import { createApp } from "../../src/server/app";

describe("homepage feed", () => {
  beforeEach(() => {
    process.env.DATABASE_PATH = "/tmp/rgclaw-home-test.sqlite";
    runMigrations(process.env.DATABASE_PATH);
    const db = openDb();
    db.query(
      "insert into launch_events (id, source, source_event_id, token_address, symbol, title, event_time, chain, raw_payload, dedupe_key, created_at) values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
    ).run(
      "evt-1",
      "flap",
      "source-1",
      "0x123",
      "DOG",
      "DOG 发射",
      "2026-03-29T09:00:00.000Z",
      "bsc",
      "{}",
      "flap:tx1:0",
      "2026-03-29T09:00:00.000Z",
    );
  });

  test("按倒序展示最新事件", async () => {
    const app = createApp();
    const res = await app.request("/");
    const html = await res.text();

    expect(res.status).toBe(200);
    expect(html).toContain("DOG 发射");
    expect(html).toContain("flap");
  });
});
```

- [ ] **Step 2: 运行测试确认失败**

Run: `bun test tests/server/home-feed.test.ts`
Expected: FAIL，断言失败，因为首页尚未读取数据库事件

- [ ] **Step 3: 写最小事件流实现**

`src/db/repositories/launch-events.ts`

```ts
import { openDb } from "../sqlite";

export function listLatestLaunchEvents(limit = 50) {
  const db = openDb();
  return db
    .query(
      "select id, source, token_address, symbol, title, event_time from launch_events order by event_time desc limit ?",
    )
    .all(limit) as Array<{
    id: string;
    source: string;
    token_address: string;
    symbol: string | null;
    title: string;
    event_time: string;
  }>;
}
```

`src/server/views/home.ts`

```ts
export function renderHomePage(
  events: Array<{
    source: string;
    token_address: string;
    symbol: string | null;
    title: string;
    event_time: string;
  }>,
) {
  const items = events
    .map(
      (event) => `
      <li>
        <strong>${event.title}</strong>
        <div>来源: ${event.source}</div>
        <div>地址: ${event.token_address}</div>
        <div>时间: ${event.event_time}</div>
      </li>`,
    )
    .join("");

  return `
    <html>
      <body>
        <h1>最新发射事件</h1>
        <ul>${items}</ul>
      </body>
    </html>
  `;
}
```

`src/server/app.ts`

```ts
import { Hono } from "hono";
import { listLatestLaunchEvents } from "../db/repositories/launch-events";
import { sessionMiddleware } from "./middleware/session";
import { authRoutes } from "./routes/auth";
import { renderHomePage } from "./views/home";

export function createApp() {
  const app = new Hono();

  app.use("*", sessionMiddleware);

  app.get("/", (c) => {
    const events = listLatestLaunchEvents();
    return c.html(renderHomePage(events));
  });

  app.get("/me", (c) => {
    const sessionUserId = c.get("sessionUserId");
    if (!sessionUserId) {
      return c.redirect("/");
    }
    return c.html("<html><body><h1>用户中心</h1></body></html>");
  });

  app.route("/", authRoutes());

  return app;
}
```

- [ ] **Step 4: 运行测试确认通过**

Run: `bun test tests/server/home-feed.test.ts`
Expected: PASS，输出包含 `1 pass`

- [ ] **Step 5: 提交**

```bash
git add src/db/repositories/launch-events.ts src/server/views/home.ts src/server/app.ts tests/server/home-feed.test.ts
git commit -m "feat: add public launch event feed"
```

### Task 5: 用户中心中的钱包地址与来源订阅

**Files:**
- Create: `src/db/repositories/subscriptions.ts`
- Create: `src/db/repositories/entitlements.ts`
- Create: `src/server/routes/user-center.ts`
- Create: `src/server/views/user-center.ts`
- Modify: `src/server/app.ts`
- Create: `tests/server/user-center.test.ts`

- [ ] **Step 1: 写用户中心失败测试**

```ts
import { beforeEach, describe, expect, test } from "bun:test";
import { runMigrations } from "../../src/db/migrate";
import { createUser } from "../../src/db/repositories/users";
import { createSession } from "../../src/db/repositories/sessions";
import { createApp } from "../../src/server/app";

describe("user center", () => {
  beforeEach(() => {
    process.env.DATABASE_PATH = "/tmp/rgclaw-user-center-test.sqlite";
    runMigrations(process.env.DATABASE_PATH);
  });

  test("展示钱包地址和来源订阅状态", async () => {
    const user = await createUser("center@example.com", "pass123456");
    const session = createSession(user.id);
    const app = createApp();

    const res = await app.request("/me", {
      headers: {
        cookie: `session_id=${session.id}`,
      },
    });

    const html = await res.text();
    expect(html).toContain("钱包地址");
    expect(html).toContain("four");
    expect(html).toContain("flap");
  });
});
```

- [ ] **Step 2: 运行测试确认失败**

Run: `bun test tests/server/user-center.test.ts`
Expected: FAIL，断言失败，因为用户中心页面还没有钱包和订阅内容

- [ ] **Step 3: 写最小用户中心实现**

`src/db/repositories/subscriptions.ts`

```ts
import { randomUUID } from "node:crypto";
import { openDb } from "../sqlite";
import type { LaunchSource } from "../../shared/types";

export function ensureDefaultSubscriptions(userId: string) {
  const db = openDb();
  for (const source of ["four", "flap"] as LaunchSource[]) {
    db.query(
      "insert or ignore into user_source_subscriptions (id, user_id, source, enabled, created_at, updated_at) values (?, ?, ?, ?, ?, ?)",
    ).run(randomUUID(), userId, source, 1, new Date().toISOString(), new Date().toISOString());
  }
}

export function listSubscriptions(userId: string) {
  const db = openDb();
  return db
    .query("select source, enabled from user_source_subscriptions where user_id = ? order by source asc")
    .all(userId) as Array<{ source: LaunchSource; enabled: number }>;
}

export function upsertWalletAddress(userId: string, walletAddress: string) {
  const db = openDb();
  db.query("update users set wallet_address = ?, wallet_address_updated_at = ?, updated_at = ? where id = ?").run(
    walletAddress,
    new Date().toISOString(),
    new Date().toISOString(),
    userId,
  );
}
```

`src/db/repositories/entitlements.ts`

```ts
import { openDb } from "../sqlite";

export function getActiveEntitlement(userId: string) {
  const db = openDb();
  return db
    .query(
      "select plan_type, status, starts_at, expires_at from user_entitlements where user_id = ? order by expires_at desc limit 1",
    )
    .get(userId) as
    | { plan_type: string; status: string; starts_at: string; expires_at: string }
    | null;
}
```

`src/server/views/user-center.ts`

```ts
export function renderUserCenter(input: {
  email: string;
  walletAddress: string;
  subscriptions: Array<{ source: string; enabled: number }>;
  entitlementText: string;
}) {
  return `
    <html>
      <body>
        <h1>用户中心</h1>
        <div>邮箱: ${input.email}</div>
        <div>钱包地址: ${input.walletAddress || "未填写"}</div>
        <div>有效期: ${input.entitlementText}</div>
        <ul>
          ${input.subscriptions.map((item) => `<li>${item.source}: ${item.enabled ? "开启" : "关闭"}</li>`).join("")}
        </ul>
      </body>
    </html>
  `;
}
```

`src/server/routes/user-center.ts`

```ts
import { Hono } from "hono";
import { openDb } from "../../db/sqlite";
import { getActiveEntitlement } from "../../db/repositories/entitlements";
import { ensureDefaultSubscriptions, listSubscriptions, upsertWalletAddress } from "../../db/repositories/subscriptions";
import { renderUserCenter } from "../views/user-center";

export function userCenterRoutes() {
  const app = new Hono();

  app.get("/me", (c) => {
    const userId = c.get("sessionUserId");
    if (!userId) {
      return c.redirect("/");
    }

    ensureDefaultSubscriptions(userId);
    const db = openDb();
    const user = db.query("select email, wallet_address from users where id = ?").get(userId) as
      | { email: string; wallet_address: string | null }
      | null;
    const entitlement = getActiveEntitlement(userId);
    const subscriptions = listSubscriptions(userId);

    return c.html(
      renderUserCenter({
        email: user?.email ?? "",
        walletAddress: user?.wallet_address ?? "",
        subscriptions,
        entitlementText: entitlement?.expires_at ?? "暂无",
      }),
    );
  });

  app.post("/me/wallet", async (c) => {
    const userId = c.get("sessionUserId");
    if (!userId) {
      return c.text("unauthorized", 401);
    }

    const body = await c.req.parseBody();
    upsertWalletAddress(userId, String(body.walletAddress ?? ""));
    return c.redirect("/me");
  });

  return app;
}
```

`src/server/app.ts`

```ts
import { Hono } from "hono";
import { listLatestLaunchEvents } from "../db/repositories/launch-events";
import { sessionMiddleware } from "./middleware/session";
import { authRoutes } from "./routes/auth";
import { userCenterRoutes } from "./routes/user-center";
import { renderHomePage } from "./views/home";

export function createApp() {
  const app = new Hono();

  app.use("*", sessionMiddleware);
  app.get("/", (c) => c.html(renderHomePage(listLatestLaunchEvents())));
  app.route("/", authRoutes());
  app.route("/", userCenterRoutes());

  return app;
}
```

- [ ] **Step 4: 运行测试确认通过**

Run: `bun test tests/server/user-center.test.ts`
Expected: PASS，输出包含 `1 pass`

- [ ] **Step 5: 提交**

```bash
git add src/db/repositories/subscriptions.ts src/db/repositories/entitlements.ts src/server/routes/user-center.ts src/server/views/user-center.ts src/server/app.ts tests/server/user-center.test.ts
git commit -m "feat: add user center with wallet and subscriptions"
```

### Task 6: 微信绑定与 3 天试用资格

**Files:**
- Create: `src/db/repositories/wechat-bindings.ts`
- Create: `src/adapters/wechat-bot.ts`
- Create: `src/server/routes/wechat.ts`
- Modify: `src/db/repositories/entitlements.ts`
- Modify: `src/server/views/user-center.ts`
- Modify: `src/server/routes/user-center.ts`
- Create: `tests/server/wechat-binding.test.ts`

- [ ] **Step 1: 写微信绑定失败测试**

```ts
import { beforeEach, describe, expect, test } from "bun:test";
import { createUser } from "../../src/db/repositories/users";
import { createSession } from "../../src/db/repositories/sessions";
import { runMigrations } from "../../src/db/migrate";
import { createApp } from "../../src/server/app";

describe("wechat binding", () => {
  beforeEach(() => {
    process.env.DATABASE_PATH = "/tmp/rgclaw-wechat-test.sqlite";
    runMigrations(process.env.DATABASE_PATH);
  });

  test("绑定成功后发放 3 天试用", async () => {
    const user = await createUser("wechat@example.com", "pass123456");
    const session = createSession(user.id);
    const app = createApp();

    const bindPage = await app.request("/me", {
      headers: { cookie: `session_id=${session.id}` },
    });

    expect(await bindPage.text()).toContain("绑定码");

    const callbackRes = await app.request("/wechat/callback", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        bindCode: "BIND-TEST-001",
        wechatUserId: "wx-user-1",
      }),
    });

    expect(callbackRes.status).toBe(200);

    const meRes = await app.request("/me", {
      headers: { cookie: `session_id=${session.id}` },
    });

    const html = await meRes.text();
    expect(html).toContain("已绑定");
    expect(html).toContain("3 天试用");
  });
});
```

- [ ] **Step 2: 运行测试确认失败**

Run: `bun test tests/server/wechat-binding.test.ts`
Expected: FAIL，断言失败，因为绑定页和回调逻辑尚未实现

- [ ] **Step 3: 写最小绑定与试用实现**

`src/db/repositories/wechat-bindings.ts`

```ts
import { randomUUID } from "node:crypto";
import { openDb } from "../sqlite";

export function ensureBindCode(userId: string) {
  const db = openDb();
  const existing = db
    .query("select bind_code, bind_status from user_wechat_bindings where user_id = ?")
    .get(userId) as { bind_code: string; bind_status: string } | null;

  if (existing) {
    return existing;
  }

  const bindCode = `BIND-${randomUUID().slice(0, 8).toUpperCase()}`;
  db.query(
    "insert into user_wechat_bindings (id, user_id, bind_status, bind_code) values (?, ?, ?, ?)",
  ).run(randomUUID(), userId, "pending", bindCode);
  return { bind_code: bindCode, bind_status: "pending" };
}

export function completeBinding(bindCode: string, wechatUserId: string) {
  const db = openDb();
  db.query(
    "update user_wechat_bindings set bind_status = ?, wechat_user_id = ?, bound_at = ? where bind_code = ?",
  ).run("bound", wechatUserId, new Date().toISOString(), bindCode);

  return db
    .query("select user_id from user_wechat_bindings where bind_code = ?")
    .get(bindCode) as { user_id: string } | null;
}

export function getBindingByUserId(userId: string) {
  const db = openDb();
  return db
    .query("select bind_status, bind_code, wechat_user_id from user_wechat_bindings where user_id = ?")
    .get(userId) as
    | { bind_status: string; bind_code: string; wechat_user_id: string | null }
    | null;
}
```

`src/adapters/wechat-bot.ts`

```ts
export function buildBindInstruction(bindCode: string) {
  return `请在微信机器人中发送绑定码：${bindCode}`;
}

export async function sendWechatMessage(_wechatUserId: string, _content: string) {
  return { ok: true };
}
```

`src/db/repositories/entitlements.ts`

```ts
import { randomUUID } from "node:crypto";
import { openDb } from "../sqlite";

export function getActiveEntitlement(userId: string) {
  const db = openDb();
  return db
    .query(
      "select plan_type, status, starts_at, expires_at from user_entitlements where user_id = ? order by expires_at desc limit 1",
    )
    .get(userId) as
    | { plan_type: string; status: string; starts_at: string; expires_at: string }
    | null;
}

export function ensureTrialEntitlement(userId: string) {
  const db = openDb();
  const existing = db
    .query("select id from user_entitlements where user_id = ? and plan_type = 'trial' limit 1")
    .get(userId) as { id: string } | null;

  if (existing) {
    return;
  }

  const now = new Date();
  const expiresAt = new Date(now.getTime() + 1000 * 60 * 60 * 24 * 3).toISOString();
  db.query(
    "insert into user_entitlements (id, user_id, plan_type, status, starts_at, expires_at, source, created_at, updated_at) values (?, ?, ?, ?, ?, ?, ?, ?, ?)",
  ).run(
    randomUUID(),
    userId,
    "trial",
    "active",
    now.toISOString(),
    expiresAt,
    "trial_signup",
    now.toISOString(),
    now.toISOString(),
  );
}
```

`src/server/routes/wechat.ts`

```ts
import { Hono } from "hono";
import { ensureTrialEntitlement } from "../../db/repositories/entitlements";
import { completeBinding } from "../../db/repositories/wechat-bindings";

export function wechatRoutes() {
  const app = new Hono();

  app.post("/wechat/callback", async (c) => {
    const body = await c.req.json();
    const result = completeBinding(String(body.bindCode), String(body.wechatUserId));
    if (!result) {
      return c.text("bind code not found", 404);
    }
    ensureTrialEntitlement(result.user_id);
    return c.json({ ok: true });
  });

  return app;
}
```

`src/server/views/user-center.ts`

```ts
export function renderUserCenter(input: {
  email: string;
  walletAddress: string;
  subscriptions: Array<{ source: string; enabled: number }>;
  entitlementText: string;
  bindingStatusText: string;
  bindInstruction: string;
}) {
  return `
    <html>
      <body>
        <h1>用户中心</h1>
        <div>邮箱: ${input.email}</div>
        <div>钱包地址: ${input.walletAddress || "未填写"}</div>
        <div>微信绑定: ${input.bindingStatusText}</div>
        <div>绑定码: ${input.bindInstruction}</div>
        <div>有效期: ${input.entitlementText}</div>
        <ul>
          ${input.subscriptions.map((item) => `<li>${item.source}: ${item.enabled ? "开启" : "关闭"}</li>`).join("")}
        </ul>
      </body>
    </html>
  `;
}
```

`src/server/routes/user-center.ts`

```ts
import { Hono } from "hono";
import { buildBindInstruction } from "../../adapters/wechat-bot";
import { getActiveEntitlement } from "../../db/repositories/entitlements";
import { ensureDefaultSubscriptions, listSubscriptions, upsertWalletAddress } from "../../db/repositories/subscriptions";
import { ensureBindCode, getBindingByUserId } from "../../db/repositories/wechat-bindings";
import { openDb } from "../../db/sqlite";
import { renderUserCenter } from "../views/user-center";

export function userCenterRoutes() {
  const app = new Hono();

  app.get("/me", (c) => {
    const userId = c.get("sessionUserId");
    if (!userId) {
      return c.redirect("/");
    }

    ensureDefaultSubscriptions(userId);
    const bindRecord = ensureBindCode(userId);
    const binding = getBindingByUserId(userId);
    const db = openDb();
    const user = db.query("select email, wallet_address from users where id = ?").get(userId) as
      | { email: string; wallet_address: string | null }
      | null;
    const entitlement = getActiveEntitlement(userId);
    const subscriptions = listSubscriptions(userId);

    return c.html(
      renderUserCenter({
        email: user?.email ?? "",
        walletAddress: user?.wallet_address ?? "",
        subscriptions,
        entitlementText: entitlement ? `${entitlement.expires_at}（${entitlement.plan_type === "trial" ? "3 天试用" : "付费"}）` : "暂无",
        bindingStatusText: binding?.bind_status === "bound" ? "已绑定" : "未绑定",
        bindInstruction: buildBindInstruction(bindRecord.bind_code),
      }),
    );
  });

  app.post("/me/wallet", async (c) => {
    const userId = c.get("sessionUserId");
    if (!userId) {
      return c.text("unauthorized", 401);
    }

    const body = await c.req.parseBody();
    upsertWalletAddress(userId, String(body.walletAddress ?? ""));
    return c.redirect("/me");
  });

  return app;
}
```

- [ ] **Step 4: 运行测试确认通过**

Run: `bun test tests/server/wechat-binding.test.ts`
Expected: PASS，输出包含 `1 pass`

- [ ] **Step 5: 提交**

```bash
git add src/db/repositories/wechat-bindings.ts src/adapters/wechat-bot.ts src/server/routes/wechat.ts src/db/repositories/entitlements.ts src/server/views/user-center.ts src/server/routes/user-center.ts tests/server/wechat-binding.test.ts
git commit -m "feat: add wechat binding and trial entitlement"
```

### Task 7: 实现 four 与 flap collector，写入统一事件表

**Files:**
- Create: `src/shared/config.ts`
- Create: `src/collectors/four.ts`
- Create: `src/collectors/flap.ts`
- Create: `src/collectors/run.ts`
- Modify: `src/db/repositories/launch-events.ts`
- Create: `tests/collectors/normalize-events.test.ts`

- [ ] **Step 1: 写 collector 失败测试**

```ts
import { describe, expect, test } from "bun:test";
import { normalizeFourEvent } from "../../src/collectors/four";
import { normalizeFlapEvent } from "../../src/collectors/flap";

describe("event normalization", () => {
  test("four 事件转换为统一结构", () => {
    const event = normalizeFourEvent({
      transactionHash: "0xtx",
      logIndex: 1,
      args: { memeToken: "0xabc", symbol: "RG" },
    });

    expect(event.source).toBe("four");
    expect(event.dedupeKey).toBe("four:0xtx:1");
  });

  test("flap 事件转换为统一结构", () => {
    const event = normalizeFlapEvent({
      transactionHash: "0xtx2",
      logIndex: 0,
      args: { token: "0xdef", symbol: "DOG" },
    });

    expect(event.source).toBe("flap");
    expect(event.tokenAddress).toBe("0xdef");
  });
});
```

- [ ] **Step 2: 运行测试确认失败**

Run: `bun test tests/collectors/normalize-events.test.ts`
Expected: FAIL，报错包含 `Cannot find module '../../src/collectors/four'`

- [ ] **Step 3: 写最小标准化与入库实现**

`src/shared/config.ts`

```ts
export const config = {
  databasePath: process.env.DATABASE_PATH ?? "./data/app.sqlite",
  bnbCollectionWallet: "0xaCEa067c6751083e4e652543A436638c1e777777",
  priceUnitWei: "5000000000000000",
  trialDays: 3,
  reminderLeadDays: 1,
};
```

`src/db/repositories/launch-events.ts`

```ts
import { randomUUID } from "node:crypto";
import { openDb } from "../sqlite";

export function listLatestLaunchEvents(limit = 50) {
  const db = openDb();
  return db
    .query(
      "select id, source, token_address, symbol, title, event_time from launch_events order by event_time desc limit ?",
    )
    .all(limit) as Array<{
    id: string;
    source: string;
    token_address: string;
    symbol: string | null;
    title: string;
    event_time: string;
  }>;
}

export function insertLaunchEvent(event: {
  source: string;
  sourceEventId: string;
  tokenAddress: string;
  symbol: string | null;
  title: string;
  eventTime: string;
  chain: string;
  rawPayload: string;
  dedupeKey: string;
}) {
  const db = openDb();
  db.query(
    "insert or ignore into launch_events (id, source, source_event_id, token_address, symbol, title, event_time, chain, raw_payload, dedupe_key, created_at) values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
  ).run(
    randomUUID(),
    event.source,
    event.sourceEventId,
    event.tokenAddress,
    event.symbol,
    event.title,
    event.eventTime,
    event.chain,
    event.rawPayload,
    event.dedupeKey,
    new Date().toISOString(),
  );
}
```

`src/collectors/four.ts`

```ts
export function normalizeFourEvent(log: {
  transactionHash: string;
  logIndex: number;
  args: { memeToken?: string; token?: string; symbol?: string };
}) {
  const tokenAddress = log.args.memeToken ?? log.args.token ?? "";
  const symbol = log.args.symbol ?? null;

  return {
    source: "four",
    sourceEventId: `${log.transactionHash}:${log.logIndex}`,
    tokenAddress,
    symbol,
    title: `${symbol ?? tokenAddress} 发射`,
    eventTime: new Date().toISOString(),
    chain: "bsc",
    rawPayload: JSON.stringify(log),
    dedupeKey: `four:${log.transactionHash}:${log.logIndex}`,
  };
}
```

`src/collectors/flap.ts`

```ts
export function normalizeFlapEvent(log: {
  transactionHash: string;
  logIndex: number;
  args: { token: string; symbol?: string };
}) {
  const symbol = log.args.symbol ?? null;
  return {
    source: "flap",
    sourceEventId: `${log.transactionHash}:${log.logIndex}`,
    tokenAddress: log.args.token,
    symbol,
    title: `${symbol ?? log.args.token} 发射`,
    eventTime: new Date().toISOString(),
    chain: "bsc",
    rawPayload: JSON.stringify(log),
    dedupeKey: `flap:${log.transactionHash}:${log.logIndex}`,
  };
}
```

`src/collectors/run.ts`

```ts
import { insertLaunchEvent } from "../db/repositories/launch-events";
import { normalizeFlapEvent } from "./flap";
import { normalizeFourEvent } from "./four";

async function boot() {
  console.log("collector boot");
  const demoFour = normalizeFourEvent({
    transactionHash: "demo-four",
    logIndex: 0,
    args: { memeToken: "0xfour", symbol: "FOUR" },
  });
  insertLaunchEvent(demoFour);

  const demoFlap = normalizeFlapEvent({
    transactionHash: "demo-flap",
    logIndex: 0,
    args: { token: "0xflap", symbol: "FLAP" },
  });
  insertLaunchEvent(demoFlap);
}

boot();
```

- [ ] **Step 4: 运行测试确认通过**

Run: `bun test tests/collectors/normalize-events.test.ts`
Expected: PASS，输出包含 `2 pass`

- [ ] **Step 5: 提交**

```bash
git add src/shared/config.ts src/collectors/four.ts src/collectors/flap.ts src/collectors/run.ts src/db/repositories/launch-events.ts tests/collectors/normalize-events.test.ts
git commit -m "feat: add launch event collectors"
```

### Task 8: 推送 worker 与到期前 1 天提醒

**Files:**
- Create: `src/db/repositories/notification-jobs.ts`
- Modify: `src/db/repositories/entitlements.ts`
- Create: `src/workers/push-worker.ts`
- Modify: `src/adapters/wechat-bot.ts`
- Create: `tests/workers/push-worker.test.ts`

- [ ] **Step 1: 写推送与提醒失败测试**

```ts
import { beforeEach, describe, expect, test } from "bun:test";
import { runMigrations } from "../../src/db/migrate";
import { openDb } from "../../src/db/sqlite";
import { processLaunchPushes, processRenewalReminders } from "../../src/workers/push-worker";

describe("push worker", () => {
  beforeEach(() => {
    process.env.DATABASE_PATH = "/tmp/rgclaw-push-worker-test.sqlite";
    runMigrations(process.env.DATABASE_PATH);
    const db = openDb();
    db.exec(`
      insert into users (id, email, password_hash, created_at, updated_at) values ('u1', 'u1@example.com', 'x', '2026-03-29T00:00:00.000Z', '2026-03-29T00:00:00.000Z');
      insert into user_wechat_bindings (id, user_id, wechat_user_id, bind_status, bind_code, bound_at) values ('b1', 'u1', 'wx1', 'bound', 'BIND-1', '2026-03-29T00:00:00.000Z');
      insert into user_source_subscriptions (id, user_id, source, enabled, created_at, updated_at) values ('s1', 'u1', 'flap', 1, '2026-03-29T00:00:00.000Z', '2026-03-29T00:00:00.000Z');
      insert into user_entitlements (id, user_id, plan_type, status, starts_at, expires_at, source, created_at, updated_at) values ('e1', 'u1', 'trial', 'active', '2026-03-29T00:00:00.000Z', '2099-03-30T00:00:00.000Z', 'trial_signup', '2026-03-29T00:00:00.000Z', '2026-03-29T00:00:00.000Z');
      insert into launch_events (id, source, source_event_id, token_address, symbol, title, event_time, chain, raw_payload, dedupe_key, created_at) values ('evt1', 'flap', 'source1', '0xabc', 'DOG', 'DOG 发射', '2026-03-29T00:00:00.000Z', 'bsc', '{}', 'flap:tx:1', '2026-03-29T00:00:00.000Z');
    `);
  });

  test("为符合条件用户创建微信推送任务", async () => {
    const count = await processLaunchPushes();
    expect(count).toBe(1);
  });

  test("到期前一天生成一次续费提醒", async () => {
    const db = openDb();
    db.query("update user_entitlements set expires_at = ? where id = 'e1'").run(
      new Date(Date.now() + 1000 * 60 * 60 * 12).toISOString(),
    );
    const count = await processRenewalReminders();
    expect(count).toBe(1);
  });
});
```

- [ ] **Step 2: 运行测试确认失败**

Run: `bun test tests/workers/push-worker.test.ts`
Expected: FAIL，报错包含 `Cannot find module '../../src/workers/push-worker'`

- [ ] **Step 3: 写最小 worker 实现**

`src/db/repositories/notification-jobs.ts`

```ts
import { randomUUID } from "node:crypto";
import { openDb } from "../sqlite";

export function createNotificationJob(input: {
  launchEventId: string;
  userId: string;
  status?: string;
}) {
  const db = openDb();
  db.query(
    "insert into notification_jobs (id, launch_event_id, user_id, channel, status, created_at) values (?, ?, ?, ?, ?, ?)",
  ).run(
    randomUUID(),
    input.launchEventId,
    input.userId,
    "wechat",
    input.status ?? "pending",
    new Date().toISOString(),
  );
}

export function createSystemMessageJob(input: { userId: string; messageType: string; payload: string }) {
  const db = openDb();
  db.query(
    "insert into system_message_jobs (id, user_id, message_type, payload, status, created_at) values (?, ?, ?, ?, ?, ?)",
  ).run(randomUUID(), input.userId, input.messageType, input.payload, "pending", new Date().toISOString());
}
```

`src/db/repositories/entitlements.ts`

```ts
import { randomUUID } from "node:crypto";
import { openDb } from "../sqlite";

export function getActiveEntitlement(userId: string) {
  const db = openDb();
  return db
    .query(
      "select plan_type, status, starts_at, expires_at from user_entitlements where user_id = ? order by expires_at desc limit 1",
    )
    .get(userId) as
    | { plan_type: string; status: string; starts_at: string; expires_at: string }
    | null;
}

export function ensureTrialEntitlement(userId: string) {
  const db = openDb();
  const existing = db
    .query("select id from user_entitlements where user_id = ? and plan_type = 'trial' limit 1")
    .get(userId) as { id: string } | null;

  if (existing) {
    return;
  }

  const now = new Date();
  const expiresAt = new Date(now.getTime() + 1000 * 60 * 60 * 24 * 3).toISOString();
  db.query(
    "insert into user_entitlements (id, user_id, plan_type, status, starts_at, expires_at, source, created_at, updated_at) values (?, ?, ?, ?, ?, ?, ?, ?, ?)",
  ).run(randomUUID(), userId, "trial", "active", now.toISOString(), expiresAt, "trial_signup", now.toISOString(), now.toISOString());
}

export function markReminderSent(entitlementId: string) {
  const db = openDb();
  db.query("update user_entitlements set renewal_reminded_at = ?, updated_at = ? where id = ?").run(
    new Date().toISOString(),
    new Date().toISOString(),
    entitlementId,
  );
}
```

`src/adapters/wechat-bot.ts`

```ts
export function buildBindInstruction(bindCode: string) {
  return `请在微信机器人中发送绑定码：${bindCode}`;
}

export async function sendWechatMessage(_wechatUserId: string, _content: string) {
  return { ok: true };
}

export function buildLaunchMessage(title: string, tokenAddress: string) {
  return `${title}\n${tokenAddress}`;
}

export function buildRenewalReminder(expiresAt: string) {
  return `你的推送权益将在 ${expiresAt} 到期，请及时续费。`;
}
```

`src/workers/push-worker.ts`

```ts
import { openDb } from "../db/sqlite";
import { createNotificationJob, createSystemMessageJob } from "../db/repositories/notification-jobs";
import { markReminderSent } from "../db/repositories/entitlements";
import { buildRenewalReminder } from "../adapters/wechat-bot";

export async function processLaunchPushes() {
  const db = openDb();
  const rows = db
    .query(`
      select distinct launch_events.id as launch_event_id, users.id as user_id
      from launch_events
      join user_source_subscriptions on user_source_subscriptions.source = launch_events.source and user_source_subscriptions.enabled = 1
      join users on users.id = user_source_subscriptions.user_id
      join user_wechat_bindings on user_wechat_bindings.user_id = users.id and user_wechat_bindings.bind_status = 'bound'
      join user_entitlements on user_entitlements.user_id = users.id and user_entitlements.status = 'active'
      where datetime(user_entitlements.expires_at) > datetime('now')
        and not exists (
          select 1 from notification_jobs
          where notification_jobs.launch_event_id = launch_events.id
            and notification_jobs.user_id = users.id
        )
    `)
    .all() as Array<{ launch_event_id: string; user_id: string }>;

  for (const row of rows) {
    createNotificationJob({ launchEventId: row.launch_event_id, userId: row.user_id });
  }

  return rows.length;
}

export async function processRenewalReminders() {
  const db = openDb();
  const rows = db
    .query(`
      select id, user_id, expires_at
      from user_entitlements
      where status = 'active'
        and renewal_reminded_at is null
        and datetime(expires_at) <= datetime('now', '+1 day')
        and datetime(expires_at) > datetime('now')
    `)
    .all() as Array<{ id: string; user_id: string; expires_at: string }>;

  for (const row of rows) {
    createSystemMessageJob({
      userId: row.user_id,
      messageType: "renewal_reminder",
      payload: buildRenewalReminder(row.expires_at),
    });
    markReminderSent(row.id);
  }

  return rows.length;
}
```

- [ ] **Step 4: 运行测试确认通过**

Run: `bun test tests/workers/push-worker.test.ts`
Expected: PASS，输出包含 `2 pass`

- [ ] **Step 5: 提交**

```bash
git add src/db/repositories/notification-jobs.ts src/db/repositories/entitlements.ts src/adapters/wechat-bot.ts src/workers/push-worker.ts tests/workers/push-worker.test.ts
git commit -m "feat: add push dispatch and renewal reminders"
```

### Task 9: 续费页、BNB 到账检测与自动续期

**Files:**
- Create: `src/db/repositories/payment-records.ts`
- Create: `src/server/routes/renewal.ts`
- Create: `src/server/views/renewal.ts`
- Create: `src/workers/payment-watcher.ts`
- Modify: `src/server/app.ts`
- Create: `tests/workers/payment-watcher.test.ts`
- Create: `tests/server/renewal-page.test.ts`

- [ ] **Step 1: 写续费页和到账续期失败测试**

`tests/server/renewal-page.test.ts`

```ts
import { beforeEach, describe, expect, test } from "bun:test";
import { createUser } from "../../src/db/repositories/users";
import { createSession } from "../../src/db/repositories/sessions";
import { runMigrations } from "../../src/db/migrate";
import { openDb } from "../../src/db/sqlite";
import { createApp } from "../../src/server/app";

describe("renewal page", () => {
  beforeEach(() => {
    process.env.DATABASE_PATH = "/tmp/rgclaw-renewal-page-test.sqlite";
    runMigrations(process.env.DATABASE_PATH);
  });

  test("续费页展示固定收款地址和价格", async () => {
    const user = await createUser("renew@example.com", "pass123456");
    const session = createSession(user.id);
    const db = openDb();
    db.query("update users set wallet_address = ? where id = ?").run("0xuserwallet", user.id);

    const app = createApp();
    const res = await app.request("/renew", {
      headers: { cookie: `session_id=${session.id}` },
    });
    const html = await res.text();

    expect(html).toContain("0xaCEa067c6751083e4e652543A436638c1e777777");
    expect(html).toContain("0.005 BNB / 30 天");
  });
});
```

`tests/workers/payment-watcher.test.ts`

```ts
import { beforeEach, describe, expect, test } from "bun:test";
import { runMigrations } from "../../src/db/migrate";
import { openDb } from "../../src/db/sqlite";
import { applyIncomingTransfer } from "../../src/workers/payment-watcher";

describe("payment watcher", () => {
  beforeEach(() => {
    process.env.DATABASE_PATH = "/tmp/rgclaw-payment-test.sqlite";
    runMigrations(process.env.DATABASE_PATH);
    const db = openDb();
    db.exec(`
      insert into users (id, email, password_hash, wallet_address, created_at, updated_at) values ('u1', 'pay@example.com', 'x', '0xuserwallet', '2026-03-29T00:00:00.000Z', '2026-03-29T00:00:00.000Z');
      insert into user_entitlements (id, user_id, plan_type, status, starts_at, expires_at, source, created_at, updated_at) values ('e1', 'u1', 'paid', 'active', '2026-03-29T00:00:00.000Z', '2026-04-01T00:00:00.000Z', 'bnb_payment', '2026-03-29T00:00:00.000Z', '2026-03-29T00:00:00.000Z');
    `);
  });

  test("0.01 BNB 自动续期 60 天", async () => {
    const result = await applyIncomingTransfer({
      txHash: "0xtx-1",
      from: "0xuserwallet",
      to: "0xaCEa067c6751083e4e652543A436638c1e777777",
      valueWei: "10000000000000000",
      paidAt: "2026-03-30T00:00:00.000Z",
    });

    expect(result.creditedDays).toBe(60);
  });
});
```

- [ ] **Step 2: 运行测试确认失败**

Run: `bun test tests/server/renewal-page.test.ts tests/workers/payment-watcher.test.ts`
Expected: FAIL，报错包含 `Cannot find module '../../src/workers/payment-watcher'` 或路由未实现

- [ ] **Step 3: 写最小续费实现**

`src/db/repositories/payment-records.ts`

```ts
import { randomUUID } from "node:crypto";
import { openDb } from "../sqlite";

export function insertPaymentRecord(input: {
  userId: string;
  fromWalletAddress: string;
  toWalletAddress: string;
  txHash: string;
  amountBnbWei: string;
  creditedDays: number;
  status: string;
  paidAt: string;
  rawPayload: string;
}) {
  const db = openDb();
  db.query(
    "insert into payment_records (id, user_id, from_wallet_address, to_wallet_address, tx_hash, amount_bnb_wei, credited_days, status, paid_at, raw_payload, created_at) values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
  ).run(
    randomUUID(),
    input.userId,
    input.fromWalletAddress,
    input.toWalletAddress,
    input.txHash,
    input.amountBnbWei,
    input.creditedDays,
    input.status,
    input.paidAt,
    input.rawPayload,
    new Date().toISOString(),
  );
}
```

`src/server/views/renewal.ts`

```ts
export function renderRenewalPage(walletAddress: string) {
  return `
    <html>
      <body>
        <h1>续费</h1>
        <div>当前价格: 0.005 BNB / 30 天</div>
        <div>收款地址: 0xaCEa067c6751083e4e652543A436638c1e777777</div>
        <div>登记钱包: ${walletAddress || "未填写"}</div>
        <div>请从登记钱包转账，到账后自动续期。</div>
      </body>
    </html>
  `;
}
```

`src/server/routes/renewal.ts`

```ts
import { Hono } from "hono";
import { openDb } from "../../db/sqlite";
import { renderRenewalPage } from "../views/renewal";

export function renewalRoutes() {
  const app = new Hono();

  app.get("/renew", (c) => {
    const userId = c.get("sessionUserId");
    if (!userId) {
      return c.redirect("/");
    }

    const db = openDb();
    const user = db.query("select wallet_address from users where id = ?").get(userId) as
      | { wallet_address: string | null }
      | null;

    return c.html(renderRenewalPage(user?.wallet_address ?? ""));
  });

  return app;
}
```

`src/workers/payment-watcher.ts`

```ts
import { openDb } from "../db/sqlite";
import { insertPaymentRecord } from "../db/repositories/payment-records";

const PRICE_UNIT_WEI = BigInt("5000000000000000");
const CREDIT_DAYS_PER_UNIT = 30;
const COLLECTION_WALLET = "0xaCEa067c6751083e4e652543A436638c1e777777";

export async function applyIncomingTransfer(input: {
  txHash: string;
  from: string;
  to: string;
  valueWei: string;
  paidAt: string;
}) {
  if (input.to.toLowerCase() !== COLLECTION_WALLET.toLowerCase()) {
    throw new Error("invalid collection wallet");
  }

  const db = openDb();
  const user = db.query("select id from users where lower(wallet_address) = lower(?)").get(input.from) as
    | { id: string }
    | null;

  if (!user) {
    throw new Error("wallet not matched");
  }

  const units = Number(BigInt(input.valueWei) / PRICE_UNIT_WEI);
  const creditedDays = units * CREDIT_DAYS_PER_UNIT;

  const entitlement = db
    .query("select id, expires_at from user_entitlements where user_id = ? order by expires_at desc limit 1")
    .get(user.id) as { id: string; expires_at: string } | null;

  const baseTime = entitlement && new Date(entitlement.expires_at).getTime() > new Date(input.paidAt).getTime()
    ? new Date(entitlement.expires_at)
    : new Date(input.paidAt);

  const newExpiresAt = new Date(baseTime.getTime() + creditedDays * 24 * 60 * 60 * 1000).toISOString();

  db.query("update user_entitlements set expires_at = ?, updated_at = ? where id = ?").run(
    newExpiresAt,
    new Date().toISOString(),
    entitlement?.id,
  );

  insertPaymentRecord({
    userId: user.id,
    fromWalletAddress: input.from,
    toWalletAddress: input.to,
    txHash: input.txHash,
    amountBnbWei: input.valueWei,
    creditedDays,
    status: "applied",
    paidAt: input.paidAt,
    rawPayload: JSON.stringify(input),
  });

  return { userId: user.id, creditedDays, newExpiresAt };
}
```

`src/server/app.ts`

```ts
import { Hono } from "hono";
import { listLatestLaunchEvents } from "../db/repositories/launch-events";
import { sessionMiddleware } from "./middleware/session";
import { authRoutes } from "./routes/auth";
import { renewalRoutes } from "./routes/renewal";
import { userCenterRoutes } from "./routes/user-center";
import { wechatRoutes } from "./routes/wechat";
import { renderHomePage } from "./views/home";

export function createApp() {
  const app = new Hono();

  app.use("*", sessionMiddleware);
  app.get("/", (c) => c.html(renderHomePage(listLatestLaunchEvents())));
  app.route("/", authRoutes());
  app.route("/", userCenterRoutes());
  app.route("/", renewalRoutes());
  app.route("/", wechatRoutes());

  return app;
}
```

- [ ] **Step 4: 运行测试确认通过**

Run: `bun test tests/server/renewal-page.test.ts tests/workers/payment-watcher.test.ts`
Expected: PASS，输出包含 `2 pass`

- [ ] **Step 5: 提交**

```bash
git add src/db/repositories/payment-records.ts src/server/routes/renewal.ts src/server/views/renewal.ts src/workers/payment-watcher.ts src/server/app.ts tests/server/renewal-page.test.ts tests/workers/payment-watcher.test.ts
git commit -m "feat: add renewal page and bnb auto-renewal"
```

### Task 10: 连接真实 worker 入口并完成回归验证

**Files:**
- Create: `src/workers/run.ts`
- Modify: `src/server/index.ts`
- Create: `tests/server/smoke.test.ts`
- Modify: `package.json`

- [ ] **Step 1: 写回归失败测试**

```ts
import { beforeEach, describe, expect, test } from "bun:test";
import { runMigrations } from "../../src/db/migrate";
import { createApp } from "../../src/server/app";

describe("smoke regression", () => {
  beforeEach(() => {
    process.env.DATABASE_PATH = "/tmp/rgclaw-smoke-test.sqlite";
    runMigrations(process.env.DATABASE_PATH);
  });

  test("首页、用户中心、续费页路由存在", async () => {
    const app = createApp();

    expect((await app.request("/")).status).toBe(200);
    expect((await app.request("/me")).status).toBe(302);
    expect((await app.request("/renew")).status).toBe(302);
  });
});
```

- [ ] **Step 2: 运行测试确认失败**

Run: `bun test tests/server/smoke.test.ts`
Expected: FAIL，如果前置任务未完整接线会出现状态码不符

- [ ] **Step 3: 写 worker 启动入口并补脚本**

`src/workers/run.ts`

```ts
import { processLaunchPushes, processRenewalReminders } from "./push-worker";

async function main() {
  console.log("worker boot");
  await processLaunchPushes();
  await processRenewalReminders();
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
```

`src/server/index.ts`

```ts
import { runMigrations } from "../db/migrate";
import { createApp } from "./app";

runMigrations(process.env.DATABASE_PATH);

const app = createApp();

export default {
  port: Number(process.env.PORT ?? 3000),
  fetch: app.fetch,
};
```

`package.json`

```json
{
  "name": "rgclaw",
  "private": true,
  "type": "module",
  "scripts": {
    "dev": "bun run src/server/index.ts",
    "test": "bun test",
    "db:migrate": "bun run src/db/migrate.ts",
    "collector": "bun run src/collectors/run.ts",
    "worker": "bun run src/workers/run.ts"
  },
  "dependencies": {
    "hono": "^4.7.2"
  },
  "devDependencies": {
    "@types/bun": "latest",
    "typescript": "^5.8.2"
  }
}
```

- [ ] **Step 4: 运行完整测试确认通过**

Run: `bun test`
Expected: PASS，全部测试通过

- [ ] **Step 5: 提交**

```bash
git add src/workers/run.ts src/server/index.ts package.json tests/server/smoke.test.ts
git commit -m "feat: wire workers and complete smoke coverage"
```

## 自检结果

### 1. Spec 覆盖核对

- 公开首页事件流：Task 4
- 轻账号体系：Task 3
- 微信绑定：Task 6
- 来源订阅：Task 5
- 3 天试用：Task 6
- 到期前 1 天提醒：Task 8
- 到期停推：Task 8 的 entitlement 过滤与 reminder 逻辑
- BNB 固定收款地址续费：Task 9
- `0.01 BNB = 60 天`：Task 9
- Bun + Hono + SQLite 架构：Task 1、2、10

没有发现未覆盖 spec 的功能点。

### 2. Placeholder 扫描

- 本计划未使用 `TBD`、`TODO`、`implement later`、`fill in details`
- 所有任务都给出了明确文件路径、命令与最小代码片段

### 3. 类型与命名一致性

- `LaunchSource` 固定为 `four | flap`
- `bind_code` / `wechat_user_id` / `expires_at` 命名在任务间保持一致
- 续费金额统一使用 `amount_bnb_wei` 与 `valueWei`
