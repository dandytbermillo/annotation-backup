-- Migration 046 Rollback: Remove dashboard seeding
-- Warning: This will delete all Home entries, Dashboard workspaces, and associated data

BEGIN;

-- Step 1: Make item_id nullable again
ALTER TABLE note_workspaces ALTER COLUMN item_id DROP NOT NULL;

-- Step 2: Clear item_id from workspaces that were assigned to Legacy
UPDATE note_workspaces nw
SET item_id = NULL
FROM items legacy
WHERE legacy.id = nw.item_id
  AND legacy.name = 'Legacy Workspaces';

-- Step 3: Delete all workspace_panels for Dashboard workspaces
DELETE FROM workspace_panels wp
WHERE wp.workspace_id IN (
  SELECT nw.id
  FROM note_workspaces nw
  JOIN items home ON nw.item_id = home.id
  WHERE home.is_system = TRUE AND home.name = 'Home'
);

-- Step 4: Delete user_preferences records
DELETE FROM user_preferences;

-- Step 5: Delete Dashboard workspaces
DELETE FROM note_workspaces nw
WHERE EXISTS (
  SELECT 1 FROM items home
  WHERE home.id = nw.item_id
    AND home.is_system = TRUE
    AND home.name = 'Home'
);

-- Step 6: Delete Ideas Inbox and Legacy Workspaces entries (children of Home)
DELETE FROM items
WHERE parent_id IN (
  SELECT id FROM items WHERE is_system = TRUE AND name = 'Home'
);

-- Step 7: Delete Home entries
DELETE FROM items WHERE is_system = TRUE AND name = 'Home';

-- Step 8: Drop the user_id index
DROP INDEX IF EXISTS idx_items_user_id;

-- Step 9: Remove user_id column from items
ALTER TABLE items DROP COLUMN IF EXISTS user_id;

COMMIT;
