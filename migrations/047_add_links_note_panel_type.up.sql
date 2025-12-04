-- Migration 047: Add links_note panel type
-- Part of Dashboard Implementation - Phase 2.2e
-- Purpose: Add the links_note panel type for workspace links

BEGIN;

-- Drop existing constraint
ALTER TABLE workspace_panels DROP CONSTRAINT IF EXISTS workspace_panels_panel_type_check;

-- Add updated constraint with links_note type
ALTER TABLE workspace_panels ADD CONSTRAINT workspace_panels_panel_type_check
  CHECK (panel_type IN ('note', 'navigator', 'recent', 'continue', 'quick_capture', 'links_note'));

-- Update existing "Quick Links" note panels to use links_note type
UPDATE workspace_panels
SET panel_type = 'links_note'
WHERE panel_type = 'note' AND title = 'Quick Links';

-- Add comment
COMMENT ON COLUMN workspace_panels.panel_type IS 'Type of panel: note (text editor), navigator (entry tree), recent (recent workspaces), continue (resume last workspace), quick_capture (quick note input), links_note (note with workspace links)';

COMMIT;
