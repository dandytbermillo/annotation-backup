-- Migration 045 Rollback: Drop user_preferences table

BEGIN;

-- Drop the trigger first
DROP TRIGGER IF EXISTS trg_user_preferences_updated_at ON user_preferences;

-- Drop indexes
DROP INDEX IF EXISTS idx_user_preferences_user_id;

-- Drop the table
DROP TABLE IF EXISTS user_preferences;

COMMIT;
