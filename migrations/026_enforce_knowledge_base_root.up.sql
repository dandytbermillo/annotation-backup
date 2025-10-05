-- Migration: Enforce Knowledge Base as the only root directory
-- Rationale: Organization tree view should only show Knowledge Base as root
-- All user content must be organized under /knowledge-base

-- Step 1: Ensure /knowledge-base/uncategorized exists
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM items WHERE path = '/knowledge-base/uncategorized' AND deleted_at IS NULL) THEN
    INSERT INTO items (type, parent_id, path, name, position)
    SELECT
      'folder',
      kb.id,
      '/knowledge-base/uncategorized',
      'Uncategorized',
      999
    FROM items kb
    WHERE kb.path = '/knowledge-base' AND kb.deleted_at IS NULL;
  END IF;
END $$;

-- Step 2: Move all orphaned root-level items (except Knowledge Base) to /knowledge-base/uncategorized
-- This includes both notes and folders that were incorrectly created at root level
WITH uncategorized AS (
  SELECT id FROM items WHERE path = '/knowledge-base/uncategorized' AND deleted_at IS NULL LIMIT 1
),
root_items_to_move AS (
  SELECT id, name, type, path
  FROM items
  WHERE parent_id IS NULL
    AND path != '/knowledge-base'
    AND deleted_at IS NULL
)
UPDATE items
SET
  parent_id = (SELECT id FROM uncategorized),
  path = '/knowledge-base/uncategorized/' || rim.name,
  updated_at = NOW()
FROM root_items_to_move rim
WHERE items.id = rim.id;

-- Step 3: Update descendants of moved folders to fix their paths
-- This is a recursive operation to ensure all nested items get correct paths
WITH RECURSIVE moved_folders AS (
  -- Get all folders that were just moved to uncategorized
  SELECT id, name, '/knowledge-base/uncategorized/' || name AS new_base_path
  FROM items
  WHERE parent_id = (SELECT id FROM items WHERE path = '/knowledge-base/uncategorized' LIMIT 1)
    AND type = 'folder'
    AND deleted_at IS NULL
),
descendants AS (
  -- Get immediate children of moved folders
  SELECT
    i.id,
    i.name,
    i.parent_id,
    mf.new_base_path || '/' || i.name AS new_path,
    1 AS depth
  FROM items i
  JOIN moved_folders mf ON i.parent_id = mf.id
  WHERE i.deleted_at IS NULL

  UNION ALL

  -- Recursively get all deeper descendants
  SELECT
    i.id,
    i.name,
    i.parent_id,
    d.new_path || '/' || i.name AS new_path,
    d.depth + 1
  FROM items i
  JOIN descendants d ON i.parent_id = d.id
  WHERE i.deleted_at IS NULL AND d.depth < 100
)
UPDATE items i
SET
  path = d.new_path,
  updated_at = NOW()
FROM descendants d
WHERE i.id = d.id;

-- Step 4: Add constraint to prevent new root items (except Knowledge Base)
-- This trigger will block any INSERT/UPDATE that tries to create a root item
CREATE OR REPLACE FUNCTION enforce_knowledge_base_root()
RETURNS TRIGGER AS $$
BEGIN
  -- Allow Knowledge Base itself
  IF NEW.path = '/knowledge-base' AND NEW.parent_id IS NULL THEN
    RETURN NEW;
  END IF;

  -- Block any other root-level items
  IF NEW.parent_id IS NULL THEN
    RAISE EXCEPTION 'Only Knowledge Base folder can exist at root level. All items must be created under /knowledge-base. Attempted path: %', NEW.path;
  END IF;

  -- Ensure path starts with /knowledge-base (unless it's being deleted)
  IF NEW.deleted_at IS NULL AND NEW.path NOT LIKE '/knowledge-base%' THEN
    RAISE EXCEPTION 'All items must have paths under /knowledge-base. Attempted path: %', NEW.path;
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_enforce_knowledge_base_root ON items;
CREATE TRIGGER trg_enforce_knowledge_base_root
  BEFORE INSERT OR UPDATE ON items
  FOR EACH ROW
  EXECUTE FUNCTION enforce_knowledge_base_root();

-- Step 5: Add documentation comment
COMMENT ON TABLE items IS 'Hierarchical tree structure for notes and folders. Knowledge Base (/knowledge-base) is the only allowed root directory. Migration 026 enforces this constraint.';
COMMENT ON TRIGGER trg_enforce_knowledge_base_root ON items IS 'Enforces that Knowledge Base is the only root directory. All user content must exist under /knowledge-base.';
