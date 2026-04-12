import { insertLaunchEvent } from "../src/db/repositories/launch-events";
import { openDb } from "../src/db/sqlite";

// Try to insert the second event manually
const event = {
  source: "four",
  sourceEventId: "0x486dfbb7e41d598f2cd9ba1667a7460e6eb410077d8d6c85beb68990bb4ce3d8:263",
  tokenAddress: "0x000000000000000000a56fa5b99019a5c8000000",
  symbol: null,
  title: null,
  eventTime: "2026-04-08T09:23:20.000Z",
  chain: "bsc",
  rawPayload: "{}",
  dedupeKey: "four:0x486dfbb7e41d598f2cd9ba1667a7460e6eb410077d8d6c85beb68990bb4ce3d8:263",
};

console.log("Before insert:");
const db1 = openDb();
console.log(db1.query("SELECT COUNT(*) as count FROM launch_events").get());
db1.close();

console.log("\nInserting event:", event.sourceEventId);
console.log("Dedupe key:", event.dedupeKey);

try {
  insertLaunchEvent(event);
  console.log("Insert succeeded");
} catch (error) {
  console.log("Insert failed:", error);
}

console.log("\nAfter insert:");
const db2 = openDb();
console.log(db2.query("SELECT COUNT(*) as count FROM launch_events").get());
console.log("\nAll Four events:");
const rows = db2.query("SELECT source_event_id, dedupe_key FROM launch_events WHERE source = 'four'").all();
console.log(rows);
db2.close();
