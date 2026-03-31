import { openDb } from "../sqlite";

export function recordInboundEvent(input: {
  messageId: string;
  botId: string;
  fromUserId: string;
  text: string;
  receivedAt: string;
  rawPayload: string;
}) {
  const db = openDb();

  try {
    const insertResult = db
      .query(
        "insert or ignore into wechat_inbound_events (id, message_id, bot_id, from_user_id, text, received_at, process_status, raw_payload, created_at) values (?, ?, ?, ?, ?, ?, ?, ?, ?)",
      )
      .run(
        crypto.randomUUID(),
        input.messageId,
        input.botId,
        input.fromUserId,
        input.text,
        input.receivedAt,
        "received",
        input.rawPayload,
        new Date().toISOString(),
      );

    if (insertResult.changes > 0) {
      return { shouldProcess: true };
    }

    const existingEvent = db
      .query("select process_status from wechat_inbound_events where message_id = ?")
      .get(input.messageId) as { process_status: string } | null;

    return { shouldProcess: existingEvent?.process_status === "received" };
  } finally {
    db.close();
  }
}

export function markInboundEventProcessed(messageId: string, status: string) {
  const db = openDb();

  try {
    db.query("update wechat_inbound_events set process_status = ? where message_id = ?").run(
      status,
      messageId,
    );
  } finally {
    db.close();
  }
}
