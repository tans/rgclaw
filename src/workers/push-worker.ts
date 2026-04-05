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
  markNotificationJobRetried,
  markNotificationJobSent,
  markSystemMessageJobRetried,
  markSystemMessageJobSent,
} from "../db/repositories/notification-jobs";
import {
  findActiveChannelBindingByUserId,
} from "../db/repositories/channel-bindings";
import {
  findActiveBindingByUserId,
} from "../db/repositories/wechat-bot-bindings";
import { sendMessage as sendDirectWechatMessage } from "../services/wechatbot-service";
import { markReminderSent } from "../db/repositories/entitlements";
import { openDb } from "../db/sqlite";
import { hubSendChannelMessage } from "../openilink/client";

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
  title: string;
  token_address: string;
  source: string;
  symbol?: string | null;
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
          and (
            -- Hub channel binding (OAuth flow)
            exists (
              select 1 from channel_bindings cb
              where cb.user_id = users.id and cb.status = 'active'
            )
            -- OR direct WeChat bot binding
            or exists (
              select 1 from wechat_bot_bindings wb
              where wb.user_id = users.id and wb.status = 'active'
            )
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
        select distinct cb.user_id
        from channel_bindings cb
        join user_entitlements ue
          on ue.user_id = cb.user_id
         and ue.status = 'active'
         and datetime(ue.expires_at) > datetime(?)
        join user_source_subscriptions uss
          on uss.user_id = cb.user_id
         and uss.enabled = 1
        where cb.status = 'active'
          and cb.hub_outbound_at is not null
          and datetime(cb.hub_outbound_at) <= datetime(?, '-18 hours')
          and datetime(cb.hub_outbound_at) > datetime(?, '-19 hours')
          and (
            cb.hub_keepalive_sent_at is null
            or datetime(cb.hub_keepalive_sent_at) <= datetime(?, '-1 hour')
          )
          and not exists (
            select 1 from system_message_jobs smj
            where smj.user_id = cb.user_id
              and smj.message_type = 'keepalive'
              and smj.status = 'pending'
          )
        limit 50
      `)
      .all(now, now, now, now) as Array<{ user_id: string }>;

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
      .query("select title, token_address, source, symbol from launch_events where id = ?")
      .get(launchEventId) as LaunchContentRow | null;
  } finally {
    db.close();
  }
}

function getErrorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}

async function sendViaHub(binding: { hub_api_key: string; hub_channel_id: string; bot_wechat_user_id: string; last_context_token?: string | null }, text: string) {
  await hubSendChannelMessage(binding.hub_api_key, binding.hub_channel_id, {
    to_user_id: binding.bot_wechat_user_id,
    content: text,
    context_token: binding.last_context_token ?? undefined,
  });
}

async function markOutboundSent(bindingId: string, sentAt: string, keepalive: boolean) {
  const db = openDb();
  try {
    db.query(
      `update channel_bindings set
        hub_outbound_at = ?,
        hub_keepalive_sent_at = case when ? then ? else hub_keepalive_sent_at end,
        updated_at = ?
       where id = ?`,
    ).run(sentAt, keepalive ? 1 : 0, sentAt, sentAt, bindingId);
  } finally {
    db.close();
  }
}

export async function dispatchPendingSystemMessages() {
  const jobs = claimPendingSystemMessageJobs();
  let sent = 0;

  for (const job of jobs) {
    const binding = findActiveChannelBindingByUserId(job.user_id);

    if (!binding || !binding.hub_api_key) {
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

        // Send auto-reply to the user who messaged the bot
        await hubSendChannelMessage(binding.hub_api_key, binding.hub_channel_id, {
          to_user_id: inboundData.from_user_id,
          content: buildGenericWechatAutoReply(),
          context_token: binding.last_context_token ?? undefined,
        });
      } else {
        // Outbound messages (keepalive, renewal_reminder): send as-is to bot
        await sendViaHub(
          {
            hub_api_key: binding.hub_api_key,
            hub_channel_id: binding.hub_channel_id,
            bot_wechat_user_id: binding.bot_wechat_user_id ?? "",
            last_context_token: binding.last_context_token,
          },
          job.payload,
        );
      }
    } catch (error) {
      markSystemMessageJobRetried(job.id, getErrorMessage(error), job.attempt_count + 1 >= 3);
      continue;
    }

    const sentAt = new Date().toISOString();
    markSystemMessageJobSent(job.id, sentAt);
    await markOutboundSent(binding.id, sentAt, job.message_type === "keepalive");
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
      // Launch event deleted — permanent failure
      markNotificationJobRetried(job.id, "launch event missing", true);
      continue;
    }

    const text = buildLaunchMessage(launch.title, launch.token_address, launch.source, launch.symbol);

    // Try Hub channel binding first (OAuth flow)
    const hubBinding = findActiveChannelBindingByUserId(job.user_id);
    if (hubBinding && hubBinding.hub_api_key) {
      try {
        await sendViaHub(
          {
            hub_api_key: hubBinding.hub_api_key,
            hub_channel_id: hubBinding.hub_channel_id,
            bot_wechat_user_id: hubBinding.bot_wechat_user_id ?? "",
            last_context_token: hubBinding.last_context_token,
          },
          text,
        );
        const sentAt = new Date().toISOString();
        markNotificationJobSent(job.id, sentAt);
        await markOutboundSent(hubBinding.id, sentAt, false);
        sent += 1;
        continue;
      } catch (error) {
        // Bot inactive or Hub error — keep retrying (bot will recover)
        const msg = getErrorMessage(error);
        const giveUp = msg.startsWith("binding missing");
        markNotificationJobRetried(job.id, msg, giveUp);
        continue;
      }
    }

    // Fall back to direct WeChat bot binding
    const wechatBinding = findActiveBindingByUserId(job.user_id);
    if (wechatBinding) {
      try {
        await sendDirectWechatMessage(wechatBinding, wechatBinding.user_wx_id, text);
        const sentAt = new Date().toISOString();
        markNotificationJobSent(job.id, sentAt);
        // Note: direct WeChat bindings don't track hub_outbound_at
        sent += 1;
        continue;
      } catch (error) {
        // Bot session inactive or network error — keep retrying until bot recovers
        const msg = getErrorMessage(error);
        const giveUp = msg.startsWith("binding missing"); // binding gone = permanent
        markNotificationJobRetried(job.id, msg, giveUp);
        continue;
      }
    }

    // No binding found — permanent failure
    markNotificationJobRetried(job.id, "binding missing", true);
  }

  return sent;
}
