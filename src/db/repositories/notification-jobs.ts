import { openDb } from "../sqlite";

type PendingNotificationJob = {
  id: string;
  launch_event_id: string;
  user_id: string;
  channel: string;
  status: string;
  attempt_count: number;
};

type PendingSystemMessageJob = {
  id: string;
  user_id: string;
  message_type: string;
  payload: string;
  status: string;
  attempt_count: number;
};

export function createNotificationJob(input: {
  launchEventId: string;
  userId: string;
  status?: string;
}) {
  const db = openDb();

  try {
    db.query(
      "insert into notification_jobs (id, launch_event_id, user_id, channel, status, created_at) values (?, ?, ?, ?, ?, ?)",
    ).run(
      crypto.randomUUID(),
      input.launchEventId,
      input.userId,
      "wechat",
      input.status ?? "pending",
      new Date().toISOString(),
    );
  } finally {
    db.close();
  }
}

export function createSystemMessageJob(input: {
  userId: string;
  messageType: string;
  payload: string;
}) {
  const db = openDb();

  try {
    db.query(
      "insert into system_message_jobs (id, user_id, message_type, payload, status, created_at) values (?, ?, ?, ?, ?, ?)",
    ).run(
      crypto.randomUUID(),
      input.userId,
      input.messageType,
      input.payload,
      "pending",
      new Date().toISOString(),
    );
  } finally {
    db.close();
  }
}

function claimPendingJobs<T extends { id: string }>(input: {
  table: "notification_jobs" | "system_message_jobs";
  selectColumns: string;
  limit: number;
}) {
  const db = openDb();

  try {
    db.exec("begin immediate");
    const rows = db
      .query(
        `
          select ${input.selectColumns}
          from ${input.table}
          where status = 'pending'
          order by datetime(created_at) asc, id asc
          limit ?
        `,
      )
      .all(input.limit) as T[];

    if (rows.length === 0) {
      db.exec("commit");
      return [];
    }

    const placeholders = rows.map(() => "?").join(", ");
    const ids = rows.map((row) => row.id);
    db.query(`update ${input.table} set status = 'processing' where status = 'pending' and id in (${placeholders})`).run(
      ...ids,
    );

    const claimedIds = new Set(
      (
        db.query(`select id from ${input.table} where status = 'processing' and id in (${placeholders})`).all(
          ...ids,
        ) as Array<{ id: string }>
      ).map((row) => row.id),
    );
    db.exec("commit");

    return rows.filter((row) => claimedIds.has(row.id));
  } catch (error) {
    try {
      db.exec("rollback");
    } catch {
      // Ignore rollback failures when no explicit transaction is open.
    }
    throw error;
  } finally {
    db.close();
  }
}

export function claimPendingNotificationJobs(limit = 50) {
  return claimPendingJobs<PendingNotificationJob>({
    table: "notification_jobs",
    selectColumns: "id, launch_event_id, user_id, channel, status, attempt_count",
    limit,
  });
}

export function markNotificationJobSent(id: string, sentAt: string) {
  const db = openDb();

  try {
    db.query("update notification_jobs set status = 'sent', sent_at = ?, last_error = null where id = ?").run(
      sentAt,
      id,
    );
  } finally {
    db.close();
  }
}

export function markNotificationJobQueued(id: string) {
  const db = openDb();

  try {
    db.query("update notification_jobs set status = 'queued' where id = ?").run(id);
  } finally {
    db.close();
  }
}

export function markNotificationJobRetried(id: string, error: string, giveUp: boolean) {
  const db = openDb();

  try {
    // Keep jobs in 'pending' so they retry on the next worker cycle.
    // Only transition to 'failed' for permanent errors (e.g. binding gone).
    // This ensures messages eventually deliver when the bot recovers.
    const newStatus = giveUp ? "failed" : "pending";
    db.query(
      "update notification_jobs set status = ?, attempt_count = attempt_count + 1, last_error = ? where id = ?",
    ).run(newStatus, error, id);
  } finally {
    db.close();
  }
}

