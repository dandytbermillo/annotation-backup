-- Migration 042 Rollback: Remove item_id column from note_workspaces table

BEGIN;

-- Drop the index first
DROP INDEX IF EXISTS idx_note_workspaces_item_id;

-- Drop the foreign key constraint
ALTER TABLE note_workspaces DROP CONSTRAINT IF EXISTS fk_note_workspaces_item_id;

-- Remove the column
ALTER TABLE note_workspaces DROP COLUMN IF EXISTS item_id;

COMMIT;
