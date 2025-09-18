-- Revert workspace-scoped uniqueness back to global uniqueness

-- 1. Drop the workspace-scoped unique constraints
DROP INDEX IF EXISTS ux_items_workspace_path;
DROP INDEX IF EXISTS ux_items_workspace_parent_slug;

-- 2. Recreate the old global unique constraints
CREATE UNIQUE INDEX ux_items_path 
  ON items(path) 
  WHERE deleted_at IS NULL;

CREATE UNIQUE INDEX ux_items_parent_slug 
  ON items(parent_id, slug) 
  WHERE deleted_at IS NULL;

-- 3. Remove comment
COMMENT ON TABLE items IS NULL;