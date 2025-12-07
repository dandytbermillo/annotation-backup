-- Migration 051: Add is_visible column to workspace_panels
-- Purpose: Allow panels to be hidden without being deleted
-- When user clicks X on a panel, it becomes hidden instead of deleted
-- User can re-open hidden panels from Links Overview or other UI

BEGIN;

-- Add is_visible column with default true (all existing panels are visible)
ALTER TABLE workspace_panels
  ADD COLUMN IF NOT EXISTS is_visible BOOLEAN NOT NULL DEFAULT true;

-- Index for efficient filtering of visible panels
CREATE INDEX IF NOT EXISTS idx_workspace_panels_is_visible
  ON workspace_panels(workspace_id, is_visible)
  WHERE is_visible = true;

-- Comment for documentation
COMMENT ON COLUMN workspace_panels.is_visible IS 'Whether the panel is visible on the dashboard. False means hidden (user clicked X). Can be restored.';

COMMIT;
