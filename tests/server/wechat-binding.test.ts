import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, test } from "bun:test";
import { createSession } from "../../src/db/repositories/sessions";
import { createUser } from "../../src/db/repositories/users";
import { openDb } from "../../src/db/sqlite";
import { createApp } from "../../src/server/app";

function setupWechatBindingTestApp() {
  const dir = mkdtempSync(join(tmpdir(), "rgclaw-wechat-binding-"));
  const dbPath = join(dir, "app.sqlite");
  process.env.DATABASE_PATH = dbPath;
  process.env.WECHAT_BIND_SECRET = "test-bind-secret";
  process.env.WECHAT_CALLBACK_ALLOWLIST = "127.0.0.1";

  return {
    app: createApp(),
    dbPath,
    cleanup() {
      rmSync(dir, { recursive: true, force: true });
      delete process.env.DATABASE_PATH;
      delete process.env.WECHAT_BIND_SECRET;
      delete process.env.WECHAT_CALLBACK_ALLOWLIST;
    },
  };
}

describe("wechat binding", () => {
  test("微信绑定成功后发放 3 天试用", async () => {
    const { app, dbPath, cleanup } = setupWechatBindingTestApp();
    const db = openDb(dbPath);

    try {
      const user = await createUser("wechat@example.com", "pass123456");
      const session = createSession(user.id);

      const bindPage = await app.request("http://localhost/me", {
        headers: {
          cookie: `session_id=${session.id}`,
        },
      });
      const bindPageHtml = await bindPage.text();
      const bindCode = bindPageHtml.match(/uid:[^<\s]+/)?.[0];

      expect(bindPageHtml).toContain("绑定码");
      expect(bindPageHtml).toContain(user.id);
      expect(bindCode).toBeTruthy();

      const callbackRes = await app.request("http://localhost/wechat/callback", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-forwarded-for": "127.0.0.1",
        },
        body: JSON.stringify({
          botId: "bot-1",
          fromUserId: "wx-user-1",
          text: bindCode,
          contextToken: "ctx-1",
          messageId: "msg-1",
          receivedAt: "2026-03-31T00:00:00.000Z",
          rawPayload: {
            messageId: "msg-1",
          },
        }),
      });

      expect(callbackRes.status).toBe(200);
      expect(await callbackRes.json()).toEqual({ ok: true, action: "bound" });

      const meRes = await app.request("http://localhost/me", {
        headers: {
          cookie: `session_id=${session.id}`,
        },
      });
      const html = await meRes.text();

      expect(html).toContain("已绑定");
      expect(html).toContain("3 天试用");

      const binding = db
        .query(
          "select bot_id, bot_wechat_user_id, status, last_context_token from user_wechat_bindings where user_id = ? and status = 'active'",
        )
        .get(user.id) as
        | {
            bot_id: string;
            bot_wechat_user_id: string;
            status: string;
            last_context_token: string | null;
          }
        | null;

      expect(binding).toEqual({
        bot_id: "bot-1",
        bot_wechat_user_id: "wx-user-1",
        status: "active",
        last_context_token: "ctx-1",
      });

      const duplicateRes = await app.request("http://localhost/wechat/callback", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-forwarded-for": "127.0.0.1",
        },
        body: JSON.stringify({
          botId: "bot-1",
          fromUserId: "wx-user-1",
          text: bindCode,
          contextToken: "ctx-1",
          messageId: "msg-1",
          receivedAt: "2026-03-31T00:00:00.000Z",
          rawPayload: {
            messageId: "msg-1",
          },
        }),
      });

      expect(duplicateRes.status).toBe(200);
      expect(await duplicateRes.json()).toEqual({ ok: true, duplicate: true });

      const bindingCount = db
        .query("select count(*) as count from user_wechat_bindings where user_id = ?")
        .get(user.id) as { count: number };
      expect(bindingCount.count).toBe(1);
    } finally {
      db.close();
      cleanup();
    }
  });
});
