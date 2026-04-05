-- Deduplicate launch_events by (source, token_address)
-- First update dedupe_key to be source:token_address for all existing rows
UPDATE launch_events SET dedupe_key = source || ':' || token_address WHERE 1=1;

-- Now enforce uniqueness on (source, token_address) instead of dedupe_key alone
-- Drop the old unique constraint and recreate
CREATE UNIQUE INDEX IF NOT EXISTS idx_launch_events_source_token ON launch_events(source, token_address);
DROP INDEX IF EXISTS idx_launch_events_dedupe_key;

