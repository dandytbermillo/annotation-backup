-- Rollback Migration 066: Revert "Links Panel" back to "Link Notes" in workspace_panels titles
--
-- This rollback reverts default panel titles only.

BEGIN;

-- Revert titles for links_note panels with default naming pattern
-- Pattern: "Links Panel A" -> "Link Notes A", etc.
UPDATE workspace_panels
SET title = REGEXP_REPLACE(title, '^Links Panel ([A-E])$', 'Link Notes \1')
WHERE panel_type IN ('links_note', 'links_note_tiptap')
  AND title ~ '^Links Panel [A-E]$';

-- Revert "Links Panel" back to "Quick Links" (old naming convention)
UPDATE workspace_panels
SET title = 'Quick Links'
WHERE panel_type IN ('links_note', 'links_note_tiptap')
  AND title = 'Links Panel';

COMMIT;
