import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, test } from "bun:test";
import { createSession } from "../../src/db/repositories/sessions";
import { createUser } from "../../src/db/repositories/users";
import { openDb } from "../../src/db/sqlite";
import { createApp } from "../../src/server/app";

function setupUserCenterTestApp() {
  const dir = mkdtempSync(join(tmpdir(), "rgclaw-user-center-"));
  const dbPath = join(dir, "app.sqlite");
  process.env.DATABASE_PATH = dbPath;

  return {
    app: createApp(),
    dbPath,
    cleanup() {
      rmSync(dir, { recursive: true, force: true });
      delete process.env.DATABASE_PATH;
    },
  };
}

describe("user center", () => {
  test("GET /me 展示钱包地址和来源订阅状态", async () => {
    const { app, dbPath, cleanup } = setupUserCenterTestApp();
    const db = openDb(dbPath);

    try {
      const user = await createUser("center@example.com", "pass123456");
      const now = new Date().toISOString();
      db.query("update users set wallet_address = ?, updated_at = ? where id = ?").run(
        "0xabc123",
        now,
        user.id,
      );
      db.query(
        `insert into wechat_bot_bindings (
          id, user_id, bot_token, bot_id, account_id, user_wx_id, base_url,
          status, bound_at, last_poll_at, last_message_at, created_at, updated_at
        ) values (?, ?, ?, ?, ?, ?, ?, 'active', ?, null, ?, ?, ?)`,
      ).run("binding-center", user.id, "token-center", "bot-center", "account-center", "wx-user-center", "https://ilinkai.weixin.qq.com", now, now, now, now);
      const session = createSession(user.id);

      const res = await app.request("http://localhost/me", {
        headers: {
          cookie: `session_id=${session.id}`,
        },
      });
      const html = await res.text();

      expect(res.status).toBe(200);
      expect(html).toContain("钱包");
      expect(html).toContain("0xabc123");
      expect(html).toContain("✅ 已绑定");
      expect(html).toContain("Four");
      expect(html).toContain("Flap");
    } finally {
      db.close();
      cleanup();
    }
  });

  test("GET /me 对已绑定但未发送首条消息的新用户持续显示提醒", async () => {
    const { app, dbPath, cleanup } = setupUserCenterTestApp();
    const db = openDb(dbPath);

    try {
      const user = await createUser("first-message@example.com", "pass123456");
      const session = createSession(user.id);
      const now = new Date().toISOString();

      db.query(
        `insert into wechat_bot_bindings (
          id, user_id, bot_token, bot_id, account_id, user_wx_id, base_url,
          status, bound_at, last_poll_at, last_message_at, created_at, updated_at
        ) values (?, ?, ?, ?, ?, ?, ?, 'active', ?, null, null, ?, ?)`,
      ).run("binding-1", user.id, "token-1", "bot-1", "account-1", "wx-user-1", "https://ilinkai.weixin.qq.com", now, now, now);

      const res = await app.request("http://localhost/me", {
        headers: {
          cookie: `session_id=${session.id}`,
        },
      });
      const html = await res.text();

      expect(res.status).toBe(200);
      expect(html).toContain("新用户请先发一条消息");
      expect(html).toContain("否则平台暂时无法主动给你发消息");
    } finally {
      db.close();
      cleanup();
    }
  });

  test("GET /me 对已经发过首条消息的已绑定用户不再显示提醒", async () => {
    const { app, dbPath, cleanup } = setupUserCenterTestApp();
    const db = openDb(dbPath);

    try {
      const user = await createUser("first-message-done@example.com", "pass123456");
      const session = createSession(user.id);
      const now = new Date().toISOString();

      db.query(
        `insert into wechat_bot_bindings (
          id, user_id, bot_token, bot_id, account_id, user_wx_id, base_url,
          status, bound_at, last_poll_at, last_message_at, created_at, updated_at
        ) values (?, ?, ?, ?, ?, ?, ?, 'active', ?, null, ?, ?, ?)`,
      ).run("binding-2", user.id, "token-2", "bot-2", "account-2", "wx-user-2", "https://ilinkai.weixin.qq.com", now, now, now, now);

      const res = await app.request("http://localhost/me", {
        headers: {
          cookie: `session_id=${session.id}`,
        },
      });
      const html = await res.text();

      expect(res.status).toBe(200);
      expect(html).not.toContain("新用户请先发一条消息");
    } finally {
      db.close();
      cleanup();
    }
  });
});
