import { config } from "../shared/config";
import { runMigrations } from "../db/migrate";
import { insertLaunchEvent } from "../db/repositories/launch-events";
import { runPollingLoop } from "../shared/polling-loop";
import { createBscRpcClient } from "./rpc";
import { collectFlapLaunchEvents } from "./flap";
import { collectFourLaunchEvents } from "./four";
import { runBackfillOnce, type BackfillOptions } from "./backfill";

const COLLECTOR_POLL_DELAY_MS = 30_000;

type CollectorLoopOptions = {
  delayMs?: number;
  bootPrep?: () => Promise<void>;
  logger?: {
    info(message: string): void;
    error(message: string, error: unknown): void;
  };
  runOnce?: () => Promise<number>;
  shouldContinue?: () => boolean;
  sleep?: (delayMs: number) => Promise<void>;
  backfillOptions?: BackfillOptions;
};

async function runCollectorBootPrep() {
  runMigrations(config.databasePath);
}

async function runCollectorIteration() {
  const client = createBscRpcClient(config.bscRpcUrl);
  const latestBlock = await client.getBlockNumber();
  const lookbackBlocks = BigInt(Math.max(config.collectorLookbackBlocks, 1));
  const batchBlocks = BigInt(Math.max(config.collectorBatchBlocks, 1));
  const fromBlock = latestBlock > lookbackBlocks ? latestBlock - lookbackBlocks : 0n;

  const [fourEvents, flapEvents] = await Promise.all([
    collectFourLaunchEvents(client, fromBlock, latestBlock, batchBlocks),
    collectFlapLaunchEvents(client, fromBlock, latestBlock, batchBlocks),
  ]);

  const events = [...fourEvents, ...flapEvents];
  for (const event of events) {
    insertLaunchEvent(event);
  }
  return events.length;
}

export async function runCollectorOnce() {
  await runCollectorBootPrep();
  await runBackfillOnce({ logger: console });
  return runCollectorIteration();
}

export async function runCollectorLoop({
  delayMs = COLLECTOR_POLL_DELAY_MS,
  bootPrep = runCollectorBootPrep,
  logger,
  runOnce = runCollectorIteration,
  shouldContinue,
  sleep,
  backfillOptions,
}: CollectorLoopOptions = {}) {
  await bootPrep();
  
  // Run backfill before starting the polling loop
  // In test mode or when explicitly skipped, backfill will be skipped
  await runBackfillOnce({ 
    logger: logger ?? console,
    skipBackfill: backfillOptions?.skipBackfill,
  });
  
  await runPollingLoop({
    delayMs,
    logger,
    onErrorMessage: "collector iteration failed",
    onSuccess: async () => {
      // Intentionally logged in runOnce wrapper below.
    },
    runOnce: async () => {
      const count = await runOnce();
      (logger ?? console).info(`collector inserted ${count} launch events`);
    },
    shouldContinue,
    sleep,
    startMessage: "collector boot",
  });
}

if (import.meta.main) {
  runCollectorLoop().catch((error) => {
    console.error(error);
    process.exit(1);
  });
}
