import { buildRenewalReminder } from "../adapters/wechat-bot";
import {
  createNotificationJob,
  createSystemMessageJob,
} from "../db/repositories/notification-jobs";
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
         and user_wechat_bindings.bind_status = 'bound'
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
