# Context Snapshot: Backfill First 10,000 Blocks

## Task Statement
Add historical backfill functionality to sync the first 10,000 blocks for token launch events (Flap and Four.meme) in addition to the existing real-time polling.

## Desired Outcome
- A backfill script/process that can scan blocks 0-10000 for both Flap and Four.meme launch events
- Events found during backfill should be inserted into the database with deduplication
- Backfill should complete before or run alongside real-time collection
- No duplicate events should be created

## Known Facts/Evidence
- Project: rgclaw - BSC token launch event collector
- Current collector: src/collectors/run.ts with polling loop
- Supports two sources:
  - Flap: 0xe2ce6ab80874fa9fa2aae65d277dd6b8e65c9de0, topic 0x115c78ad17c4763fb97bca94f3e59dc8cb2e59c9d3862f24a694ec401200f562
  - Four: 0x5c952063c7fc8610ffdb798152d69f0b9550762b, topic 0x7db52723a3b2cdd6164364b3b766e65e540d7be48ffa89582956d8eaebe62942
- Database: SQLite with launch_events table, dedupe_key for uniqueness
- RPC: BSC via configurable URL (default: https://public-bsc.nownodes.io/)
- Existing batching: getLogsInBatches helper in rpc.ts
- Current lookback: 200 blocks (COLLECTOR_LOOKBACK_BLOCKS)

## Constraints
- Must use existing CollectorClient abstraction
- Must use existing insertLaunchEvent with deduplication
- Must respect rate limits (batch size already configurable)
- Should be runnable independently or as part of startup

## Unknowns/Open Questions
- Should backfill run once at startup or be a separate command?
- How to track backfill progress to resume if interrupted?
- Should backfill be blocking before real-time starts?

## Likely Codebase Touchpoints
- src/collectors/run.ts - main entry point
- src/collectors/flap.ts - Flap event collection
- src/collectors/four.ts - Four event collection
- src/collectors/rpc.ts - batching utilities
- src/db/repositories/launch-events.ts - database insertion
