import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, test } from "bun:test";
import { createSession } from "../../src/db/repositories/sessions";
import { createUser } from "../../src/db/repositories/users";
import { openDb } from "../../src/db/sqlite";
import { createApp } from "../../src/server/app";
import { clearQRStatus, setQRStatusForTesting } from "../../src/services/wechatbot-service";

function setupWechatDirectTestApp() {
  const dir = mkdtempSync(join(tmpdir(), "rgclaw-wechat-direct-"));
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

describe("wechat direct routes", () => {
  test("GET /wechat/direct/qr/status 在扫码确认后返回 /me 跳转", async () => {
    const { app, dbPath, cleanup } = setupWechatDirectTestApp();
    const db = openDb(dbPath);
    let userId = "";

    try {
      const user = await createUser("wechat-direct@example.com", "pass123456");
      userId = user.id;
      const session = createSession(user.id);

      setQRStatusForTesting(user.id, {
        status: "confirmed",
        credentials: {
          botToken: "token-1",
          botId: "bot-1",
          accountId: "account-1",
          userWxId: "wx-user-1",
          baseUrl: "https://ilinkai.weixin.qq.com",
        },
      });

      const res = await app.request("http://localhost/wechat/direct/qr/status", {
        headers: {
          cookie: `session_id=${session.id}`,
        },
      });

      expect(res.status).toBe(200);
      expect(await res.json()).toEqual({
        status: "bound",
        redirect: "/me?bound=1",
      });

      const binding = db
        .query("select user_id, status from wechat_bot_bindings where user_id = ?")
        .get(user.id) as { user_id: string; status: string } | null;
      expect(binding).toEqual({
        user_id: user.id,
        status: "active",
      });
    } finally {
      clearQRStatus(userId);
      db.close();
      cleanup();
    }
  });
});
