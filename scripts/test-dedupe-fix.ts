import { createBscRpcClient } from "../src/collectors/rpc";
import { collectFourLaunchEvents } from "../src/collectors/four";
import { insertLaunchEvent } from "../src/db/repositories/launch-events";
import { openDb } from "../src/db/sqlite";

const BSC_RPC_URL = "https://public-bsc.nownodes.io/";

async function main() {
  const client = createBscRpcClient(BSC_RPC_URL);
  const latestBlock = await client.getBlockNumber();
  const fromBlock = latestBlock - 10000n;

  console.log(`Scanning blocks ${fromBlock} to ${latestBlock}`);

  const events = await collectFourLaunchEvents(client, fromBlock, latestBlock, 2000n);
  console.log(`\nFound ${events.length} Four events`);

  // Try to insert all events
  let inserted = 0;
  let ignored = 0;

  for (const event of events) {
    const db = openDb();
    const before = db.query("SELECT COUNT(*) as count FROM launch_events").get() as { count: number };
    db.close();

    insertLaunchEvent(event);

    const db2 = openDb();
    const after = db2.query("SELECT COUNT(*) as count FROM launch_events").get() as { count: number };
    db2.close();

    if (after.count > before.count) {
      inserted++;
      console.log(`✓ Inserted: ${event.sourceEventId} (${event.eventTime})`);
    } else {
      ignored++;
      console.log(`- Ignored (duplicate): ${event.sourceEventId} (${event.eventTime})`);
    }
  }

  console.log(`\nSummary: ${inserted} inserted, ${ignored} ignored`);
}

main().catch(console.error);
