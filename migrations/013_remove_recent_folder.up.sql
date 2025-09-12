-- Migration: Remove Recent folder from tree view
-- Rationale: Recent notes are shown in dedicated RECENT section, 
-- having a Recent folder in tree creates confusion

-- Soft delete the Recent folder (preserves data integrity)
UPDATE items 
SET deleted_at = NOW()
WHERE path = '/recent' 
  AND type = 'folder'
  AND deleted_at IS NULL;

-- If there were any items in Recent folder (shouldn't be any), move them to Uncategorized
UPDATE items 
SET 
  parent_id = (SELECT id FROM items WHERE path = '/knowledge-base/uncategorized' LIMIT 1),
  path = '/knowledge-base/uncategorized/' || name,
  updated_at = NOW()
WHERE parent_id = (SELECT id FROM items WHERE path = '/recent' LIMIT 1)
  AND deleted_at IS NULL;

-- Add comment for documentation
COMMENT ON COLUMN items.deleted_at IS 'Soft delete timestamp. Recent folder removed in migration 013 to avoid duplication with RECENT section';