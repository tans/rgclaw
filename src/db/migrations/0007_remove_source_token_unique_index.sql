-- Remove the unique index on (source, token_address) to allow multiple events for the same token
-- The dedupe_key unique constraint is sufficient to prevent true duplicates
DROP INDEX IF EXISTS idx_launch_events_source_token;
