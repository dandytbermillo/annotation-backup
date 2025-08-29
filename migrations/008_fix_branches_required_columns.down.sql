-- Rollback: 008 - Restore NOT NULL constraints on Yjs columns

BEGIN;

-- Note: This will fail if there are NULL values in these columns
-- You may need to update NULL values before running this rollback

ALTER TABLE branches
  ALTER COLUMN branch_id SET NOT NULL,
  ALTER COLUMN source_panel SET NOT NULL,
  ALTER COLUMN target_panel SET NOT NULL,
  ALTER COLUMN anchor_start SET NOT NULL,
  ALTER COLUMN anchor_end SET NOT NULL,
  ALTER COLUMN "order" SET NOT NULL;

COMMIT;