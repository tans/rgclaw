import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, test } from "bun:test";
import {
  findActiveBindingByConversation,
  findActiveBindingByUserId,
  replaceActiveWechatBinding,
} from "../../src/db/repositories/wechat-bindings";
import { runMigrations } from "../../src/db/migrate";
import { openDb } from "../../src/db/sqlite";

function setupWechatBindingsTestDb() {
  const dir = mkdtempSync(join(tmpdir(), "rgclaw-wechat-bindings-"));
  const dbPath = join(dir, "app.sqlite");
  process.env.DATABASE_PATH = dbPath;
  runMigrations(dbPath);

  return {
    dbPath,
    cleanup() {
      rmSync(dir, { recursive: true, force: true });
      delete process.env.DATABASE_PATH;
    },
  };
}

describe("wechat bindings repository", () => {
  test("replaceActiveWechatBinding 保持用户和会话都只有一条 active 记录", () => {
    const { dbPath, cleanup } = setupWechatBindingsTestDb();
    const db = openDb(dbPath);

    try {
      db.exec(`
        insert into users (id, email, password_hash, created_at, updated_at)
        values
          ('u1', 'u1@example.com', 'x', '2026-03-31T00:00:00.000Z', '2026-03-31T00:00:00.000Z'),
          ('u2', 'u2@example.com', 'x', '2026-03-31T00:00:00.000Z', '2026-03-31T00:00:00.000Z');
      `);

      replaceActiveWechatBinding({
        userId: "u1",
        botId: "bot-a",
        botWechatUserId: "wx-a",
        contextToken: "ctx-1",
        now: "2026-03-31T00:00:00.000Z",
      });

      replaceActiveWechatBinding({
        userId: "u1",
        botId: "bot-b",
        botWechatUserId: "wx-b",
        contextToken: "ctx-2",
        now: "2026-03-31T01:00:00.000Z",
      });

      replaceActiveWechatBinding({
        userId: "u2",
        botId: "bot-b",
        botWechatUserId: "wx-b",
        contextToken: "ctx-3",
        now: "2026-03-31T02:00:00.000Z",
      });

      const activeForUser1 = findActiveBindingByUserId("u1");
      const activeForUser2 = findActiveBindingByUserId("u2");
      const activeForConversation = findActiveBindingByConversation("bot-b", "wx-b");
      const rows = db
        .query(
          "select user_id, bot_id, bot_wechat_user_id, status, unbound_at, last_context_token from user_wechat_bindings order by created_at asc",
        )
        .all() as Array<{
        user_id: string;
        bot_id: string;
        bot_wechat_user_id: string;
        status: string;
        unbound_at: string | null;
        last_context_token: string | null;
      }>;

      expect(activeForUser1).toBeNull();

      expect(activeForUser2?.bot_id).toBe("bot-b");
      expect(activeForUser2?.bot_wechat_user_id).toBe("wx-b");
      expect(activeForUser2?.last_context_token).toBe("ctx-3");

      expect(activeForConversation?.user_id).toBe("u2");
      expect(rows).toHaveLength(3);
      expect(rows[0]?.status).toBe("inactive");
      expect(rows[0]?.unbound_at).toBe("2026-03-31T01:00:00.000Z");
      expect(rows[1]?.status).toBe("inactive");
      expect(rows[1]?.unbound_at).toBe("2026-03-31T02:00:00.000Z");
      expect(rows[2]).toMatchObject({
        user_id: "u2",
        bot_id: "bot-b",
        bot_wechat_user_id: "wx-b",
        status: "active",
        last_context_token: "ctx-3",
      });
    } finally {
      db.close();
      cleanup();
    }
  });
});
