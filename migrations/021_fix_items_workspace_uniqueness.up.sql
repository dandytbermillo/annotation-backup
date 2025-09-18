-- Fix items uniqueness constraints to be per-workspace instead of global
-- This ensures each workspace can have its own set of files with the same names

-- 1. Drop the old global unique constraints
DROP INDEX IF EXISTS ux_items_path;
DROP INDEX IF EXISTS ux_items_parent_slug;

-- 2. Create new unique constraints that include workspace_id
-- This allows same path in different workspaces but ensures uniqueness within a workspace
CREATE UNIQUE INDEX ux_items_workspace_path 
  ON items(workspace_id, path) 
  WHERE deleted_at IS NULL;

CREATE UNIQUE INDEX ux_items_workspace_parent_slug 
  ON items(workspace_id, parent_id, slug) 
  WHERE deleted_at IS NULL;

-- 3. Add ON CONFLICT handling instruction comment
COMMENT ON TABLE items IS 
'File tree structure. When creating items, use ON CONFLICT (workspace_id, path) WHERE deleted_at IS NULL DO UPDATE to handle duplicates gracefully.';