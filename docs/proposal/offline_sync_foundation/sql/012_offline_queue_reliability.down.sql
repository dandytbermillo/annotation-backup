DROP FUNCTION IF EXISTS move_to_dead_letter(INTEGER);
DROP TABLE IF EXISTS offline_dead_letter;
DROP INDEX IF EXISTS idx_offline_queue_entity_status;
DROP INDEX IF EXISTS idx_offline_queue_status_priority_created;
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'offline_queue_idempotency_key_uniq'
  ) THEN
    ALTER TABLE offline_queue
      DROP CONSTRAINT offline_queue_idempotency_key_uniq;
  END IF;
END$$;
ALTER TABLE offline_queue
  DROP COLUMN IF EXISTS depends_on,
  DROP COLUMN IF EXISTS group_id,
  DROP COLUMN IF EXISTS expires_at,
  DROP COLUMN IF EXISTS priority,
  DROP COLUMN IF EXISTS schema_version,
  DROP COLUMN IF EXISTS origin_device_id,
  DROP COLUMN IF EXISTS idempotency_key;