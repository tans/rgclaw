import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, test } from "bun:test";
import { createSession } from "../../src/db/repositories/sessions";
import { createUser } from "../../src/db/repositories/users";
import { createApp } from "../../src/server/app";

function setupWechatBindingTestApp() {
  const dir = mkdtempSync(join(tmpdir(), "rgclaw-wechat-binding-"));
  const dbPath = join(dir, "app.sqlite");
  process.env.DATABASE_PATH = dbPath;

  return {
    app: createApp(),
    cleanup() {
      rmSync(dir, { recursive: true, force: true });
      delete process.env.DATABASE_PATH;
    },
  };
}

describe("wechat binding", () => {
  test("微信绑定成功后发放 3 天试用", async () => {
    const { app, cleanup } = setupWechatBindingTestApp();

    try {
      const user = await createUser("wechat@example.com", "pass123456");
      const session = createSession(user.id);

      const bindPage = await app.request("http://localhost/me", {
        headers: {
          cookie: `session_id=${session.id}`,
        },
      });
      const bindPageHtml = await bindPage.text();
      const bindCode = bindPageHtml.match(/BIND-[A-Z0-9-]+/)?.[0];

      expect(bindPageHtml).toContain("绑定码");
      expect(bindCode).toBeTruthy();

      const callbackRes = await app.request("http://localhost/wechat/callback", {
        method: "POST",
        headers: {
          "content-type": "application/json",
        },
        body: JSON.stringify({
          bindCode,
          wechatUserId: "wx-user-1",
        }),
      });

      expect(callbackRes.status).toBe(200);

      const meRes = await app.request("http://localhost/me", {
        headers: {
          cookie: `session_id=${session.id}`,
        },
      });
      const html = await meRes.text();

      expect(html).toContain("已绑定");
      expect(html).toContain("3 天试用");
    } finally {
      cleanup();
    }
  });
});
