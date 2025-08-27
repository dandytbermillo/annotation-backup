-- Rollback Migration: Revert branches to annotations and remove Phase 2A features
-- Version: 002

BEGIN;

-- Drop indexes added in up migration
DROP INDEX IF EXISTS idx_compaction_log_created_at;
DROP INDEX IF EXISTS idx_compaction_log_doc_name;
DROP INDEX IF EXISTS idx_branches_active;
DROP INDEX IF EXISTS idx_panels_active;
DROP INDEX IF EXISTS idx_notes_active;

-- Drop compaction log table
DROP TABLE IF EXISTS compaction_log;

-- Remove snapshot metadata columns
ALTER TABLE snapshots 
  DROP COLUMN IF EXISTS size_bytes,
  DROP COLUMN IF EXISTS update_count;

-- Remove soft delete columns
ALTER TABLE branches DROP COLUMN IF EXISTS deleted_at;
ALTER TABLE panels DROP COLUMN IF EXISTS deleted_at;
ALTER TABLE notes DROP COLUMN IF EXISTS deleted_at;

-- Rename indexes back
ALTER INDEX IF EXISTS idx_branches_note_id RENAME TO idx_annotations_note_id;
ALTER INDEX IF EXISTS branches_pkey RENAME TO annotations_pkey;

-- Rename the table back
ALTER TABLE IF EXISTS branches RENAME TO annotations;

COMMIT;