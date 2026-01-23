-- Migration 066: Rename "Link Notes" to "Links Panel" in workspace_panels titles
-- Part of naming standardization to avoid confusion with actual notes
--
-- This migration updates default panel titles only. User-customized titles are preserved.

BEGIN;

-- Update titles for links_note panels with default naming pattern
-- Pattern: "Link Notes A" -> "Links Panel A", "Link Notes B" -> "Links Panel B", etc.
UPDATE workspace_panels
SET title = REGEXP_REPLACE(title, '^Link Notes ([A-E])$', 'Links Panel \1')
WHERE panel_type IN ('links_note', 'links_note_tiptap')
  AND title ~ '^Link Notes [A-E]$';

-- Also handle any "Quick Links" titled panels (old naming convention)
UPDATE workspace_panels
SET title = 'Links Panel'
WHERE panel_type IN ('links_note', 'links_note_tiptap')
  AND title = 'Quick Links';

COMMIT;
