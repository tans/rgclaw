/**
 * Push Monitor Worker
 *
 * Periodically verifies that:
 *  A) Launch events were properly queued and sent to eligible users
 *     (push coverage check via DB notification_jobs).
 *  B) The collector is catching events from the BSC chain
 *     (compares BSC RPC events vs DB launch_events).
 *
 * Writes results to push_health_check_results and push_alerts when
 * coverage drops below configured thresholds.
 */

import { config } from "../shared/config";
import {
  getPushHealthRecords,
  recordPushHealthCheck,
  recordPushAlert,
  type PushHealthRecord,
  type PushHealthSummary,
} from "../db/repositories/push-monitor";
import { createBscRpcClient } from "../collectors/rpc";
import { getLogsInBatches, resolveTokenSymbol, resolveEventTime } from "../collectors/rpc";

// ─── BSC contract constants (same as collector) ────────────────────────────

const FLAP_PORTAL_ADDRESS = "0xe2ce6ab80874fa9fa2aae65d277dd6b8e65c9de0";
const FLAP_LAUNCHED_TOPIC =
  "0x0211b2657ce697a4ae4094c380930e4fef6274527a0a2d10f3a319ef6abf6bd5";

const FOUR_CONTRACT_ADDRESS = "0x5c952063c7fc8610ffdb798152d69f0b9550762b";
const FOUR_TOKEN_CREATE_TOPIC =
  "0xf2f3fa75816e73e0dabc4b7113147b6221e8f653c60044c9e07cfb47eb04dbeb";

// ─── Config thresholds ──────────────────────────────────────────────────────

const CHECK_INTERVAL_MS = 10 * 60 * 1000; // 10 minutes
const LOOKBACK_HOURS = 24;                 // how far back to check DB events
const LOOKBACK_BLOCKS = 24_000;           // BSC ~3 blocks/s → ~2h of events (enough for CHAIN_LOOKBACK_HOURS)
const CHAIN_LOOKBACK_HOURS = 2;            // how far back to fetch chain events (must match BSC blocks above)
const COVERAGE_CRITICAL = 0.5;            // < 50% coverage = critical
const COVERAGE_DEGRADED = 0.95;           // < 95% coverage = degraded
const MAX_RECORDS_PER_CHECK = 100;

// ─── Types ──────────────────────────────────────────────────────────────────

type ChainEvent = {
  source: "flap" | "four";
  tokenAddress: string;
  symbol: string | null;
  txHash: string;
  logIndex: number;
  blockTime: string; // ISO
};

type CollectorHealthResult = {
  ok: boolean;
  scanned: number;
  missingTokens: string[];
  totalChainEvents: number;
};

// ─── Fetch recent events directly from BSC chain ───────────────────────────

async function fetchChainEvents(
  since: Date,
  bscRpcUrl: string,
): Promise<ChainEvent[]> {
  const client = createBscRpcClient(bscRpcUrl);
  const latestBlock = await client.getBlockNumber();
  const fromBlock = latestBlock > BigInt(LOOKBACK_BLOCKS)
    ? latestBlock - BigInt(LOOKBACK_BLOCKS)
    : 0n;

  // Fetch Flap and Four events in parallel
  const [flapLogs, fourLogs] = await Promise.all([
    getLogsInBatches(client, {
      address: FLAP_PORTAL_ADDRESS,
      topics: [FLAP_LAUNCHED_TOPIC],
      fromBlock,
      toBlock: latestBlock,
      batchSize: 50n,
    }),
    getLogsInBatches(client, {
      address: FOUR_CONTRACT_ADDRESS,
      topics: [FOUR_TOKEN_CREATE_TOPIC],
      fromBlock,
      toBlock: latestBlock,
      batchSize: 50n,
    }),
  ]);

  const toIso = (ts: bigint) => new Date(Number(ts) * 1000).toISOString();

  const flapEvents: ChainEvent[] = await Promise.all(
    flapLogs.map(async (log) => {
      const tokenAddress = (log.args?.["token"] as string | undefined) ?? "";
      let symbol: string | null = (log.args?.["symbol"] as string | undefined) ?? null;
      if (!symbol) {
        try { symbol = await resolveTokenSymbol(client, tokenAddress); } catch { /* ignore */ }
      }
      const block = await client.getBlock({ blockNumber: log.blockNumber as bigint }).catch(() => ({ timestamp: 0n }));
      return {
        source: "flap",
        tokenAddress,
        symbol,
        txHash: log.transactionHash as string,
        logIndex: Number(log.logIndex),
        blockTime: toIso(block.timestamp),
      };
    }),
  );

  const fourEvents: ChainEvent[] = await Promise.all(
    fourLogs.map(async (log) => {
      const tokenAddress =
        (log.args?.["memeToken"] as string | undefined) ??
        (log.args?.["token"] as string | undefined) ??
        "";
      let symbol: string | null = (log.args?.["symbol"] as string | undefined) ?? null;
      if (!symbol) {
        try { symbol = await resolveTokenSymbol(client, tokenAddress); } catch { /* ignore */ }
      }
      const block = await client.getBlock({ blockNumber: log.blockNumber as bigint }).catch(() => ({ timestamp: 0n }));
      return {
        source: "four",
        tokenAddress,
        symbol,
        txHash: log.transactionHash as string,
        logIndex: Number(log.logIndex),
        blockTime: toIso(block.timestamp),
      };
    }),
  );

  // Filter to those after our since timestamp
  const sinceMs = since.getTime();
  return [...flapEvents, ...fourEvents].filter((e) => new Date(e.blockTime).getTime() >= sinceMs);
}

