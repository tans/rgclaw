-- Allow null for title column in launch_events
CREATE TABLE IF NOT EXISTS launch_events_new (
  id text primary key,
  source text not null,
  source_event_id text not null,
  token_address text not null,
  symbol text,
  title text,
  event_time text not null,
  chain text not null,
  raw_payload text not null,
  dedupe_key text not null unique,
  created_at text not null
);
INSERT OR IGNORE INTO launch_events_new SELECT * FROM launch_events;
DROP TABLE launch_events;
ALTER TABLE launch_events_new RENAME TO launch_events;
CREATE UNIQUE INDEX IF NOT EXISTS idx_launch_events_source_token ON launch_events(source, token_address);
