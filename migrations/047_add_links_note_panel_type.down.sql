-- Migration 047: Remove links_note panel type (rollback)
-- Part of Dashboard Implementation - Phase 2.2e
-- Purpose: Revert links_note panel type back to note

BEGIN;

-- Revert links_note panels back to note type
UPDATE workspace_panels
SET panel_type = 'note'
WHERE panel_type = 'links_note';

-- Drop updated constraint
ALTER TABLE workspace_panels DROP CONSTRAINT IF EXISTS workspace_panels_panel_type_check;

-- Restore original constraint without links_note
ALTER TABLE workspace_panels ADD CONSTRAINT workspace_panels_panel_type_check
  CHECK (panel_type IN ('note', 'navigator', 'recent', 'continue', 'quick_capture'));

-- Restore original comment
COMMENT ON COLUMN workspace_panels.panel_type IS 'Type of panel: note (text editor), navigator (entry tree), recent (recent workspaces), continue (resume last workspace), quick_capture (quick note input)';

COMMIT;
