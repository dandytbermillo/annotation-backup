-- Migration 050: Remove badge column from workspace_panels
-- Rollback for badge feature

BEGIN;

-- Drop the index first
DROP INDEX IF EXISTS idx_workspace_panels_badge;

-- Remove the badge column
ALTER TABLE workspace_panels
  DROP COLUMN IF EXISTS badge;

COMMIT;
