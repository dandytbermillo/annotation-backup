-- Rollback Migration 048: Revert Quick Links panel to note type

BEGIN;

-- Revert Quick Links panels back to 'note' type
UPDATE workspace_panels
SET
  panel_type = 'note',
  config = jsonb_set(
    config,
    '{content}',
    '"<h3>Daily Work</h3><p>Add workspace links here...</p><h3>Projects</h3><p>Organize your projects...</p>"'::jsonb
  )
WHERE panel_type = 'links_note'
  AND title = 'Quick Links';

COMMIT;