// ─── Collector health: chain vs DB ─────────────────────────────────────────

async function checkCollectorHealth(logger: { info(message: string): void; warn(message: string): void }): Promise<CollectorHealthResult> {
  const since = new Date(Date.now() - CHAIN_LOOKBACK_HOURS * 60 * 60 * 1000); // last N hours (matches LOOKBACK_BLOCKS)

  let chainEvents: ChainEvent[];
  try {
    chainEvents = await fetchChainEvents(since, config.bscRpcUrl);
  } catch (err) {
    logger.warn(`[push-monitor] collector health: BSC RPC error: ${err instanceof Error ? err.message : String(err)}`);
    return { ok: false, scanned: 0, missingTokens: [], totalChainEvents: 0 };
  }

  if (chainEvents.length === 0) {
    logger.info("[push-monitor] collector health: 0 chain events in last 2h (normal if market quiet)");
    return { ok: true, scanned: 0, missingTokens: [], totalChainEvents: 0 };
  }

  // Query DB for tokens we've captured in the same window
  const cutoff = since.toISOString();
  const db = (await import("../db/sqlite")).openDb();
  let dbTokens: Set<string>;
  try {
    const rows = db
      .query(
        `select token_address from launch_events
           where event_time >= ? and token_address is not null`,
      )
      .all(cutoff) as Array<{ token_address: string }>;
    dbTokens = new Set(rows.map((r) => r.token_address.toLowerCase()));
  } finally {
    db.close();
  }

  const missing = chainEvents.filter((e) => !dbTokens.has(e.tokenAddress.toLowerCase()));

  if (missing.length > 0) {
    const sample = missing.slice(0, 5).map((e) => `${e.source}:${e.symbol ?? e.tokenAddress}`).join(", ");
    const suffix = missing.length > 5 ? ` ... (+${missing.length - 5} more)` : "";
    logger.warn(
      `[push-monitor] collector health: ${missing.length}/${chainEvents.length} chain events NOT in DB: ${sample}${suffix}`,
    );
    return {
      ok: missing.length === 0,
      scanned: chainEvents.length,
      missingTokens: missing.map((e) => e.tokenAddress),
      totalChainEvents: chainEvents.length,
    };
  }

  logger.info(`[push-monitor] collector health: all ${chainEvents.length} chain events captured ✓`);
  return { ok: true, scanned: chainEvents.length, missingTokens: [], totalChainEvents: chainEvents.length };
}

// ─── Coverage analysis ──────────────────────────────────────────────────────

function buildSummary(records: PushHealthRecord[], checkedAt: string): PushHealthSummary {
  const totalEligible = records.reduce((s, r) => s + r.eligible_users, 0);
  const totalSent = records.reduce((s, r) => s + r.sent_users, 0);
  const overallCoverage = totalEligible > 0 ? totalSent / totalEligible : 1.0;

  return {
    overall_coverage: Math.round(overallCoverage * 10000) / 10000,
    total_events: records.length,
    perfect_events: records.filter((r) => r.coverage >= 0.9999).length,
    degraded_events: records.filter((r) => r.coverage < 0.9999 && r.coverage > 0 && r.eligible_users > 0).length,
    failed_events: records.filter((r) => r.sent_users === 0 && r.eligible_users > 0).length,
    recent_failures: records.filter((r) => r.sent_users === 0 && r.eligible_users > 0).slice(0, 5),
    checked_at: checkedAt,
  };
}

function raiseAlerts(records: PushHealthRecord[], logger: { warn(message: string): void; error(message: string): void }) {
  for (const record of records) {
    if (record.eligible_users === 0) continue;

    const isCritical = record.coverage < COVERAGE_CRITICAL;
    const isDegraded = record.coverage < COVERAGE_DEGRADED && !isCritical;
    if (!isCritical && !isDegraded) continue;

    const severity: "critical" | "degraded" = isCritical ? "critical" : "degraded";
    const pct = Math.round(record.coverage * 100);
    const msg = isCritical
      ? `[PUSH CRITICAL] ${record.source} ${record.symbol ?? record.token_address} — sent 0/${record.eligible_users}`
      : `[PUSH DEGRADED]  ${record.source} ${record.symbol ?? record.token_address} — sent ${record.sent_users}/${record.eligible_users} (${pct}%)`;

    if (isCritical) logger.error(msg, null);
    else logger.warn(msg);

    recordPushAlert(
      record.launch_event_id,
      record.source,
      record.token_address,
      record.symbol,
      record.title,
      record.eligible_users,
      record.sent_users,
      record.failed_users,
      severity,
    );
  }
}

