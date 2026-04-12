import { createBscRpcClient } from "../src/collectors/rpc";
import { collectFourLaunchEvents } from "../src/collectors/four";

const BSC_RPC_URL = "https://public-bsc.nownodes.io/";

async function main() {
  const client = createBscRpcClient(BSC_RPC_URL);
  const latestBlock = await client.getBlockNumber();

  console.log(`Latest block: ${latestBlock}`);

  // Test with different lookback ranges
  const ranges = [
    { blocks: 200n, label: "200 blocks (~10 min)" },
    { blocks: 1000n, label: "1000 blocks (~50 min)" },
    { blocks: 10000n, label: "10000 blocks (~8 hours)" },
  ];

  for (const range of ranges) {
    const fromBlock = latestBlock - range.blocks;
    console.log(`\nTesting ${range.label}: blocks ${fromBlock} to ${latestBlock}`);

    const events = await collectFourLaunchEvents(client, fromBlock, latestBlock, 2000n);
    console.log(`Found ${events.length} Four events`);

    if (events.length > 0) {
      console.log("Sample event:", JSON.stringify(events[0], null, 2));
    }
  }
}

main().catch(console.error);
