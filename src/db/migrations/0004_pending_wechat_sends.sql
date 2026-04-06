-- Queue for WeChat messages that need to be sent via the web server's active bots
CREATE TABLE IF NOT EXISTS pending_wechat_sends (
  id TEXT PRIMARY KEY,
  notification_job_id TEXT,                    -- optional link back to notification_jobs for audit trail
  binding_id TEXT NOT NULL,
  user_wx_id TEXT NOT NULL,
  content TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',      -- pending | processing | sent | failed
  attempt_count INTEGER NOT NULL DEFAULT 0,
  last_error TEXT,
  created_at TEXT NOT NULL,
  sent_at TEXT
);
