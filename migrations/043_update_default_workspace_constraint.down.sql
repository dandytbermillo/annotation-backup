-- Migration 043 Rollback: Restore original default workspace constraint

BEGIN;

-- Drop the new per-entry constraint
DROP INDEX IF EXISTS note_workspaces_unique_default_per_entry;

-- Restore the original per-user constraint
-- Note: This may fail if there are now multiple defaults per user
-- In that case, you need to manually resolve conflicts first
CREATE UNIQUE INDEX IF NOT EXISTS note_workspaces_unique_default_per_user
  ON note_workspaces(user_id)
  WHERE is_default;

COMMIT;
