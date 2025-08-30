-- Extend queue for reliability and control
ALTER TABLE offline_queue
  ADD COLUMN IF NOT EXISTS idempotency_key TEXT,
  ADD COLUMN IF NOT EXISTS origin_device_id TEXT,
  ADD COLUMN IF NOT EXISTS schema_version INTEGER DEFAULT 1,
  ADD COLUMN IF NOT EXISTS priority SMALLINT DEFAULT 0,
  ADD COLUMN IF NOT EXISTS expires_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS group_id UUID,
  ADD COLUMN IF NOT EXISTS depends_on UUID[];

-- Backfill idempotency_key for existing rows (synthetic)
UPDATE offline_queue
SET idempotency_key = coalesce(idempotency_key, encode(gen_random_bytes(16), 'hex'))
WHERE idempotency_key IS NULL;

-- Enforce uniqueness after backfill
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'offline_queue_idempotency_key_uniq'
  ) THEN
    ALTER TABLE offline_queue
      ADD CONSTRAINT offline_queue_idempotency_key_uniq
      UNIQUE (idempotency_key);
  END IF;
END$$;

-- Helper indexes for scheduling
CREATE INDEX IF NOT EXISTS idx_offline_queue_status_priority_created
  ON offline_queue (status, priority DESC, created_at ASC);
CREATE INDEX IF NOT EXISTS idx_offline_queue_entity_status
  ON offline_queue (table_name, entity_id, status);

-- Dead-letter table
CREATE TABLE IF NOT EXISTS offline_dead_letter (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  queue_id UUID,                        -- original queue item (if retained)
  idempotency_key TEXT,
  type VARCHAR(20) NOT NULL,
  table_name VARCHAR(50) NOT NULL,
  entity_id UUID NOT NULL,
  data JSONB NOT NULL,
  error_message TEXT,
  retry_count INTEGER DEFAULT 0,
  last_error_at TIMESTAMPTZ DEFAULT NOW(),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  archived BOOLEAN DEFAULT FALSE
);

CREATE INDEX IF NOT EXISTS idx_dead_letter_created
  ON offline_dead_letter (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_dead_letter_idempotency
  ON offline_dead_letter (idempotency_key);

COMMENT ON TABLE offline_dead_letter
  IS 'Stores operations that exceeded retry limits for manual triage';

-- Optional: procedure to move failed ops after N retries
CREATE OR REPLACE FUNCTION move_to_dead_letter(max_retries INTEGER)
RETURNS INTEGER
LANGUAGE plpgsql
AS $$
DECLARE
  moved_count INTEGER := 0;
BEGIN
  WITH to_move AS (
    SELECT *
    FROM offline_queue
    WHERE status = 'failed' AND retry_count >= max_retries
    FOR UPDATE SKIP LOCKED
  )
  INSERT INTO offline_dead_letter (queue_id, idempotency_key, type, table_name, entity_id, data, error_message, retry_count, last_error_at)
  SELECT id, idempotency_key, type, table_name, entity_id, data, error_message, retry_count, NOW()
  FROM to_move;

  DELETE FROM offline_queue
  WHERE status = 'failed' AND retry_count >= max_retries;

  GET DIAGNOSTICS moved_count = ROW_COUNT;
  RETURN moved_count;
END
$$;