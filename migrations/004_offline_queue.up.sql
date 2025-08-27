-- Create offline queue for operations when offline
CREATE TYPE offline_operation_status AS ENUM ('pending', 'processing', 'failed');

CREATE TABLE offline_queue (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  type VARCHAR(20) NOT NULL CHECK (type IN ('create', 'update', 'delete')),
  table_name VARCHAR(50) NOT NULL CHECK (table_name IN ('notes', 'branches', 'panels')),
  entity_id UUID NOT NULL,
  data JSONB NOT NULL,
  retry_count INTEGER DEFAULT 0,
  status offline_operation_status DEFAULT 'pending',
  error_message TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Index for efficient queue processing
CREATE INDEX idx_offline_queue_status ON offline_queue(status, created_at);
CREATE INDEX idx_offline_queue_entity ON offline_queue(table_name, entity_id);

-- Function to update the updated_at timestamp
CREATE OR REPLACE FUNCTION update_offline_queue_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Trigger to automatically update updated_at
CREATE TRIGGER offline_queue_updated_at_trigger
BEFORE UPDATE ON offline_queue
FOR EACH ROW
EXECUTE FUNCTION update_offline_queue_updated_at();

-- Comments
COMMENT ON TABLE offline_queue IS 'Queue for storing operations to be synced when connection is restored';
COMMENT ON COLUMN offline_queue.type IS 'Operation type: create, update, or delete';
COMMENT ON COLUMN offline_queue.table_name IS 'Target table for the operation';
COMMENT ON COLUMN offline_queue.entity_id IS 'ID of the entity being operated on';
COMMENT ON COLUMN offline_queue.data IS 'Full entity data for create/update operations';
COMMENT ON COLUMN offline_queue.retry_count IS 'Number of times this operation has been retried';
COMMENT ON COLUMN offline_queue.status IS 'Current status of the operation';
COMMENT ON COLUMN offline_queue.error_message IS 'Error message if operation failed';