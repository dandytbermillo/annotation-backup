-- Rollback: 006 - Remove plain-mode columns from branches

BEGIN;

-- Drop index first
DROP INDEX IF EXISTS idx_branches_parent_id;

-- Remove columns (safe even if they were never added)
ALTER TABLE branches
  DROP COLUMN IF EXISTS anchors,
  DROP COLUMN IF EXISTS parent_id;

COMMIT;

