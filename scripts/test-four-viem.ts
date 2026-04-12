import { createBscRpcClient } from "../src/collectors/rpc";
import { collectFourLaunchEvents } from "../src/collectors/four";

const rpc = createBscRpcClient("https://public-bsc.nownodes.io/");
const currentBlock = await rpc.getBlockNumber();
const fromBlock = currentBlock - 10000n;

console.log(`Scanning blocks ${fromBlock} to ${currentBlock}`);

const events = await collectFourLaunchEvents(rpc, fromBlock, currentBlock);

console.log(`\nFound ${events.length} Four events:`);
events.forEach((e, i) => {
  console.log(`\n${i + 1}. Token: ${e.tokenAddress}`);
  console.log(`   Symbol: ${e.symbol}`);
  console.log(`   Event ID: ${e.sourceEventId}`);
  console.log(`   Dedupe Key: ${e.dedupeKey}`);
});
