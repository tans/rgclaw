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
      db.query("update users set wallet_address = ?, updated_at = ? where id = ?").run(
        "0xabc123",
        new Date().toISOString(),
        user.id,
      );
      const session = createSession(user.id);

      const res = await app.request("http://localhost/me", {
        headers: {
          cookie: `session_id=${session.id}`,
        },
      });
      const html = await res.text();

      expect(res.status).toBe(200);
      expect(html).toContain("钱包地址");
      expect(html).toContain("0xabc123");
      expect(html).toContain("four");
      expect(html).toContain("flap");
    } finally {
      db.close();
      cleanup();
    }
  });
});
