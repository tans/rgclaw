import {
  buildKeepaliveReminder,
  buildLaunchMessage,
  buildRenewalReminder,
  sendWechatMessage,
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
  findActiveBindingByUserId,
  listBindingsNeedingKeepalive,
  markBindingOutboundSent,
} from "../db/repositories/wechat-bindings";
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
  title: string;
  token_address: string;
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
        join user_wechat_bindings
          on user_wechat_bindings.user_id = users.id
         and user_wechat_bindings.status = 'active'
        join user_entitlements
          on user_entitlements.user_id = users.id
         and user_entitlements.status = 'active'
        where datetime(user_entitlements.expires_at) > datetime('now')
          and not exists (
            select 1 from notification_jobs
            where notification_jobs.launch_event_id = launch_events.id
              and notification_jobs.user_id = users.id
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
  const rows = listBindingsNeedingKeepalive(now);

  for (const row of rows) {
    createSystemMessageJob({
      userId: row.user_id,
      messageType: "keepalive",
      payload: buildKeepaliveReminder(),
    });
  }

  return rows.length;
}

function getLaunchContent(launchEventId: string) {
  const db = openDb();

  try {
    return db
      .query("select title, token_address from launch_events where id = ?")
      .get(launchEventId) as LaunchContentRow | null;
  } finally {
    db.close();
  }
}

function getErrorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}

export async function dispatchPendingSystemMessages(options: {
  sendMessage?: typeof sendWechatMessage;
} = {}) {
  const sendMessage = options.sendMessage ?? sendWechatMessage;
  const jobs = claimPendingSystemMessageJobs();
  let sent = 0;

  for (const job of jobs) {
    const binding = findActiveBindingByUserId(job.user_id);

    if (!binding || !binding.last_context_token) {
      markSystemMessageJobRetried(job.id, "binding missing", job.attempt_count + 1 >= 3);
      continue;
    }

    try {
      await sendMessage({
        botId: binding.bot_id,
        toUserId: binding.bot_wechat_user_id,
        contextToken: binding.last_context_token,
        text: job.payload,
      });
    } catch (error) {
      markSystemMessageJobRetried(job.id, getErrorMessage(error), job.attempt_count + 1 >= 3);
      continue;
    }

    const sentAt = new Date().toISOString();
    markSystemMessageJobSent(job.id, sentAt);
    markBindingOutboundSent(binding.id, sentAt, job.message_type === "keepalive");
    sent += 1;
  }

  return sent;
}

export async function dispatchPendingNotificationMessages(options: {
  sendMessage?: typeof sendWechatMessage;
} = {}) {
  const sendMessage = options.sendMessage ?? sendWechatMessage;
  const jobs = claimPendingNotificationJobs();
  let sent = 0;

  for (const job of jobs) {
    const binding = findActiveBindingByUserId(job.user_id);

    if (!binding || !binding.last_context_token) {
      markNotificationJobRetried(job.id, "binding missing", job.attempt_count + 1 >= 3);
      continue;
    }

    const launch = getLaunchContent(job.launch_event_id);
    if (!launch) {
      markNotificationJobRetried(job.id, "launch event missing", job.attempt_count + 1 >= 3);
      continue;
    }

    try {
      await sendMessage({
        botId: binding.bot_id,
        toUserId: binding.bot_wechat_user_id,
        contextToken: binding.last_context_token,
        text: buildLaunchMessage(launch.title, launch.token_address),
      });
    } catch (error) {
      markNotificationJobRetried(job.id, getErrorMessage(error), job.attempt_count + 1 >= 3);
      continue;
    }

    const sentAt = new Date().toISOString();
    markNotificationJobSent(job.id, sentAt);
    markBindingOutboundSent(binding.id, sentAt, false);
    sent += 1;
  }

  return sent;
}
