import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, test } from "bun:test";
import {
  claimPendingNotificationJobs,
  claimPendingSystemMessageJobs,
} from "../../src/db/repositories/notification-jobs";
import { runMigrations } from "../../src/db/migrate";
import { openDb } from "../../src/db/sqlite";
import {
  dispatchPendingNotificationMessages,
  dispatchPendingSystemMessages,
  enqueueKeepaliveReminders,
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
      delete process.env.WECHAT_BOT_API_BASE_URL;
      delete process.env.WECHAT_BOT_API_TOKEN;
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

  test("派发 system_message_jobs 后标记 sent 并刷新绑定 outbound 时间", async () => {
    const { dbPath, cleanup } = setupPushWorkerTestDb();
    const db = openDb(dbPath);
    const requests: Array<{ path: string; body: Record<string, unknown> }> = [];
    const server = Bun.serve({
      port: 0,
      fetch: async (request) => {
        requests.push({
          path: new URL(request.url).pathname,
          body: (await request.json()) as Record<string, unknown>,
        });
        return Response.json({ code: 200, message: "OK" });
      },
    });
    process.env.WECHAT_BOT_API_BASE_URL = `http://127.0.0.1:${server.port}`;
    process.env.WECHAT_BOT_API_TOKEN = "test-token";

    try {
      db.exec(`
        insert into users (id, email, password_hash, created_at, updated_at)
        values ('u1', 'u1@example.com', 'x', '2026-03-29T00:00:00.000Z', '2026-03-29T00:00:00.000Z');
        insert into user_wechat_bindings (
          id, user_id, bot_id, bot_wechat_user_id, status, bound_at, last_inbound_at, last_outbound_at, last_context_token, created_at, updated_at
        )
        values ('b1', 'u1', 'bot-1', 'wx1', 'active', '2026-03-29T00:00:00.000Z', '2026-03-29T00:00:00.000Z', '2026-03-29T02:00:00.000Z', 'ctx-1', '2026-03-29T00:00:00.000Z', '2026-03-29T00:00:00.000Z');
        insert into system_message_jobs (id, user_id, message_type, payload, status, attempt_count, created_at)
        values ('sm1', 'u1', 'auto_reply', '查询和狙击功能开发中', 'pending', 0, '2026-03-29T03:00:00.000Z');
      `);

      const sent = await dispatchPendingSystemMessages();
      const job = db
        .query(
          "select status, attempt_count, sent_at, last_error from system_message_jobs where id = 'sm1'",
        )
        .get() as
        | { status: string; attempt_count: number; sent_at: string | null; last_error: string | null }
        | null;
      const binding = db
        .query(
          "select last_outbound_at, last_keepalive_sent_at from user_wechat_bindings where id = 'b1'",
        )
        .get() as { last_outbound_at: string | null; last_keepalive_sent_at: string | null } | null;

      expect(sent).toBe(1);
      expect(requests).toHaveLength(1);
      expect(requests[0].path).toBe("/bots/bot-1/messages");
      expect(requests[0].body).toEqual({
        text: "查询和狙击功能开发中",
        toUserId: "wx1",
        contextToken: "ctx-1",
      });
      expect(job?.status).toBe("sent");
      expect(job?.attempt_count).toBe(0);
      expect(job?.sent_at).toBeTruthy();
      expect(job?.last_error).toBeNull();
      expect(binding?.last_outbound_at).toBeTruthy();
      expect(binding?.last_keepalive_sent_at).toBeNull();
    } finally {
      server.stop(true);
      db.close();
      cleanup();
    }
  });

  test("keepalive 发送成功会更新 last_keepalive_sent_at", async () => {
    const { dbPath, cleanup } = setupPushWorkerTestDb();
    const db = openDb(dbPath);
    const server = Bun.serve({
      port: 0,
      fetch: async () => Response.json({ code: 200, message: "OK" }),
    });
    process.env.WECHAT_BOT_API_BASE_URL = `http://127.0.0.1:${server.port}`;
    process.env.WECHAT_BOT_API_TOKEN = "test-token";

    try {
      db.exec(`
        insert into users (id, email, password_hash, created_at, updated_at)
        values ('u1', 'u1@example.com', 'x', '2026-03-29T00:00:00.000Z', '2026-03-29T00:00:00.000Z');
        insert into user_wechat_bindings (
          id, user_id, bot_id, bot_wechat_user_id, status, bound_at, last_inbound_at, last_outbound_at, last_context_token, created_at, updated_at
        )
        values ('b1', 'u1', 'bot-1', 'wx1', 'active', '2026-03-29T00:00:00.000Z', '2026-03-29T00:00:00.000Z', '2026-03-29T02:00:00.000Z', 'ctx-1', '2026-03-29T00:00:00.000Z', '2026-03-29T00:00:00.000Z');
        insert into system_message_jobs (id, user_id, message_type, payload, status, attempt_count, created_at)
        values ('sm1', 'u1', 'keepalive', '为保持通知能力，请回复任意消息。', 'pending', 0, '2026-03-29T03:00:00.000Z');
      `);

      const sent = await dispatchPendingSystemMessages();
      const binding = db
        .query("select last_keepalive_sent_at from user_wechat_bindings where id = 'b1'")
        .get() as { last_keepalive_sent_at: string | null } | null;

      expect(sent).toBe(1);
      expect(binding?.last_keepalive_sent_at).toBeTruthy();
    } finally {
      server.stop(true);
      db.close();
      cleanup();
    }
  });

  test("已 claim 的 system_message_jobs 不会被重复派发", async () => {
    const { dbPath, cleanup } = setupPushWorkerTestDb();
    const db = openDb(dbPath);
    let sendCount = 0;

    try {
      db.exec(`
        insert into users (id, email, password_hash, created_at, updated_at)
        values ('u1', 'u1@example.com', 'x', '2026-03-29T00:00:00.000Z', '2026-03-29T00:00:00.000Z');
        insert into user_wechat_bindings (
          id, user_id, bot_id, bot_wechat_user_id, status, bound_at, last_inbound_at, last_context_token, created_at, updated_at
        )
        values ('b1', 'u1', 'bot-1', 'wx1', 'active', '2026-03-29T00:00:00.000Z', '2026-03-29T00:00:00.000Z', 'ctx-1', '2026-03-29T00:00:00.000Z', '2026-03-29T00:00:00.000Z');
        insert into system_message_jobs (id, user_id, message_type, payload, status, attempt_count, created_at)
        values ('sm1', 'u1', 'auto_reply', '查询和狙击功能开发中', 'pending', 0, '2026-03-29T03:00:00.000Z');
      `);

      expect(claimPendingSystemMessageJobs()).toHaveLength(1);
      expect(await dispatchPendingSystemMessages({
        sendMessage: async () => {
          sendCount += 1;
          return { ok: true };
        },
      })).toBe(0);

      const job = db
        .query("select status from system_message_jobs where id = 'sm1'")
        .get() as { status: string } | null;
      expect(sendCount).toBe(0);
      expect(job?.status).toBe("processing");
    } finally {
      db.close();
      cleanup();
    }
  });

  test("派发失败会重试并在第三次失败标记 failed", async () => {
    const { dbPath, cleanup } = setupPushWorkerTestDb();
    const db = openDb(dbPath);
    const server = Bun.serve({
      port: 0,
      fetch: async () => new Response("bad gateway", { status: 502 }),
    });
    process.env.WECHAT_BOT_API_BASE_URL = `http://127.0.0.1:${server.port}`;
    process.env.WECHAT_BOT_API_TOKEN = "test-token";

    try {
      db.exec(`
        insert into users (id, email, password_hash, created_at, updated_at)
        values ('u1', 'u1@example.com', 'x', '2026-03-29T00:00:00.000Z', '2026-03-29T00:00:00.000Z');
        insert into user_wechat_bindings (
          id, user_id, bot_id, bot_wechat_user_id, status, bound_at, last_inbound_at, last_context_token, created_at, updated_at
        )
        values ('b1', 'u1', 'bot-1', 'wx1', 'active', '2026-03-29T00:00:00.000Z', '2026-03-29T00:00:00.000Z', 'ctx-1', '2026-03-29T00:00:00.000Z', '2026-03-29T00:00:00.000Z');
        insert into system_message_jobs (id, user_id, message_type, payload, status, attempt_count, created_at)
        values ('sm1', 'u1', 'auto_reply', '查询和狙击功能开发中', 'pending', 0, '2026-03-29T03:00:00.000Z');
      `);

      expect(await dispatchPendingSystemMessages()).toBe(0);
      let job = db
        .query("select status, attempt_count, last_error from system_message_jobs where id = 'sm1'")
        .get() as { status: string; attempt_count: number; last_error: string | null };
      expect(job.status).toBe("pending");
      expect(job.attempt_count).toBe(1);
      expect(job.last_error).toContain("502");

      expect(await dispatchPendingSystemMessages()).toBe(0);
      job = db
        .query("select status, attempt_count, last_error from system_message_jobs where id = 'sm1'")
        .get() as { status: string; attempt_count: number; last_error: string | null };
      expect(job.status).toBe("pending");
      expect(job.attempt_count).toBe(2);

      expect(await dispatchPendingSystemMessages()).toBe(0);
      job = db
        .query("select status, attempt_count, last_error from system_message_jobs where id = 'sm1'")
        .get() as { status: string; attempt_count: number; last_error: string | null };
      expect(job.status).toBe("failed");
      expect(job.attempt_count).toBe(3);
      expect(job.last_error).toContain("502");
    } finally {
      server.stop(true);
      db.close();
      cleanup();
    }
  });

  test("派发 notification_jobs 使用 active binding 和 launch 内容并标记 sent", async () => {
    const { dbPath, cleanup } = setupPushWorkerTestDb();
    const db = openDb(dbPath);
    const requests: Array<Record<string, unknown>> = [];
    const server = Bun.serve({
      port: 0,
      fetch: async (request) => {
        requests.push((await request.json()) as Record<string, unknown>);
        return Response.json({ code: 200, message: "OK" });
      },
    });
    process.env.WECHAT_BOT_API_BASE_URL = `http://127.0.0.1:${server.port}`;
    process.env.WECHAT_BOT_API_TOKEN = "test-token";

    try {
      db.exec(`
        insert into users (id, email, password_hash, created_at, updated_at)
        values ('u1', 'u1@example.com', 'x', '2026-03-29T00:00:00.000Z', '2026-03-29T00:00:00.000Z');
        insert into user_wechat_bindings (
          id, user_id, bot_id, bot_wechat_user_id, status, bound_at, last_inbound_at, last_context_token, created_at, updated_at
        )
        values ('b1', 'u1', 'bot-1', 'wx1', 'active', '2026-03-29T00:00:00.000Z', '2026-03-29T00:00:00.000Z', 'ctx-1', '2026-03-29T00:00:00.000Z', '2026-03-29T00:00:00.000Z');
        insert into launch_events (id, source, source_event_id, token_address, symbol, title, event_time, chain, raw_payload, dedupe_key, created_at)
        values ('evt1', 'flap', 'source1', '0xabc', 'DOG', 'DOG 发射', '2026-03-29T00:00:00.000Z', 'bsc', '{}', 'flap:tx:1', '2026-03-29T00:00:00.000Z');
        insert into notification_jobs (id, launch_event_id, user_id, channel, status, attempt_count, created_at)
        values ('nj1', 'evt1', 'u1', 'wechat', 'pending', 0, '2026-03-29T03:00:00.000Z');
      `);

      const sent = await dispatchPendingNotificationMessages();
      const job = db
        .query("select status, sent_at from notification_jobs where id = 'nj1'")
        .get() as { status: string; sent_at: string | null } | null;

      expect(sent).toBe(1);
      expect(requests).toHaveLength(1);
      expect(requests[0]).toEqual({
        text: "DOG 发射\n0xabc",
        toUserId: "wx1",
        contextToken: "ctx-1",
      });
      expect(job?.status).toBe("sent");
      expect(job?.sent_at).toBeTruthy();
    } finally {
      server.stop(true);
      db.close();
      cleanup();
    }
  });

  test("notification_jobs 派发失败会重试并在第三次失败标记 failed", async () => {
    const { dbPath, cleanup } = setupPushWorkerTestDb();
    const db = openDb(dbPath);
    const server = Bun.serve({
      port: 0,
      fetch: async () => new Response("bad gateway", { status: 502 }),
    });
    process.env.WECHAT_BOT_API_BASE_URL = `http://127.0.0.1:${server.port}`;
    process.env.WECHAT_BOT_API_TOKEN = "test-token";

    try {
      db.exec(`
        insert into users (id, email, password_hash, created_at, updated_at)
        values ('u1', 'u1@example.com', 'x', '2026-03-29T00:00:00.000Z', '2026-03-29T00:00:00.000Z');
        insert into user_wechat_bindings (
          id, user_id, bot_id, bot_wechat_user_id, status, bound_at, last_inbound_at, last_context_token, created_at, updated_at
        )
        values ('b1', 'u1', 'bot-1', 'wx1', 'active', '2026-03-29T00:00:00.000Z', '2026-03-29T00:00:00.000Z', 'ctx-1', '2026-03-29T00:00:00.000Z', '2026-03-29T00:00:00.000Z');
        insert into launch_events (id, source, source_event_id, token_address, symbol, title, event_time, chain, raw_payload, dedupe_key, created_at)
        values ('evt1', 'flap', 'source1', '0xabc', 'DOG', 'DOG 发射', '2026-03-29T00:00:00.000Z', 'bsc', '{}', 'flap:tx:1', '2026-03-29T00:00:00.000Z');
        insert into notification_jobs (id, launch_event_id, user_id, channel, status, attempt_count, created_at)
        values ('nj1', 'evt1', 'u1', 'wechat', 'pending', 0, '2026-03-29T03:00:00.000Z');
      `);

      expect(await dispatchPendingNotificationMessages()).toBe(0);
      let job = db
        .query("select status, attempt_count, last_error from notification_jobs where id = 'nj1'")
        .get() as { status: string; attempt_count: number; last_error: string | null };
      expect(job.status).toBe("pending");
      expect(job.attempt_count).toBe(1);
      expect(job.last_error).toContain("502");

      expect(await dispatchPendingNotificationMessages()).toBe(0);
      job = db
        .query("select status, attempt_count, last_error from notification_jobs where id = 'nj1'")
        .get() as { status: string; attempt_count: number; last_error: string | null };
      expect(job.status).toBe("pending");
      expect(job.attempt_count).toBe(2);

      expect(await dispatchPendingNotificationMessages()).toBe(0);
      job = db
        .query("select status, attempt_count, last_error from notification_jobs where id = 'nj1'")
        .get() as { status: string; attempt_count: number; last_error: string | null };
      expect(job.status).toBe("failed");
      expect(job.attempt_count).toBe(3);
      expect(job.last_error).toContain("502");
    } finally {
      server.stop(true);
      db.close();
      cleanup();
    }
  });

  test("已 claim 的 notification_jobs 不会被重复派发", async () => {
    const { dbPath, cleanup } = setupPushWorkerTestDb();
    const db = openDb(dbPath);
    let sendCount = 0;

    try {
      db.exec(`
        insert into users (id, email, password_hash, created_at, updated_at)
        values ('u1', 'u1@example.com', 'x', '2026-03-29T00:00:00.000Z', '2026-03-29T00:00:00.000Z');
        insert into user_wechat_bindings (
          id, user_id, bot_id, bot_wechat_user_id, status, bound_at, last_inbound_at, last_context_token, created_at, updated_at
        )
        values ('b1', 'u1', 'bot-1', 'wx1', 'active', '2026-03-29T00:00:00.000Z', '2026-03-29T00:00:00.000Z', 'ctx-1', '2026-03-29T00:00:00.000Z', '2026-03-29T00:00:00.000Z');
        insert into launch_events (id, source, source_event_id, token_address, symbol, title, event_time, chain, raw_payload, dedupe_key, created_at)
        values ('evt1', 'flap', 'source1', '0xabc', 'DOG', 'DOG 发射', '2026-03-29T00:00:00.000Z', 'bsc', '{}', 'flap:tx:1', '2026-03-29T00:00:00.000Z');
        insert into notification_jobs (id, launch_event_id, user_id, channel, status, attempt_count, created_at)
        values ('nj1', 'evt1', 'u1', 'wechat', 'pending', 0, '2026-03-29T03:00:00.000Z');
      `);

      expect(claimPendingNotificationJobs()).toHaveLength(1);
      expect(await dispatchPendingNotificationMessages({
        sendMessage: async () => {
          sendCount += 1;
          return { ok: true };
        },
      })).toBe(0);

      const job = db
        .query("select status from notification_jobs where id = 'nj1'")
        .get() as { status: string } | null;
      expect(sendCount).toBe(0);
      expect(job?.status).toBe("processing");
    } finally {
      db.close();
      cleanup();
    }
  });

  test("仅为 18-19 小时窗口内且满足资格的绑定创建 keepalive", async () => {
    const { dbPath, cleanup } = setupPushWorkerTestDb();
    const db = openDb(dbPath);

    try {
      db.exec(`
        insert into users (id, email, password_hash, created_at, updated_at)
        values
          ('u1', 'u1@example.com', 'x', '2026-03-29T00:00:00.000Z', '2026-03-29T00:00:00.000Z'),
          ('u2', 'u2@example.com', 'x', '2026-03-29T00:00:00.000Z', '2026-03-29T00:00:00.000Z'),
          ('u3', 'u3@example.com', 'x', '2026-03-29T00:00:00.000Z', '2026-03-29T00:00:00.000Z');
        insert into user_wechat_bindings (
          id, user_id, bot_id, bot_wechat_user_id, status, bound_at, last_inbound_at, last_outbound_at, last_context_token, created_at, updated_at
        )
        values
          ('b1', 'u1', 'bot-1', 'wx1', 'active', '2026-03-29T00:00:00.000Z', '2026-03-29T00:00:00.000Z', '2026-03-30T17:30:00.000Z', 'ctx-1', '2026-03-29T00:00:00.000Z', '2026-03-29T00:00:00.000Z'),
          ('b2', 'u2', 'bot-2', 'wx2', 'active', '2026-03-29T00:00:00.000Z', '2026-03-29T00:00:00.000Z', '2026-03-30T17:59:59.000Z', 'ctx-2', '2026-03-29T00:00:00.000Z', '2026-03-29T00:00:00.000Z'),
          ('b3', 'u3', 'bot-3', 'wx3', 'active', '2026-03-29T00:00:00.000Z', '2026-03-29T00:00:00.000Z', '2026-03-30T16:30:00.000Z', 'ctx-3', '2026-03-29T00:00:00.000Z', '2026-03-29T00:00:00.000Z');
        insert into user_source_subscriptions (id, user_id, source, enabled, created_at, updated_at)
        values
          ('s1', 'u1', 'flap', 1, '2026-03-29T00:00:00.000Z', '2026-03-29T00:00:00.000Z'),
          ('s2', 'u2', 'flap', 0, '2026-03-29T00:00:00.000Z', '2026-03-29T00:00:00.000Z'),
          ('s3', 'u3', 'flap', 1, '2026-03-29T00:00:00.000Z', '2026-03-29T00:00:00.000Z');
        insert into user_entitlements (id, user_id, plan_type, status, starts_at, expires_at, source, created_at, updated_at)
        values
          ('e1', 'u1', 'trial', 'active', '2026-03-29T00:00:00.000Z', '2099-03-30T00:00:00.000Z', 'trial_signup', '2026-03-29T00:00:00.000Z', '2026-03-29T00:00:00.000Z'),
          ('e2', 'u2', 'trial', 'active', '2026-03-29T00:00:00.000Z', '2099-03-30T00:00:00.000Z', 'trial_signup', '2026-03-29T00:00:00.000Z', '2026-03-29T00:00:00.000Z'),
          ('e3', 'u3', 'trial', 'active', '2026-03-29T00:00:00.000Z', '2099-03-30T00:00:00.000Z', 'trial_signup', '2026-03-29T00:00:00.000Z', '2026-03-29T00:00:00.000Z');
      `);

      const count = await enqueueKeepaliveReminders("2026-03-31T12:00:00.000Z");
      const rows = db
        .query(
          "select user_id, message_type, payload from system_message_jobs where message_type = 'keepalive' order by user_id asc",
        )
        .all() as Array<{ user_id: string; message_type: string; payload: string }>;

      expect(count).toBe(1);
      expect(rows).toEqual([
        {
          user_id: "u1",
          message_type: "keepalive",
          payload: "为保持通知能力，请回复任意消息。",
        },
      ]);
    } finally {
      db.close();
      cleanup();
    }
  });
});
