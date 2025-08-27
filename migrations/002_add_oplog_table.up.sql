-- Add oplog table for offline sync support
-- Migration: 002_add_oplog_table.up.sql

BEGIN;

-- Operation log for tracking changes when offline
CREATE TABLE IF NOT EXISTS oplog (
    id BIGSERIAL PRIMARY KEY,
    entity_type TEXT NOT NULL CHECK (entity_type IN ('yjs_update', 'snapshot')),
    entity_id TEXT NOT NULL, -- doc_name
    operation TEXT NOT NULL CHECK (operation IN ('persist', 'compact')),
    payload BYTEA NOT NULL, -- Binary data (update or snapshot)
    timestamp TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    origin TEXT NOT NULL CHECK (origin IN ('local', 'remote')),
    synced BOOLEAN NOT NULL DEFAULT FALSE
);

-- Indexes for efficient querying
CREATE INDEX idx_oplog_sync_pending ON oplog(origin, synced) WHERE synced = FALSE;
CREATE INDEX idx_oplog_entity ON oplog(entity_type, entity_id);
CREATE INDEX idx_oplog_timestamp ON oplog(timestamp DESC);

-- Add unique constraint to snapshots table if not exists
-- This ensures we only keep one snapshot per document
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint 
        WHERE conname = 'snapshots_doc_name_unique'
    ) THEN
        ALTER TABLE snapshots 
        ADD CONSTRAINT snapshots_doc_name_unique UNIQUE (doc_name);
    END IF;
END $$;

-- Comments for documentation
COMMENT ON TABLE oplog IS 'Operation log for offline changes and sync tracking';
COMMENT ON COLUMN oplog.entity_type IS 'Type of entity (yjs_update or snapshot)';
COMMENT ON COLUMN oplog.entity_id IS 'Document name this operation applies to';
COMMENT ON COLUMN oplog.operation IS 'Type of operation performed';
COMMENT ON COLUMN oplog.payload IS 'Binary data payload (YJS update or snapshot)';
COMMENT ON COLUMN oplog.origin IS 'Where the operation originated (local or remote)';
COMMENT ON COLUMN oplog.synced IS 'Whether this operation has been synced to remote';

COMMIT;