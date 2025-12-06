-- Migration 049: Remove category panel types (rollback)
-- Part of Category Navigator feature - Phase 3
-- Purpose: Revert category panel types

BEGIN;

-- Remove any category panels first
DELETE FROM workspace_panels WHERE panel_type IN ('category', 'category_navigator');

-- Drop updated constraint
ALTER TABLE workspace_panels DROP CONSTRAINT IF EXISTS workspace_panels_panel_type_check;

-- Restore previous constraint without category types
ALTER TABLE workspace_panels ADD CONSTRAINT workspace_panels_panel_type_check
  CHECK (panel_type IN ('note', 'navigator', 'recent', 'continue', 'quick_capture', 'links_note'));

-- Restore previous comment
COMMENT ON COLUMN workspace_panels.panel_type IS 'Type of panel: note (text editor), navigator (entry tree), recent (recent workspaces), continue (resume last workspace), quick_capture (quick note input), links_note (note with workspace links)';

COMMIT;
