import { runMigrations } from "../db/migrate";
import { openDb } from "../db/sqlite";
import { createApp } from "./app";
import { bootstrapDirectWeChatBots, sendMessage } from "../services/wechatbot-service";

console.log("[startup] Starting regouapp-web...");
console.log("[startup] PORT:", process.env.PORT);
console.log("[startup] DATABASE_PATH:", process.env.DATABASE_PATH);

console.log("[startup] Running migrations...");
runMigrations(process.env.DATABASE_PATH);
console.log("[startup] Migrations done");

console.log("[startup] Creating app...");
const app = createApp();
console.log("[startup] App created");

const port = Number(process.env.PORT ?? 3000);
console.log(`[startup] Starting Bun.serve on port ${port}...`);

const server = Bun.serve({
  port,
  fetch: app.fetch,
  idleTimeout: 120,
});

console.log(`[startup] Bun.serve started, hostname=${server.hostname}, port=${server.port}`);

// Bootstrap direct WeChat bots for all active bindings
bootstrapDirectWeChatBots().catch((err) => {
  console.error("[startup] bootstrapDirectWeChatBots failed:", err);
});

// Poll pending WeChat sends queue every 10s and dispatch via active bots
const SEND_QUEUE_POLL_MS = 10_000;
setInterval(() => {
  (async () => {
    const {
      claimPendingWechatSends,
      markWechatSendSent,
      markWechatSendFailed,
      markNotificationJobDone,
    } = await import("../db/repositories/notification-jobs.js");
    const { findActiveBindingByWxId } = await import(
      "../db/repositories/wechat-bot-bindings.js"
    );

    const pending = claimPendingWechatSends(200);
    for (const send of pending) {
      const binding = findActiveBindingByWxId(send.user_wx_id);
      if (!binding) {
        console.log(
          `[sendq] SKIP no binding user_wx_id=${send.user_wx_id} send=${send.id}`,
        );
        markWechatSendFailed(send.id, "binding missing");
        continue;
      }
      try {
        await sendMessage(binding, send.user_wx_id, send.content);
        markWechatSendSent(send.id, send.notification_job_id);
        if (send.notification_job_id) {
          markNotificationJobDone(send.notification_job_id);
        }
        console.log(
          `[sendq] SENT send=${send.id} binding=${binding.id} user_wx_id=${send.user_wx_id}`,
        );
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        if (msg.startsWith("WECHAT_BOT_INACTIVE")) {
          // Bot inactive — reset to pending for next poll cycle to retry
          const rdb = openDb();
          rdb.query(
            "update pending_wechat_sends set status = 'pending' where id = ?",
          ).run(send.id);
          rdb.close();
          console.log(
            `[sendq] BOT_INACTIVE send=${send.id} binding=${binding.id}, will retry`,
          );
        } else if (msg.includes("ret=-2") || msg.includes("API error ret=")) {
          // External bot API permanently unavailable — do not retry
          markWechatSendFailed(send.id, msg);
          console.log(`[sendq] BOT_API_PERMANENT send=${send.id} ret=-2, giving up`);
        } else {
          // Bot inactive — reset to pending for next poll cycle to retry
          const rdb = openDb();
          rdb.query(
            "update pending_wechat_sends set status = 'pending' where id = ?",
          ).run(send.id);
          rdb.close();
          console.log(
            `[sendq] BOT_INACTIVE send=${send.id} binding=${binding.id}, will retry`,
          );
        } else {
          markWechatSendFailed(send.id, msg);
          console.log(`[sendq] FAIL send=${send.id} error=${msg}`);
        }
      }
    }
  })().catch((err) => {
    console.error("[sendq] queue poll failed:", err);
  });
}, SEND_QUEUE_POLL_MS);
console.log(`[startup] WeChat send queue poller started (every ${SEND_QUEUE_POLL_MS / 1000}s)`);

console.log(
  `[server] listening on http://${server.hostname}:${server.port}`,
);
