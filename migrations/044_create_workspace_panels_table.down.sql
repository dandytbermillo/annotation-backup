-- Migration 044 Rollback: Drop workspace_panels table

BEGIN;

-- Drop the trigger first
DROP TRIGGER IF EXISTS trg_workspace_panels_updated_at ON workspace_panels;

-- Drop indexes
DROP INDEX IF EXISTS idx_workspace_panels_workspace_id;
DROP INDEX IF EXISTS idx_workspace_panels_type;

-- Drop the table
DROP TABLE IF EXISTS workspace_panels;

COMMIT;
