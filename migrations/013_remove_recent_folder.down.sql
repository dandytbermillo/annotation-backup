-- Rollback: Restore Recent folder

-- Restore the Recent folder
UPDATE items 
SET deleted_at = NULL
WHERE path = '/recent' 
  AND type = 'folder';

-- If Recent folder was completely deleted, recreate it
INSERT INTO items (id, type, path, name, position) 
VALUES (gen_random_uuid(), 'folder', '/recent', 'Recent', -1000)
ON CONFLICT (path) WHERE deleted_at IS NULL DO NOTHING;