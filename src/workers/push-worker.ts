import {
  buildKeepaliveReminder,
  buildLaunchMessage,
  buildRenewalReminder,
  buildGenericWechatAutoReply,
} from "../adapters/wechat-bot";
import {
  claimPendingNotificationJobs,
  claimPendingSystemMessageJobs,
  createNotificationJob,
  createSystemMessageJob,
  enqueueWechatSend,
  markNotificationJobQueued,
  markNotificationJobRetried,
  markNotificationJobSent,
  markSystemMessageJobRetried,
  markSystemMessageJobSent,
} from "../db/repositories/notification-jobs";
import {
  findActiveBindingByUserId,
} from "../db/repositories/wechat-bot-bindings";
import { sendMessage } from "../services/wechatbot-service";
import { markReminderSent } from "../db/repositories/entitlements";
import { openDb } from "../db/sqlite";

type LaunchPushRow = {
  launch_event_id: string;
  user_id: string;
};

type ReminderRow = {
  id: string;
  user_id: string;
  expires_at: string;
};

type LaunchContentRow = {
  title: string | null;
  token_address: string;
  source: string;
  symbol?: string | null;
  event_time?: string | null;
};

export async function processLaunchPushes() {
  const db = openDb();

  try {
    const rows = db
      .query(`
        select distinct launch_events.id as launch_event_id, users.id as user_id
        from launch_events
        join user_source_subscriptions
          on user_source_subscriptions.source = launch_events.source
         and user_source_subscriptions.enabled = 1
        join users on users.id = user_source_subscriptions.user_id
        join user_entitlements
          on user_entitlements.user_id = users.id
         and user_entitlements.status = 'active'
        where datetime(user_entitlements.expires_at) > datetime('now')
          and not exists (
            select 1 from notification_jobs
            where notification_jobs.launch_event_id = launch_events.id
              and notification_jobs.user_id = users.id
          )
          and exists (
            select 1 from wechat_bot_bindings wb
            where wb.user_id = users.id and wb.status = 'active'
          )
      `)
      .all() as LaunchPushRow[];

    for (const row of rows) {
      createNotificationJob({
        launchEventId: row.launch_event_id,
        userId: row.user_id,
      });
    }

    return rows.length;
  } finally {
    db.close();
  }
}

export async function processRenewalReminders() {
  const db = openDb();

  try {
    const rows = db
      .query(`
        select id, user_id, expires_at
        from user_entitlements
        where status = 'active'
          and renewal_reminded_at is null
          and datetime(expires_at) <= datetime('now', '+1 day')
          and datetime(expires_at) > datetime('now')
      `)
      .all() as ReminderRow[];

    for (const row of rows) {
      createSystemMessageJob({
        userId: row.user_id,
        messageType: "renewal_reminder",
        payload: buildRenewalReminder(row.expires_at),
      });
      markReminderSent(row.id);
    }

    return rows.length;
  } finally {
    db.close();
  }
}

export async function enqueueKeepaliveReminders(now = new Date().toISOString()) {
  const db = openDb();

  try {
    const rows = db
      .query(`
        select wb.user_id, wb.last_message_at
        from wechat_bot_bindings wb
        join user_entitlements ue
          on ue.user_id = wb.user_id
         and ue.status = 'active'
         and datetime(ue.expires_at) > datetime(?)
        join user_source_subscriptions uss
          on uss.user_id = wb.user_id
         and uss.enabled = 1
        where wb.status = 'active'
          and wb.last_message_at is not null
          and datetime(wb.last_message_at) <= datetime(?, '-18 hours')
          and datetime(wb.last_message_at) > datetime(?, '-19 hours')
          and not exists (
            select 1 from system_message_jobs smj
            where smj.user_id = wb.user_id
              and smj.message_type = 'keepalive'
              and smj.status = 'pending'
          )
        limit 50
      `)
      .all(now, now, now) as Array<{ user_id: string; last_message_at: string }>;

    for (const row of rows) {
      createSystemMessageJob({
        userId: row.user_id,
        messageType: "keepalive",
        payload: buildKeepaliveReminder(),
      });
    }

    return rows.length;
  } finally {
    db.close();
  }
}

