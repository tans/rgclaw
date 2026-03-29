import { config } from "../shared/config";
import { runMigrations } from "../db/migrate";
import { insertLaunchEvent } from "../db/repositories/launch-events";
import { createBscRpcClient } from "./rpc";
import { collectFlapLaunchEvents } from "./flap";
import { collectFourLaunchEvents } from "./four";

export async function runCollectorOnce() {
  runMigrations(config.databasePath);
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

async function boot() {
  console.log("collector boot");
  const count = await runCollectorOnce();
  console.log(`collector inserted ${count} launch events`);
}

boot().catch((error) => {
  console.error(error);
  process.exit(1);
});
