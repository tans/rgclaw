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
    const result = db
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

    return result.changes > 0;
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
