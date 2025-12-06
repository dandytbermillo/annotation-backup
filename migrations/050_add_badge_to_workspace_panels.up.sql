-- Migration 050: Add badge column to workspace_panels
-- Purpose: Store single-letter badge (A, B, C...) for links_note panels
-- Used for entry naming (e.g., "test5 A" instead of "test5 1")

BEGIN;

-- Add badge column (single character, nullable)
ALTER TABLE workspace_panels
  ADD COLUMN IF NOT EXISTS badge CHAR(1);

-- Add comment for documentation
COMMENT ON COLUMN workspace_panels.badge IS 'Single-letter badge (A-Z) for links_note panels. Auto-assigned based on creation order within a workspace.';

-- Create index for efficient badge lookup within a workspace
CREATE INDEX IF NOT EXISTS idx_workspace_panels_badge
  ON workspace_panels(workspace_id, badge)
  WHERE panel_type = 'links_note' AND badge IS NOT NULL;

COMMIT;