export function claimPendingSystemMessageJobs(limit = 50) {
  return claimPendingJobs<PendingSystemMessageJob>({
    table: "system_message_jobs",
    selectColumns: "id, user_id, message_type, payload, status, attempt_count",
    limit,
  });
}

export function markSystemMessageJobSent(id: string, sentAt: string) {
  const db = openDb();

  try {
    db.query("update system_message_jobs set status = 'sent', sent_at = ?, last_error = null where id = ?").run(
      sentAt,
      id,
    );
  } finally {
    db.close();
  }
}

export function markSystemMessageJobRetried(id: string, error: string, failed: boolean) {
  const db = openDb();

  try {
    db.query(
      "update system_message_jobs set status = ?, attempt_count = attempt_count + 1, last_error = ? where id = ?",
    ).run(failed ? "failed" : "pending", error, id);
  } finally {
    db.close();
  }
}

// ─── Pending WeChat Sends Queue ───────────────────────────────────────────────

export type PendingWechatSend = {
  id: string;
  notification_job_id: string | null;
  binding_id: string;
  user_wx_id: string;
  content: string;
  status: string;
  attempt_count: number;
  last_error: string | null;
  created_at: string;
  sent_at: string | null;
};

export function enqueueWechatSend(params: {
  bindingId: string;
  userWxId: string;
  content: string;
  notificationJobId?: string;
}): string {
  const db = openDb();
  const id = crypto.randomUUID();
  try {
    db.query(
      `insert into pending_wechat_sends (id, notification_job_id, binding_id, user_wx_id, content, status, attempt_count, created_at)
       values (?, ?, ?, ?, ?, 'pending', 0, ?)`,
    ).run(id, params.notificationJobId ?? null, params.bindingId, params.userWxId, params.content, new Date().toISOString());
    return id;
  } finally {
    db.close();
  }
}

export function claimPendingWechatSends(limit = 50): PendingWechatSend[] {
  const db = openDb();
  try {
    db.exec("begin immediate");
    const rows = db
      .query(
        `select id, binding_id, user_wx_id, content, status, attempt_count, last_error, created_at, sent_at
         from pending_wechat_sends
         where status = 'pending'
         order by datetime(created_at) asc
         limit ?`,
      )
      .all(limit) as PendingWechatSend[];

    if (rows.length === 0) {
      db.exec("commit");
      return [];
    }

    const placeholders = rows.map(() => "?").join(", ");
    const ids = rows.map((r) => r.id);
    db.query(
      `update pending_wechat_sends set status = 'processing', attempt_count = attempt_count + 1 where status = 'pending' and id in (${placeholders})`,
    ).run(...ids);
    db.exec("commit");
    return rows;
  } catch (error) {
    try { db.exec("rollback"); } catch { /* ignore */ }
    throw error;
  } finally {
    db.close();
  }
}

export function markWechatSendSent(id: string, notificationJobId?: string | null) {
  const db = openDb();
  try {
    const sentAt = new Date().toISOString();
    db.query("update pending_wechat_sends set status = 'sent', sent_at = ?, last_error = null where id = ?").run(
      sentAt,
      id,
    );
    // Also mark the parent notification_job as sent so push coverage is accurate.
    if (notificationJobId) {
      db.query(
        "update notification_jobs set status = 'sent', sent_at = ? where id = ? and status != 'sent'",
      ).run(sentAt, notificationJobId);
    }
  } finally {
    db.close();
  }
}

export function markWechatSendFailed(id: string, error: string) {
  const db = openDb();
  try {
    db.query("update pending_wechat_sends set status = 'failed', last_error = ? where id = ?").run(error, id);
  } finally {
    db.close();
  }
}

export function markNotificationJobDone(id: string) {
  const db = openDb();
  try {
    db.query("update notification_jobs set status = 'sent', sent_at = ? where id = ?").run(
      new Date().toISOString(),
      id,
    );
  } finally {
    db.close();
  }
}
