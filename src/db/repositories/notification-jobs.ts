import { openDb } from "../sqlite";

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
