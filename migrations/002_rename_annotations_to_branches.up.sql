-- Migration: Rename annotations to branches and add Phase 2A features
-- Version: 002
-- Description: Rename annotations table to branches for consistency, add soft delete columns, and create compaction log

BEGIN;

-- Rename the table
ALTER TABLE IF EXISTS annotations RENAME TO branches;

-- Update any indexes
ALTER INDEX IF EXISTS annotations_pkey RENAME TO branches_pkey;
ALTER INDEX IF EXISTS idx_annotations_note_id RENAME TO idx_branches_note_id;

-- Update any foreign key constraints if they exist
-- Note: May need to drop and recreate constraints with new names

-- Add soft delete columns
ALTER TABLE notes ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMP;
ALTER TABLE panels ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMP;
ALTER TABLE branches ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMP;

-- Add snapshot metadata columns
ALTER TABLE snapshots 
  ADD COLUMN IF NOT EXISTS update_count INTEGER DEFAULT 0,
  ADD COLUMN IF NOT EXISTS size_bytes INTEGER;

-- Create compaction log table
CREATE TABLE IF NOT EXISTS compaction_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  doc_name TEXT NOT NULL,
  updates_before INTEGER,
  updates_after INTEGER,
  snapshot_size INTEGER,
  duration_ms INTEGER,
  created_at TIMESTAMP DEFAULT NOW()
);

-- Add partial indexes for soft deletes to improve query performance
CREATE INDEX IF NOT EXISTS idx_notes_active ON notes(id) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_panels_active ON panels(id) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_branches_active ON branches(id) WHERE deleted_at IS NULL;

-- Add index for compaction log queries
CREATE INDEX IF NOT EXISTS idx_compaction_log_doc_name ON compaction_log(doc_name);
CREATE INDEX IF NOT EXISTS idx_compaction_log_created_at ON compaction_log(created_at);

COMMIT;