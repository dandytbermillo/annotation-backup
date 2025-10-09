-- Migration: 027 - Add title column to branches table
-- Purpose: Persist branch titles reliably instead of relying on localStorage
-- Issue: Branch titles were only stored in panels table (created on first rename)
--         Unrenamed branches had titles only in localStorage cache

BEGIN;

-- 1. Add title column to branches table
ALTER TABLE branches ADD COLUMN title TEXT;

-- 2. Backfill titles from panels table where they exist
-- This preserves any user-customized titles from the panels table
UPDATE branches b
SET title = p.title
FROM panels p
WHERE b.note_id = p.note_id
  AND ('branch-' || b.id::text) = p.panel_id
  AND p.title IS NOT NULL;

-- 3. Set default title for branches without a title (never renamed)
-- Format: "Note on 'original text'" (matching client-side template)
UPDATE branches
SET title = CASE
  WHEN type = 'note' THEN 'Note on "' || COALESCE(SUBSTRING(original_text, 1, 30), '') || '"'
  WHEN type = 'explore' THEN 'Explore on "' || COALESCE(SUBSTRING(original_text, 1, 30), '') || '"'
  WHEN type = 'promote' THEN 'Promote on "' || COALESCE(SUBSTRING(original_text, 1, 30), '') || '"'
  ELSE type || ' on "' || COALESCE(SUBSTRING(original_text, 1, 30), '') || '"'
END
WHERE title IS NULL;

-- 4. Add comment explaining the column
COMMENT ON COLUMN branches.title IS 'User-visible title for the branch/annotation (persisted from creation)';

COMMIT;
