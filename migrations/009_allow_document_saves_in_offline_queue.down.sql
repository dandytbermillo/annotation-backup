-- Rollback: 009 - Revert offline_queue.table_name CHECK to original set
-- Removes 'document_saves' from allowed table_name values

BEGIN;

-- Dynamically find and drop the current CHECK constraint on table_name
DO $$
DECLARE
  chk_name text;
BEGIN
  SELECT conname INTO chk_name
  FROM pg_constraint c
  JOIN pg_class t ON t.oid = c.conrelid
  WHERE t.relname = 'offline_queue'
    AND c.contype = 'c'
    AND pg_get_constraintdef(c.oid) ILIKE '%table_name%'
    AND pg_get_constraintdef(c.oid) ILIKE '%IN (%';
  
  IF chk_name IS NOT NULL THEN
    EXECUTE format('ALTER TABLE offline_queue DROP CONSTRAINT %I', chk_name);
  END IF;
END $$;

-- Restore original constraint without 'document_saves'
ALTER TABLE offline_queue
  ADD CONSTRAINT offline_queue_table_name_check
  CHECK (table_name IN ('notes', 'branches', 'panels'));

-- Update comment
COMMENT ON CONSTRAINT offline_queue_table_name_check ON offline_queue
  IS 'Original constraint before allowing document_saves';

COMMIT;