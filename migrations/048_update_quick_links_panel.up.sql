-- Migration 048: Update Quick Links panel to links_note type with sample content
-- Part of Dashboard Implementation - LinksNotePanel enhancement

BEGIN;

-- Update existing Quick Links panels:
-- 1. Change panel_type from 'note' to 'links_note'
-- 2. Add sample HTML content matching the reference design
UPDATE workspace_panels
SET
  panel_type = 'links_note',
  config = jsonb_set(
    config,
    '{content}',
    '"<h3>Daily Work</h3><p><span class=\"workspace-link\" data-target=\"Default\">Default</span> - main tasks</p><p><span class=\"workspace-link\" data-target=\"Dashboard\">Dashboard</span> - home base</p><h3>Quick Access</h3><p>Add your frequently used workspaces here using Edit mode.</p><p>Use <kbd>Cmd+K</kbd> to link selected text to a workspace.</p>"'::jsonb
  )
WHERE panel_type = 'note'
  AND title = 'Quick Links';

-- Also update any 'links_note' panels that might have empty content
UPDATE workspace_panels
SET config = jsonb_set(
  config,
  '{content}',
  '"<h3>Daily Work</h3><p><span class=\"workspace-link\" data-target=\"Default\">Default</span> - main tasks</p><p><span class=\"workspace-link\" data-target=\"Dashboard\">Dashboard</span> - home base</p><h3>Quick Access</h3><p>Add your frequently used workspaces here using Edit mode.</p><p>Use <kbd>Cmd+K</kbd> to link selected text to a workspace.</p>"'::jsonb
)
WHERE panel_type = 'links_note'
  AND (config->>'content' IS NULL OR config->>'content' = '');

COMMIT;
