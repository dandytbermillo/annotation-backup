-- Rollback: Remove widget panel types from workspace_panels
-- Warning: This will fail if any rows have panel_type in ('demo', 'widget_manager', 'sandbox_widget')

-- Delete any widget panels first (required for constraint to succeed)
DELETE FROM workspace_panels WHERE panel_type IN ('demo', 'widget_manager', 'sandbox_widget');

-- Drop updated constraint
ALTER TABLE workspace_panels DROP CONSTRAINT IF EXISTS workspace_panels_panel_type_check;

-- Restore previous constraint (from migration 053)
ALTER TABLE workspace_panels ADD CONSTRAINT workspace_panels_panel_type_check
  CHECK (panel_type IN (
    'note',
    'navigator',
    'recent',
    'continue',
    'quick_capture',
    'links_note',
    'links_note_tiptap',
    'category',
    'category_navigator'
  ));

-- Restore previous comment
COMMENT ON COLUMN workspace_panels.panel_type IS 'Type of panel: note (text editor), navigator (entry tree), recent (recent workspaces), continue (resume last workspace), quick_capture (quick note input), links_note (note with workspace links), links_note_tiptap (TipTap-based note with workspace links), category (organize entries by category), category_navigator (browse all categories)';