function getLaunchContent(launchEventId: string) {
  const db = openDb();

  try {
    return db
      .query("select title, token_address, source, symbol, event_time from launch_events where id = ?")
      .get(launchEventId) as LaunchContentRow | null;
  } finally {
    db.close();
  }
}

function getErrorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}

export async function dispatchPendingSystemMessages() {
  const jobs = claimPendingSystemMessageJobs();
  let sent = 0;

  for (const job of jobs) {
    const binding = findActiveBindingByUserId(job.user_id);

    if (!binding) {
      markSystemMessageJobRetried(job.id, "binding missing", job.attempt_count + 1 >= 3);
      continue;
    }

    try {
      // Handle inbound messages: parse sender info and send auto-reply
      if (job.message_type === "inbound") {
        let inboundData: { from_user_id: string; content: string; msg_id: string; timestamp: string };
        try {
          inboundData = JSON.parse(job.payload);
        } catch {
          markSystemMessageJobRetried(job.id, "invalid inbound payload", job.attempt_count + 1 >= 3);
          continue;
        }

        await sendMessage(binding, inboundData.from_user_id, buildGenericWechatAutoReply());
      } else {
        // Outbound messages (keepalive, renewal_reminder)
        await sendMessage(binding, binding.user_wx_id, job.payload);
      }
    } catch (error) {
      markSystemMessageJobRetried(job.id, getErrorMessage(error), job.attempt_count + 1 >= 3);
      continue;
    }

    const sentAt = new Date().toISOString();
    markSystemMessageJobSent(job.id, sentAt);
    sent += 1;
  }

  return sent;
}

export async function dispatchPendingNotificationMessages() {
  const jobs = claimPendingNotificationJobs();
  let sent = 0;

  for (const job of jobs) {
    const launch = getLaunchContent(job.launch_event_id);
    if (!launch) {
      markNotificationJobRetried(job.id, "launch event missing", true);
      continue;
    }

    const text = buildLaunchMessage(launch.token_address, launch.source, launch.symbol, launch.title, launch.event_time);

    const wechatBinding = findActiveBindingByUserId(job.user_id);
    if (!wechatBinding) {
      console.log(`[push] SKIP no binding user=${job.user_id} event=${job.launch_event_id} token=${launch.token_address} symbol=${launch.symbol ?? "null"}`);
      markNotificationJobRetried(job.id, "binding missing", true);
      continue;
    }

    try {
      await sendMessage(wechatBinding, wechatBinding.user_wx_id, text);
      const sentAt = new Date().toISOString();
      markNotificationJobSent(job.id, sentAt);
      sent += 1;
      console.log(`[push] SENT user=${job.user_id} event=${job.launch_event_id} token=${launch.token_address} symbol=${launch.symbol ?? "null"} source=${launch.source} at=${sentAt}`);
    } catch (error) {
      const msg = getErrorMessage(error);
      if (msg.startsWith("WECHAT_BOT_INACTIVE")) {
        // Queue for web server to send via its active bots
        enqueueWechatSend({
          bindingId: wechatBinding.id,
          userWxId: wechatBinding.user_wx_id,
          content: text,
          notificationJobId: job.id,
        });
        markNotificationJobQueued(job.id);
        console.log(`[push] QUEUED user=${job.user_id} event=${job.launch_event_id} token=${launch.token_address} symbol=${launch.symbol ?? "null"} via web server`);
      } else if (msg.startsWith("binding missing")) {
        console.log(`[push] SKIP no binding user=${job.user_id} event=${job.launch_event_id} token=${launch.token_address} symbol=${launch.symbol ?? "null"}`);
        markNotificationJobRetried(job.id, msg, true);
      } else {
        // Transient error — retry next cycle
        console.log(`[push] FAIL user=${job.user_id} event=${job.launch_event_id} token=${launch.token_address} symbol=${launch.symbol ?? "null"} error=${msg}`);
        markNotificationJobRetried(job.id, msg, false);
      }
    }
  }

  return sent;
}
