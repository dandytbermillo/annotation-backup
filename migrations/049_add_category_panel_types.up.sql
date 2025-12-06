-- Migration 049: Add category panel types
-- Part of Category Navigator feature - Phase 3
-- Purpose: Add category and category_navigator panel types

BEGIN;

-- Drop existing constraint
ALTER TABLE workspace_panels DROP CONSTRAINT IF EXISTS workspace_panels_panel_type_check;

-- Add updated constraint with category panel types
ALTER TABLE workspace_panels ADD CONSTRAINT workspace_panels_panel_type_check
  CHECK (panel_type IN ('note', 'navigator', 'recent', 'continue', 'quick_capture', 'links_note', 'category', 'category_navigator'));

-- Add comment
COMMENT ON COLUMN workspace_panels.panel_type IS 'Type of panel: note (text editor), navigator (entry tree), recent (recent workspaces), continue (resume last workspace), quick_capture (quick note input), links_note (note with workspace links), category (organize entries by category), category_navigator (browse all categories)';

COMMIT;
