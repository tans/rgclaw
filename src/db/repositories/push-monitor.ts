import { openDb } from "../sqlite";

export type PushHealthRecord = {
  launch_event_id: string;
  source: string;
  token_address: string;
  symbol: string | null;
  title: string;
  event_time: string;
  // eligible: how many users should have received this event
  eligible_users: number;
  // sent: how many users actually got the push (status = sent)
  sent_users: number;
  // failed: how many jobs failed permanently (status = failed)
  failed_users: number;
  // pending/processing: still in queue
  pending_users: number;
  // coverage: sent / eligible (1.0 = perfect)
  coverage: number;
  // latency_ms: how long between event_time and first sent_at
  first_sent_latency_ms: number | null;
};

export type PushHealthSummary = {
  overall_coverage: number; // overall sent / overall eligible
  total_events: number;
  perfect_events: number; // coverage == 1.0
  degraded_events: number; // 0 < coverage < 1.0
  failed_events: number; // sent_users == 0 && eligible_users > 0
  recent_failures: PushHealthRecord[];
  checked_at: string;
};

/**
 * Returns push health for each launch event in the given window.
 * Only events with at least one eligible user are included.
 */
export function getPushHealthRecords(sinceHoursAgo = 24, limit = 50): PushHealthRecord[] {
  const db = openDb();
  try {
    const cutoff = new Date(Date.now() - sinceHoursAgo * 60 * 60 * 1000).toISOString();

    const rows = db
      .query(
        `
        select
          le.id                    as launch_event_id,
          le.source,
          le.token_address,
          le.symbol,
          le.title,
          le.event_time,

          coalesce(eligible.eligible_count, 0)          as eligible_users,
          coalesce(sent.sent_count, 0)                  as sent_users,
          coalesce(failed.failed_count, 0)               as failed_users,
          coalesce(inflight.inflight_count, 0)          as pending_users,

          case
            when coalesce(eligible.eligible_count, 0) = 0 then 1.0
            else round(
              cast(coalesce(sent.sent_count, 0) as real) /
              coalesce(eligible.eligible_count, 1),
              4
            )
          end                                           as coverage,

          latency.first_sent_latency_ms

        from launch_events le

        -- How many users were eligible to receive this event
        left join (
          select launch_event_id, count(*) as eligible_count
          from notification_jobs
          group by launch_event_id
        ) eligible on eligible.launch_event_id = le.id

        -- How many actually got sent
        left join (
          select launch_event_id, count(*) as sent_count
          from notification_jobs
          where status = 'sent'
          group by launch_event_id
        ) sent on sent.launch_event_id = le.id

        -- How many permanently failed
        left join (
          select launch_event_id, count(*) as failed_count
          from notification_jobs
          where status = 'failed'
          group by launch_event_id
        ) failed on failed.launch_event_id = le.id

        -- Still pending or processing
        left join (
          select launch_event_id, count(*) as inflight_count
          from notification_jobs
          where status in ('pending', 'processing', 'queued')
          group by launch_event_id
        ) inflight on inflight.launch_event_id = le.id

        -- First sent latency
        left join (
          select launch_event_id,
            min(
              cast((julianday(nj.sent_at) - julianday(le2.event_time)) * 86400 * 1000 as integer)
            ) as first_sent_latency_ms
          from notification_jobs nj
          join launch_events le2 on le2.id = nj.launch_event_id
          where nj.status = 'sent' and nj.sent_at is not null
          group by nj.launch_event_id
        ) latency on latency.launch_event_id = le.id

        where le.event_time >= ?
          and coalesce(eligible.eligible_count, 0) > 0

        order by le.event_time desc
        limit ?
        `,
      )
      .all(cutoff, limit) as Array<{
      launch_event_id: string;
      source: string;
      token_address: string;
      symbol: string | null;
      title: string;
      event_time: string;
      eligible_users: number;
      sent_users: number;
      failed_users: number;
      pending_users: number;
      coverage: number;
      first_sent_latency_ms: number | null;
    }>;

    return rows.map((r) => ({
      launch_event_id: r.launch_event_id,
      source: r.source,
      token_address: r.token_address,
      symbol: r.symbol,
      title: r.title,
      event_time: r.event_time,
      eligible_users: Number(r.eligible_users),
      sent_users: Number(r.sent_users),
      failed_users: Number(r.failed_users),
      pending_users: Number(r.pending_users),
      coverage: Number(r.coverage),
      first_sent_latency_ms: r.first_sent_latency_ms != null ? Number(r.first_sent_latency_ms) : null,
    }));
  } finally {
    db.close();
  }
}

/**
 * Persist a push-health check result to DB for historical tracking.
 */
export function recordPushHealthCheck(
  summary: PushHealthSummary,
  details: PushHealthRecord[],
): string {
  const db = openDb();
  try {
    const id = crypto.randomUUID();
    db.query(
      `insert into push_health_check_results
        (id, checked_at, overall_coverage, total_events, perfect_events,
         degraded_events, failed_events, raw_details)
       values (?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      id,
      summary.checked_at,
      summary.overall_coverage,
      summary.total_events,
      summary.perfect_events,
      summary.degraded_events,
      summary.failed_events,
      JSON.stringify(details),
    );
    return id;
  } finally {
    db.close();
  }
}

/**
 * Log an alert when push coverage is degraded.
 */
export function recordPushAlert(
  launchEventId: string,
  source: string,
  tokenAddress: string,
  symbol: string | null,
  title: string,
  eligible: number,
  sent: number,
  failed: number,
  severity: "degraded" | "critical",
): string {
  const db = openDb();
  try {
    const id = crypto.randomUUID();
    const now = new Date().toISOString();
    db.query(
      `insert into push_alerts
        (id, launch_event_id, source, token_address, symbol, title,
         eligible_users, sent_users, failed_users, severity, created_at, acknowledged_at)
       values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, null)`,
    ).run(id, launchEventId, source, tokenAddress, symbol ?? null, title, eligible, sent, failed, severity, now);
    return id;
  } finally {
    db.close();
  }
}

export type PushAlertRecord = {
  id: string;
  launch_event_id: string;
  source: string;
  token_address: string;
  symbol: string | null;
  title: string;
  eligible_users: number;
  sent_users: number;
  failed_users: number;
  severity: "degraded" | "critical";
  created_at: string;
  acknowledged_at: string | null;
};

/**
 * Get unacknowledged alerts from the last N hours.
 */
export function listRecentPushAlerts(hoursAgo = 24): PushAlertRecord[] {
  const db = openDb();
  try {
    const cutoff = new Date(Date.now() - hoursAgo * 60 * 60 * 1000).toISOString();
    return db
      .query(
        `select id, launch_event_id, source, token_address, symbol, title,
                eligible_users, sent_users, failed_users, severity, created_at, acknowledged_at
           from push_alerts
          where created_at >= ? and acknowledged_at is null
          order by created_at desc`,
      )
      .all(cutoff) as PushAlertRecord[];
  } finally {
    db.close();
  }
}

/**
 * Acknowledge an alert so it doesn't keep firing.
 */
export function acknowledgeAlert(alertId: string) {
  const db = openDb();
  try {
    const now = new Date().toISOString();
    db.query("update push_alerts set acknowledged_at = ? where id = ?").run(now, alertId);
  } finally {
    db.close();
  }
}
