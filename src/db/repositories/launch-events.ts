import { openDb } from "../sqlite";

export type LaunchEventFeedItem = {
  id: string;
  source: string;
  token_address: string;
  symbol: string | null;
  title: string;
  event_time: string;
};

export function listLatestLaunchEvents(limit = 50): LaunchEventFeedItem[] {
  const db = openDb();

  return db
    .query(
      "select id, source, token_address, symbol, title, event_time from launch_events order by event_time desc limit ?",
    )
    .all(limit) as LaunchEventFeedItem[];
}
