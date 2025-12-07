-- Migration 052: Add deleted_at column to workspace_panels for soft delete (trash)
-- Purpose: Allow panels to be "deleted" to trash instead of permanently removed
-- Panels with deleted_at = NULL are active (visible or hidden)
-- Panels with deleted_at = timestamp are in trash (can be restored or auto-purged)

BEGIN;

-- Add deleted_at column (NULL means not deleted)
ALTER TABLE workspace_panels
  ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ DEFAULT NULL;

-- Index for efficient filtering of non-deleted panels
-- This partial index only includes rows where deleted_at IS NULL
CREATE INDEX IF NOT EXISTS idx_workspace_panels_not_deleted
  ON workspace_panels(workspace_id)
  WHERE deleted_at IS NULL;

-- Index for finding panels to auto-purge (deleted more than 30 days ago)
CREATE INDEX IF NOT EXISTS idx_workspace_panels_deleted_at
  ON workspace_panels(deleted_at)
  WHERE deleted_at IS NOT NULL;

-- Comment for documentation
COMMENT ON COLUMN workspace_panels.deleted_at IS 'Timestamp when panel was moved to trash. NULL means active. Non-NULL means in trash (can be restored or will be auto-purged after 30 days).';

COMMIT;
