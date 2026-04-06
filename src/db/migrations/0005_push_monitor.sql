-- Historical snapshots of push coverage checks
CREATE TABLE IF NOT EXISTS push_health_check_results (
  id                TEXT PRIMARY KEY,
  checked_at        TEXT NOT NULL,
  overall_coverage  REAL NOT NULL,
  total_events     INTEGER NOT NULL,
  perfect_events    INTEGER NOT NULL,
  degraded_events   INTEGER NOT NULL,
  failed_events     INTEGER NOT NULL,
  raw_details       TEXT NOT NULL          -- JSON array of PushHealthRecord
);

-- Alerts raised when push coverage drops below thresholds
CREATE TABLE IF NOT EXISTS push_alerts (
  id               TEXT PRIMARY KEY,
  launch_event_id  TEXT NOT NULL,
  source           TEXT NOT NULL,
  token_address    TEXT NOT NULL,
  symbol           TEXT,
  title            TEXT NOT NULL,
  eligible_users   INTEGER NOT NULL,
  sent_users       INTEGER NOT NULL,
  failed_users     INTEGER NOT NULL,
  severity         TEXT NOT NULL,          -- 'degraded' | 'critical'
  created_at       TEXT NOT NULL,
  acknowledged_at   TEXT
);

-- Index for fast lookup of unacknowledged alerts
CREATE INDEX IF NOT EXISTS idx_push_alerts_active
  ON push_alerts (created_at, acknowledged_at)
  WHERE acknowledged_at IS NULL;

-- Index for health check history
CREATE INDEX IF NOT EXISTS idx_push_health_checked
  ON push_health_check_results (checked_at DESC);
