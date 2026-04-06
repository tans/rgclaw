/**
 * Internal monitoring API endpoints.
 * Protected by INTERNAL_API_KEY — never expose to public internet.
 */

import { Hono } from "hono";
import { getPushHealthRecords, listRecentPushAlerts } from "../../db/repositories/push-monitor";

const INTERNAL_API_KEY = process.env.INTERNAL_API_KEY ?? "";

export function internalRoutes() {
  const app = new Hono();

  // ─── Middleware: require internal API key ────────────────────────────────
  app.use("*", async (c, next) => {
    if (!INTERNAL_API_KEY) {
      // In dev/local, skip auth if no key is set
      await next();
      return;
    }
    const provided = c.req.header("x-internal-api-key") ?? "";
    if (provided !== INTERNAL_API_KEY) {
      return c.json({ error: "unauthorized" }, 401);
    }
    await next();
  });

  // ─── GET /internal/push-health ─────────────────────────────────────────
  // Returns push coverage health for the last N hours.
  // Used by external monitoring (e.g. external cron + BSC chain fetcher).
  app.get("/internal/push-health", async (c) => {
    const hoursParam = c.req.query("hours");
    const hours = hoursParam ? Math.min(parseInt(hoursParam, 10) || 24, 72) : 24;

    const records = getPushHealthRecords(hours, 100);
    const alerts = listRecentPushAlerts(hours);

    const totalEligible = records.reduce((s, r) => s + r.eligible_users, 0);
    const totalSent = records.reduce((s, r) => s + r.sent_users, 0);
    const overallCoverage = totalEligible > 0 ? totalSent / totalEligible : 1.0;

    return c.json({
      success: true,
      checked_at: new Date().toISOString(),
      window_hours: hours,
      overall_coverage: Math.round(overallCoverage * 10000) / 10000,
      total_events: records.length,
      perfect_events: records.filter((r) => r.coverage >= 0.9999).length,
      degraded_events: records.filter(
        (r) => r.coverage < 0.9999 && r.coverage > 0 && r.eligible_users > 0,
      ).length,
      failed_events: records.filter((r) => r.sent_users === 0 && r.eligible_users > 0).length,
      events: records.map((r) => ({
        id: r.launch_event_id,
        source: r.source,
        token_address: r.token_address,
        symbol: r.symbol,
        title: r.title,
        event_time: r.event_time,
        eligible_users: r.eligible_users,
        sent_users: r.sent_users,
        failed_users: r.failed_users,
        pending_users: r.pending_users,
        coverage: r.coverage,
        latency_ms: r.first_sent_latency_ms,
      })),
      active_alerts: alerts.map((a) => ({
        id: a.id,
        launch_event_id: a.launch_event_id,
        source: a.source,
        token_address: a.token_address,
        symbol: a.symbol,
        severity: a.severity,
        created_at: a.created_at,
      })),
    });
  });

  // ─── GET /internal/push-health/latest ──────────────────────────────────
  // Lightweight status check: just OK or DEGRADED for easy alerting.
  app.get("/internal/push-health/latest", async (c) => {
    const records = getPushHealthRecords(1, 20); // last 1 hour, 20 events max

    // Status logic:
    // - If any event with eligible_users > 0 has coverage == 0 => "critical"
    // - If any event has coverage < 0.95 => "degraded"
    // - Otherwise => "ok"
    const hasCritical = records.some((r) => r.eligible_users > 0 && r.sent_users === 0);
    const hasDegraded = records.some(
      (r) => r.eligible_users > 0 && r.coverage > 0 && r.coverage < 0.95,
    );

    const status = hasCritical ? "critical" : hasDegraded ? "degraded" : "ok";
    const httpStatus = hasCritical ? 503 : hasDegraded ? 200 : 200;

    return c.json(
      {
        status,
        checked_at: new Date().toISOString(),
        events_checked: records.length,
        summary: {
          critical: records.filter((r) => r.eligible_users > 0 && r.sent_users === 0).length,
          degraded: records.filter(
            (r) => r.eligible_users > 0 && r.coverage > 0 && r.coverage < 0.95,
          ).length,
          ok: records.filter((r) => r.coverage >= 0.95).length,
        },
      },
      httpStatus,
    );
  });

  return app;
}
