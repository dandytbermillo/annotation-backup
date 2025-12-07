-- Migration 051 DOWN: Remove is_visible column from workspace_panels

BEGIN;

-- Drop the index first
DROP INDEX IF EXISTS idx_workspace_panels_is_visible;

-- Remove the column
ALTER TABLE workspace_panels DROP COLUMN IF EXISTS is_visible;

COMMIT;
