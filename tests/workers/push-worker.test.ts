import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, test } from "bun:test";
import { runMigrations } from "../../src/db/migrate";
import { openDb } from "../../src/db/sqlite";
import {
  processLaunchPushes,
  processRenewalReminders,
} from "../../src/workers/push-worker";

function setupPushWorkerTestDb() {
  const dir = mkdtempSync(join(tmpdir(), "rgclaw-push-worker-"));
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

describe("push worker", () => {
  test("为符合条件用户创建微信推送任务", async () => {
    const { dbPath, cleanup } = setupPushWorkerTestDb();
    const db = openDb(dbPath);

    try {
      db.exec(`
        insert into users (id, email, password_hash, created_at, updated_at)
        values ('u1', 'u1@example.com', 'x', '2026-03-29T00:00:00.000Z', '2026-03-29T00:00:00.000Z');
        insert into user_wechat_bindings (id, user_id, wechat_user_id, bind_status, bind_code, bound_at)
        values ('b1', 'u1', 'wx1', 'bound', 'BIND-1', '2026-03-29T00:00:00.000Z');
        insert into user_source_subscriptions (id, user_id, source, enabled, created_at, updated_at)
        values ('s1', 'u1', 'flap', 1, '2026-03-29T00:00:00.000Z', '2026-03-29T00:00:00.000Z');
        insert into user_entitlements (id, user_id, plan_type, status, starts_at, expires_at, source, created_at, updated_at)
        values ('e1', 'u1', 'trial', 'active', '2026-03-29T00:00:00.000Z', '2099-03-30T00:00:00.000Z', 'trial_signup', '2026-03-29T00:00:00.000Z', '2026-03-29T00:00:00.000Z');
        insert into launch_events (id, source, source_event_id, token_address, symbol, title, event_time, chain, raw_payload, dedupe_key, created_at)
        values ('evt1', 'flap', 'source1', '0xabc', 'DOG', 'DOG 发射', '2026-03-29T00:00:00.000Z', 'bsc', '{}', 'flap:tx:1', '2026-03-29T00:00:00.000Z');
      `);

      const count = await processLaunchPushes();
      const row = db
        .query("select launch_event_id, user_id, channel, status from notification_jobs")
        .get() as
        | { launch_event_id: string; user_id: string; channel: string; status: string }
        | null;

      expect(count).toBe(1);
      expect(row?.launch_event_id).toBe("evt1");
      expect(row?.user_id).toBe("u1");
      expect(row?.channel).toBe("wechat");
      expect(row?.status).toBe("pending");
    } finally {
      db.close();
      cleanup();
    }
  });

  test("到期前一天生成一次续费提醒", async () => {
    const { dbPath, cleanup } = setupPushWorkerTestDb();
    const db = openDb(dbPath);

    try {
      db.exec(`
        insert into users (id, email, password_hash, created_at, updated_at)
        values ('u1', 'u1@example.com', 'x', '2026-03-29T00:00:00.000Z', '2026-03-29T00:00:00.000Z');
        insert into user_entitlements (id, user_id, plan_type, status, starts_at, expires_at, source, created_at, updated_at)
        values ('e1', 'u1', 'trial', 'active', '2026-03-29T00:00:00.000Z', '2099-03-30T00:00:00.000Z', 'trial_signup', '2026-03-29T00:00:00.000Z', '2026-03-29T00:00:00.000Z');
      `);
      db.query("update user_entitlements set expires_at = ? where id = 'e1'").run(
        new Date(Date.now() + 12 * 60 * 60 * 1000).toISOString(),
      );

      const count = await processRenewalReminders();
      const row = db
        .query("select user_id, message_type, payload, status from system_message_jobs")
        .get() as
        | { user_id: string; message_type: string; payload: string; status: string }
        | null;
      const reminder = db
        .query("select renewal_reminded_at from user_entitlements where id = 'e1'")
        .get() as { renewal_reminded_at: string | null } | null;

      expect(count).toBe(1);
      expect(row?.user_id).toBe("u1");
      expect(row?.message_type).toBe("renewal_reminder");
      expect(row?.payload).toContain("到期");
      expect(row?.status).toBe("pending");
      expect(reminder?.renewal_reminded_at).toBeTruthy();
    } finally {
      db.close();
      cleanup();
    }
  });
});
