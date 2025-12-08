-- Migration 053: Add links_note_tiptap panel type
-- Part of Quick Links TipTap Version feature
-- Purpose: Add links_note_tiptap panel type for TipTap-based Quick Links panel

BEGIN;

-- Drop existing constraint
ALTER TABLE workspace_panels DROP CONSTRAINT IF EXISTS workspace_panels_panel_type_check;

-- Add updated constraint with links_note_tiptap panel type
ALTER TABLE workspace_panels ADD CONSTRAINT workspace_panels_panel_type_check
  CHECK (panel_type IN ('note', 'navigator', 'recent', 'continue', 'quick_capture', 'links_note', 'links_note_tiptap', 'category', 'category_navigator'));

-- Add comment
COMMENT ON COLUMN workspace_panels.panel_type IS 'Type of panel: note (text editor), navigator (entry tree), recent (recent workspaces), continue (resume last workspace), quick_capture (quick note input), links_note (note with workspace links), links_note_tiptap (TipTap-based note with workspace links), category (organize entries by category), category_navigator (browse all categories)';

COMMIT;
