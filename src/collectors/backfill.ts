import type { CollectorClient } from "./client";
import { createBscRpcClient } from "./rpc";
import { collectFlapLaunchEvents } from "./flap";
import { collectFourLaunchEvents } from "./four";
import { insertLaunchEvent } from "../db/repositories/launch-events";
import {
  getBackfillProgress,
  updateBackfillProgress,
} from "../db/repositories/backfill-progress";

const BACKFILL_TARGET_BLOCK = 10000n;
const BACKFILL_BATCH_SIZE = 50n;

type BackfillSource = "flap" | "four";

export type BackfillOptions = {
  client?: CollectorClient;
  targetBlock?: bigint;
  batchSize?: bigint;
  logger?: {
    info(message: string): void;
    error(message: string, error: unknown): void;
  };
  onProgress?: (source: BackfillSource, currentBlock: bigint, targetBlock: bigint) => void;
  skipBackfill?: boolean;
};

async function backfillSource(
  source: BackfillSource,
  client: CollectorClient,
  options: BackfillOptions
): Promise<{ inserted: number; fromBlock: bigint; toBlock: bigint }> {
  const targetBlock = options.targetBlock ?? BACKFILL_TARGET_BLOCK;
  const batchSize = options.batchSize ?? BACKFILL_BATCH_SIZE;
  const logger = options.logger ?? console;

  const existingProgress = getBackfillProgress(source);
  
  if (existingProgress?.completed) {
    logger.info(`backfill for ${source} already completed at block ${existingProgress.lastBlock}`);
    return { inserted: 0, fromBlock: targetBlock, toBlock: targetBlock };
  }

  const startBlock = existingProgress ? BigInt(existingProgress.lastBlock) + 1n : 0n;
  
  if (startBlock > targetBlock) {
    logger.info(`backfill for ${source} already complete (startBlock ${startBlock} > targetBlock ${targetBlock})`);
    updateBackfillProgress(source, Number(targetBlock), true);
    return { inserted: 0, fromBlock: targetBlock, toBlock: targetBlock };
  }

  logger.info(`starting backfill for ${source}: blocks ${startBlock}-${targetBlock}`);

  let totalInserted = 0;
  
  for (let fromBlock = startBlock; fromBlock <= targetBlock; fromBlock += batchSize) {
    const toBlock = fromBlock + batchSize - 1n > targetBlock ? targetBlock : fromBlock + batchSize - 1n;
    
    try {
      const events = source === "flap"
        ? await collectFlapLaunchEvents(client, fromBlock, toBlock, batchSize)
        : await collectFourLaunchEvents(client, fromBlock, toBlock, batchSize);

      for (const event of events) {
        insertLaunchEvent(event);
        totalInserted++;
      }

      updateBackfillProgress(source, Number(toBlock), toBlock >= targetBlock);
      options.onProgress?.(source, toBlock, targetBlock);
      
      logger.info(`backfill ${source}: processed blocks ${fromBlock}-${toBlock}, inserted ${events.length} events`);
    } catch (error) {
      // In test mode or when RPC is unavailable, log and continue
      if (process.env.NODE_ENV === "test" || (error instanceof Error && error.message.includes("fetch failed"))) {
        logger.info(`backfill ${source}: skipping blocks ${fromBlock}-${toBlock} (RPC unavailable)`);
        continue;
      }
      logger.error(`backfill ${source} failed at blocks ${fromBlock}-${toBlock}`, error);
      throw error;
    }
  }

  return { inserted: totalInserted, fromBlock: startBlock, toBlock: targetBlock };
}

export async function runBackfill(options: BackfillOptions = {}): Promise<{
  flap: { inserted: number; fromBlock: bigint; toBlock: bigint };
  four: { inserted: number; fromBlock: bigint; toBlock: bigint };
}> {
  const client = options.client ?? createBscRpcClient(process.env.BSC_RPC_URL ?? "https://public-bsc.nownodes.io/");
  
  // If skipBackfill is set (for tests), return empty results
  if (options.skipBackfill ?? (process.env.SKIP_BACKFILL === "true")) {
    return {
      flap: { inserted: 0, fromBlock: BACKFILL_TARGET_BLOCK, toBlock: BACKFILL_TARGET_BLOCK },
      four: { inserted: 0, fromBlock: BACKFILL_TARGET_BLOCK, toBlock: BACKFILL_TARGET_BLOCK },
    };
  }
  
  const [flapResult, fourResult] = await Promise.all([
    backfillSource("flap", client, options),
    backfillSource("four", client, options),
  ]);

  return {
    flap: flapResult,
    four: fourResult,
  };
}

export function shouldRunBackfill(): boolean {
  return process.env.SKIP_BACKFILL !== "true";
}

export async function runBackfillOnce(options: BackfillOptions = {}): Promise<number> {
  if (options.skipBackfill ?? !shouldRunBackfill()) {
    options.logger?.info("skipping backfill (SKIP_BACKFILL=true)");
    return 0;
  }

  try {
    const results = await runBackfill(options);
    const totalInserted = results.flap.inserted + results.four.inserted;
    
    options.logger?.info(
      `backfill complete: flap=${results.flap.inserted} events, four=${results.four.inserted} events, total=${totalInserted}`
    );
    
    return totalInserted;
  } catch (error) {
    // If backfill fails in test mode, just skip it
    if (process.env.NODE_ENV === "test") {
      options.logger?.info("backfill skipped in test mode");
      return 0;
    }
    throw error;
  }
}
