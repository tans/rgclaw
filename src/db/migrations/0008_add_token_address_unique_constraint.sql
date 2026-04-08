-- Add unique constraint on token_address to prevent duplicate tokens
-- This ensures each token can only have one launch event in the system

-- First, remove any duplicate tokens, keeping only the earliest event
DELETE FROM launch_events
WHERE id NOT IN (
  SELECT MIN(id)
  FROM launch_events
  GROUP BY token_address
);

-- Add unique index on token_address
CREATE UNIQUE INDEX IF NOT EXISTS idx_launch_events_token_address
  ON launch_events (token_address);
