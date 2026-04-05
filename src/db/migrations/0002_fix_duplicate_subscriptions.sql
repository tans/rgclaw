-- Migration: Fix duplicate user source subscriptions
-- Issue: user_source_subscriptions table missing UNIQUE constraint on (user_id, source)
-- Evidence: user e12e59e6-d584-4579-928a-e04c42b3a4d2 has 22 flap and 22 four subscriptions

-- Step 1: Delete duplicate subscriptions, keeping the one with highest id (most recent)
DELETE FROM user_source_subscriptions
WHERE id NOT IN (
    SELECT MAX(id)
    FROM user_source_subscriptions
    GROUP BY user_id, source
);

-- Step 2: Add unique index to prevent future duplicates
CREATE UNIQUE INDEX IF NOT EXISTS idx_user_source_unique ON user_source_subscriptions(user_id, source);
