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
