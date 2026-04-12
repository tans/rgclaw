import { createBscRpcClient } from "../src/collectors/rpc";
import { collectFourLaunchEvents } from "../src/collectors/four";

const BSC_RPC_URL = "https://public-bsc.nownodes.io/";

async function main() {
  const client = createBscRpcClient(BSC_RPC_URL);
  const latestBlock = await client.getBlockNumber();
  const fromBlock = latestBlock - 10000n;

  console.log(`Scanning blocks ${fromBlock} to ${latestBlock}`);

  const events = await collectFourLaunchEvents(client, fromBlock, latestBlock, 2000n);
  console.log(`\nFound ${events.length} Four events:\n`);

  for (const event of events) {
    console.log(`Token: ${event.tokenAddress}`);
    console.log(`Event ID: ${event.sourceEventId}`);
    console.log(`Dedupe Key: ${event.dedupeKey}`);
    console.log(`Event Time: ${event.eventTime}`);
    console.log(`---`);
  }
}

main().catch(console.error);
