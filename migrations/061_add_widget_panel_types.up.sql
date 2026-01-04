-- Migration: Add widget panel types to workspace_panels
-- Phase 3.2: sandbox_widget for custom sandboxed widgets
-- Also adds demo and widget_manager for built-in widget panels

-- Drop existing constraint
ALTER TABLE workspace_panels DROP CONSTRAINT IF EXISTS workspace_panels_panel_type_check;

-- Add updated constraint with widget panel types
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
    'category_navigator',
    'demo',
    'widget_manager',
    'sandbox_widget'
  ));

-- Update column comment
COMMENT ON COLUMN workspace_panels.panel_type IS 'Type of panel: note, navigator, recent, continue, quick_capture, links_note, links_note_tiptap, category, category_navigator, demo (demo widget), widget_manager (manage installed widgets), sandbox_widget (custom sandboxed widget)';