// ─── One full check cycle ───────────────────────────────────────────────────

export type PushMonitorSummary = {
  records_checked: number;
  overall_coverage: number;
  critical_alerts: number;
  degraded_alerts: number;
  collector_ok: boolean;
  collector_scanned: number;
  collector_missing: number;
};

// ─── Self-contained scheduled loop (used by PM2 ecosystem entry) ───────────

const MONITOR_INTERVAL_MS = 10 * 60 * 1000; // 10 minutes

export async function runPushMonitorLoop({
  intervalMs = MONITOR_INTERVAL_MS,
  logger = console,
}: {
  intervalMs?: number;
  logger?: { info(message: string): void; warn(message: string): void; error(message: string, err: unknown): void };
} = {}) {
  const loopLogger = {
    info(msg: string) { logger.info(msg); },
    warn(msg: string) { logger.warn(msg); },
    error(msg: string, err: unknown) { logger.error(msg, err); },
  };

  // Run immediately on start, then on interval
  await runPushMonitorCheck({ logger: loopLogger });

  let count = 0;
  while (true) {
    await Bun.sleep(intervalMs);
    count++;
    try {
      const summary = await runPushMonitorCheck({ logger: loopLogger });
      loopLogger.info(
        `[push-monitor] cycle #${count} complete — ` +
          `records=${summary.records_checked} coverage=${Math.round(summary.overall_coverage * 100)}% ` +
          `alerts=${summary.critical_alerts + summary.degraded_alerts} ` +
          `collector=${summary.collector_ok ? "✓" : "✗"}(${summary.collector_scanned} evts)`,
      );
    } catch (err) {
      loopLogger.error(`[push-monitor] cycle #${count} threw:`, err);
    }
  }
}

// ─── Core check logic (exported for both loop and one-shot use) ─────────────

export async function runPushMonitorCheck(deps: {
  logger?: { info(message: string): void; warn(message: string): void; error(message: string, err: unknown): void };
  getPushHealthRecords?: typeof getPushHealthRecords;
  recordPushHealthCheck?: typeof recordPushHealthCheck;
} = {}): Promise<PushMonitorSummary> {
  const logger = deps.logger ?? {
    info() {},
    warn() {},
    error() {},
  };
  const _getRecords = deps.getPushHealthRecords ?? getPushHealthRecords;
  const _recordCheck = deps.recordPushHealthCheck ?? recordPushHealthCheck;

  const checkedAt = new Date().toISOString();

  // 1. DB push coverage
  const records = _getRecords(LOOKBACK_HOURS, MAX_RECORDS_PER_CHECK);
  const summary = buildSummary(records, checkedAt);
  _recordCheck(summary, records);
  raiseAlerts(records, logger);

  // 2. Collector health (chain vs DB)
  let collectorResult: CollectorHealthResult;
  try {
    collectorResult = await checkCollectorHealth(logger);
  } catch (err) {
    logger.warn(`[push-monitor] collector check threw: ${err instanceof Error ? err.message : String(err)}`);
    collectorResult = { ok: false, scanned: 0, missingTokens: [], totalChainEvents: 0 };
  }

  const criticalAlerts = records.filter((r) => r.coverage < COVERAGE_CRITICAL && r.eligible_users > 0).length;
  const degradedAlerts = records.filter(
    (r) => r.coverage < COVERAGE_DEGRADED && r.coverage >= COVERAGE_CRITICAL && r.eligible_users > 0,
  ).length;

  logger.info(
    `[push-monitor] done: events=${records.length} coverage=${Math.round(summary.overall_coverage * 100)}% ` +
    `crit=${criticalAlerts} deg=${degradedAlerts} ` +
    `collector=${collectorResult.ok ? "OK" : "MISSING=" + collectorResult.missingTokens.length}`,
  );

  return {
    records_checked: records.length,
    overall_coverage: summary.overall_coverage,
    critical_alerts: criticalAlerts,
    degraded_alerts: degradedAlerts,
    collector_ok: collectorResult.ok,
    collector_scanned: collectorResult.scanned,
    collector_missing: collectorResult.missingTokens.length,
  };
}

// ─── Background loop ───────────────────────────────────────────────────────

export async function runPushMonitorLoop(
  deps: { intervalMs?: number; logger?: { info(message: string): void; warn(message: string): void; error(message: string, err: unknown): void } } = {},
) {
  const intervalMs = deps.intervalMs ?? CHECK_INTERVAL_MS;
  const logger = deps.logger ?? console;

  logger.info(`[push-monitor] starting (interval=${intervalMs / 1000 / 60}min)`);

  await runPushMonitorCheck({ logger });

  while (true) {
    await new Promise((r) => setTimeout(r, intervalMs));
    try {
      await runPushMonitorCheck({ logger });
    } catch (err) {
      logger.error("[push-monitor] cycle failed", err);
    }
  }
}

if (import.meta.main) {
  runPushMonitorLoop().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
