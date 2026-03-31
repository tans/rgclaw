import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, test } from "bun:test";
import { runMigrations } from "../../src/db/migrate";
import { openDb } from "../../src/db/sqlite";
import { runWorkersOnce } from "../../src/workers/run";

function setupWorkerRunTestDb() {
  const dir = mkdtempSync(join(tmpdir(), "rgclaw-worker-run-"));
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

describe("worker run entry", () => {
  test("驱动推送任务与续费提醒处理", async () => {
    const { dbPath, cleanup } = setupWorkerRunTestDb();
    const db = openDb(dbPath);

    try {
      db.exec(`
        insert into users (id, email, password_hash, created_at, updated_at)
        values ('u1', 'u1@example.com', 'x', '2026-03-29T00:00:00.000Z', '2026-03-29T00:00:00.000Z');
        insert into user_wechat_bindings (
          id, user_id, bot_id, bot_wechat_user_id, status, bound_at, last_inbound_at, last_context_token, created_at, updated_at
        )
        values ('b1', 'u1', 'bot-1', 'wx1', 'active', '2026-03-29T00:00:00.000Z', '2026-03-29T00:00:00.000Z', 'ctx-1', '2026-03-29T00:00:00.000Z', '2026-03-29T00:00:00.000Z');
        insert into user_source_subscriptions (id, user_id, source, enabled, created_at, updated_at)
        values ('s1', 'u1', 'flap', 1, '2026-03-29T00:00:00.000Z', '2026-03-29T00:00:00.000Z');
        insert into user_entitlements (id, user_id, plan_type, status, starts_at, expires_at, source, created_at, updated_at)
        values ('e1', 'u1', 'trial', 'active', '2026-03-29T00:00:00.000Z', '2099-03-30T00:00:00.000Z', 'trial_signup', '2026-03-29T00:00:00.000Z', '2026-03-29T00:00:00.000Z');
        insert into launch_events (id, source, source_event_id, token_address, symbol, title, event_time, chain, raw_payload, dedupe_key, created_at)
        values ('evt1', 'flap', 'source1', '0xabc', 'DOG', 'DOG 发射', '2026-03-29T00:00:00.000Z', 'bsc', '{}', 'flap:tx:1', '2026-03-29T00:00:00.000Z');
      `);
      db.query("update user_entitlements set expires_at = ? where id = 'e1'").run(
        new Date(Date.now() + 12 * 60 * 60 * 1000).toISOString(),
      );

      const result = await runWorkersOnce();
      const notificationCount = db
        .query("select count(*) as count from notification_jobs")
        .get() as { count: number };
      const messageCount = db
        .query("select count(*) as count from system_message_jobs")
        .get() as { count: number };

      expect(result.notifications).toBe(1);
      expect(result.reminders).toBe(1);
      expect(notificationCount.count).toBe(1);
      expect(messageCount.count).toBe(1);
    } finally {
      db.close();
      cleanup();
    }
  });
});
