-- Migration 042: Add item_id column to note_workspaces table
-- Part of Dashboard Implementation Plan - Phase 1.2
-- Purpose: Associate workspaces with entries (items) for the Entry -> Workspace hierarchy
-- Note: Column starts nullable, will be made NOT NULL after backfill in migration 046

BEGIN;

-- Add item_id column (nullable initially for safe migration)
ALTER TABLE note_workspaces ADD COLUMN IF NOT EXISTS item_id UUID;

-- Add foreign key constraint with CASCADE delete
-- When an entry (item) is deleted, all its workspaces are deleted
ALTER TABLE note_workspaces
  DROP CONSTRAINT IF EXISTS fk_note_workspaces_item_id;

ALTER TABLE note_workspaces
  ADD CONSTRAINT fk_note_workspaces_item_id
  FOREIGN KEY (item_id)
  REFERENCES items(id)
  ON DELETE CASCADE;

-- Create index for efficient lookup of workspaces by item
CREATE INDEX IF NOT EXISTS idx_note_workspaces_item_id ON note_workspaces(item_id);

-- Add comment for documentation
COMMENT ON COLUMN note_workspaces.item_id IS 'Reference to the entry (item) that owns this workspace. Part of Entry->Workspace hierarchy.';

COMMIT;
