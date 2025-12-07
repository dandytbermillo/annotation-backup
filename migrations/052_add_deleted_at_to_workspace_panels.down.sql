-- Migration 052 DOWN: Remove deleted_at column from workspace_panels

BEGIN;

-- Drop the indexes first
DROP INDEX IF EXISTS idx_workspace_panels_not_deleted;
DROP INDEX IF EXISTS idx_workspace_panels_deleted_at;

-- Remove the column
ALTER TABLE workspace_panels DROP COLUMN IF EXISTS deleted_at;

COMMIT;
