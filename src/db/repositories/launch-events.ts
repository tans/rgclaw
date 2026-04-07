import { openDb } from "../sqlite";

export type LaunchEventFeedItem = {
  id: string;
  source: string;
  token_address: string;
  symbol: string | null;
  title: string | null;
  event_time: string;
};

export function listLatestLaunchEvents(limit = 50): LaunchEventFeedItem[] {
  const db = openDb();

  try {
    return db
      .query(
        "select id, source, token_address, symbol, title, event_time from launch_events order by event_time desc limit ?",
      )
      .all(limit) as LaunchEventFeedItem[];
  } finally {
    db.close();
  }
}

export type InsertLaunchEventInput = {
  source: string;
  sourceEventId: string;
  tokenAddress: string;
  symbol: string | null;
  title: string | null;
  eventTime: string;
  chain: string;
  rawPayload: string;
  dedupeKey: string;
};

export function insertLaunchEvent(event: InsertLaunchEventInput) {
  const db = openDb();

  try {
    db.query(
      "insert or ignore into launch_events (id, source, source_event_id, token_address, symbol, title, event_time, chain, raw_payload, dedupe_key, created_at) values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
    ).run(
      crypto.randomUUID(),
      event.source,
      event.sourceEventId,
      event.tokenAddress,
      event.symbol,
      event.title,
      event.eventTime,
      event.chain,
      event.rawPayload,
      event.dedupeKey,
      new Date().toISOString(),
    );
  } finally {
    db.close();
  }
}
