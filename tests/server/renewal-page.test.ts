import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, test } from "bun:test";
import { createSession } from "../../src/db/repositories/sessions";
import { createUser } from "../../src/db/repositories/users";
import { openDb } from "../../src/db/sqlite";
import { createApp } from "../../src/server/app";

function setupRenewalPageTestApp() {
  const dir = mkdtempSync(join(tmpdir(), "rgclaw-renewal-page-"));
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

describe("renewal page", () => {
  test("续费页展示固定收款地址和价格", async () => {
    const { app, dbPath, cleanup } = setupRenewalPageTestApp();
    const db = openDb(dbPath);

    try {
      const user = await createUser("renew@example.com", "pass123456");
      const session = createSession(user.id);
      db.query("update users set wallet_address = ?, updated_at = ? where id = ?").run(
        "0xuserwallet",
        new Date().toISOString(),
        user.id,
      );

      const res = await app.request("http://localhost/renew", {
        headers: {
          cookie: `session_id=${session.id}`,
        },
      });
      const html = await res.text();

      expect(res.status).toBe(200);
      expect(html).toContain("0xaCEa067c6751083e4e652543A436638c1e777777");
      expect(html).toContain("0.005 BNB / 30 天");
      expect(html).toContain("0xuserwallet");
    } finally {
      db.close();
      cleanup();
    }
  });
});
