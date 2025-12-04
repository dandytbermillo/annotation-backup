-- Migration 046: Dashboard seeding
-- Part of Dashboard Implementation Plan - Phase 1.5
-- Purpose: Create Home entry, Dashboard workspace, Ideas Inbox, and seed default panels
-- This migration also backfills item_id for existing workspaces
-- NOTE: Home entries are created UNDER /knowledge-base to comply with root constraint

BEGIN;

-- Step 1: Add user_id column to items table (for per-user entries)
-- Note: Existing items (Knowledge Base, etc.) will have NULL user_id (shared/global)
ALTER TABLE items ADD COLUMN IF NOT EXISTS user_id UUID;

-- Create index for efficient user-based queries
CREATE INDEX IF NOT EXISTS idx_items_user_id ON items(user_id) WHERE user_id IS NOT NULL;

-- Step 2: Create Home entries for each user who has workspaces
-- Home entries are placed UNDER Knowledge Base to comply with the root constraint
-- Path: /knowledge-base/home-{user_id}
-- workspace_id uses sentinel value (same as Knowledge Base) for system entries
INSERT INTO items (id, user_id, type, path, name, is_system, parent_id, workspace_id, created_at, updated_at)
SELECT
  gen_random_uuid(),
  nw.user_id,
  'folder', -- Using folder type for system entries
  '/knowledge-base/home-' || nw.user_id::text,
  'Home',
  TRUE,
  kb.id, -- Parent is Knowledge Base
  '99999999-9999-9999-9999-999999999999'::uuid, -- Sentinel workspace_id for system entries
  NOW(),
  NOW()
FROM (SELECT DISTINCT user_id FROM note_workspaces) nw
CROSS JOIN (SELECT id FROM items WHERE path = '/knowledge-base' AND deleted_at IS NULL LIMIT 1) kb
WHERE NOT EXISTS (
  SELECT 1 FROM items i
  WHERE i.user_id = nw.user_id AND i.is_system = TRUE
);

-- Step 3: Create Ideas Inbox entry under each user's Home
INSERT INTO items (id, user_id, type, path, name, parent_id, workspace_id, position, created_at, updated_at)
SELECT
  gen_random_uuid(),
  home.user_id,
  'folder',
  home.path || '/ideas-inbox',
  'Ideas Inbox',
  home.id,
  '99999999-9999-9999-9999-999999999999'::uuid, -- Sentinel workspace_id for system entries
  0,
  NOW(),
  NOW()
FROM items home
WHERE home.is_system = TRUE AND home.name = 'Home'
  AND NOT EXISTS (
    SELECT 1 FROM items i
    WHERE i.parent_id = home.id AND i.name = 'Ideas Inbox'
  );

-- Step 4: Create Dashboard workspace for each user under their Home entry
INSERT INTO note_workspaces (id, user_id, item_id, name, is_default, created_at, updated_at)
SELECT
  gen_random_uuid(),
  home.user_id,
  home.id,
  'Dashboard',
  TRUE, -- Dashboard is the default workspace for Home entry
  NOW(),
  NOW()
FROM items home
WHERE home.is_system = TRUE AND home.name = 'Home'
  AND NOT EXISTS (
    SELECT 1 FROM note_workspaces nw
    WHERE nw.user_id = home.user_id AND nw.item_id = home.id
  );

-- Step 5: Create Legacy entry for each user to hold existing workspaces
INSERT INTO items (id, user_id, type, path, name, parent_id, workspace_id, position, created_at, updated_at)
SELECT
  gen_random_uuid(),
  home.user_id,
  'folder',
  home.path || '/legacy-workspaces',
  'Legacy Workspaces',
  home.id,
  '99999999-9999-9999-9999-999999999999'::uuid, -- Sentinel workspace_id for system entries
  1,
  NOW(),
  NOW()
FROM items home
WHERE home.is_system = TRUE AND home.name = 'Home'
  AND EXISTS (
    SELECT 1 FROM note_workspaces nw
    WHERE nw.user_id = home.user_id AND nw.item_id IS NULL
  )
  AND NOT EXISTS (
    SELECT 1 FROM items i
    WHERE i.parent_id = home.id AND i.name = 'Legacy Workspaces'
  );

-- Step 6: Backfill item_id for existing workspaces
-- Assign them to the Legacy Workspaces entry
UPDATE note_workspaces nw
SET item_id = legacy.id
FROM items home
JOIN items legacy ON legacy.parent_id = home.id AND legacy.name = 'Legacy Workspaces'
WHERE home.is_system = TRUE
  AND home.name = 'Home'
  AND home.user_id = nw.user_id
  AND nw.item_id IS NULL
  AND nw.name != 'Dashboard';

-- Step 7: Seed default panels for each Dashboard workspace
-- Using the layout from the implementation plan:
-- | Panel        | Panel Type   | X  | Y   | W   | H   |
-- | Continue     | continue     | 40 | 40  | 320 | 140 |
-- | Navigator    | navigator    | 40 | 200 | 280 | 320 |
-- | Recent       | recent       | 380| 40  | 280 | 220 |
-- | QuickCapture | quick_capture| 380| 280 | 280 | 180 |
-- | Links Note   | note         | 700| 40  | 320 | 320 |

-- Continue Panel
INSERT INTO workspace_panels (id, workspace_id, panel_type, title, position_x, position_y, width, height, z_index, config)
SELECT
  gen_random_uuid(),
  dashboard.id,
  'continue',
  'Continue',
  40, 40, 320, 140,
  1,
  '{}'::jsonb
FROM note_workspaces dashboard
JOIN items home ON dashboard.item_id = home.id
WHERE home.is_system = TRUE AND home.name = 'Home' AND dashboard.name = 'Dashboard'
  AND NOT EXISTS (
    SELECT 1 FROM workspace_panels wp
    WHERE wp.workspace_id = dashboard.id AND wp.panel_type = 'continue'
  );

-- Navigator Panel
INSERT INTO workspace_panels (id, workspace_id, panel_type, title, position_x, position_y, width, height, z_index, config)
SELECT
  gen_random_uuid(),
  dashboard.id,
  'navigator',
  'Entries',
  40, 200, 280, 320,
  2,
  '{"expandedEntries": []}'::jsonb
FROM note_workspaces dashboard
JOIN items home ON dashboard.item_id = home.id
WHERE home.is_system = TRUE AND home.name = 'Home' AND dashboard.name = 'Dashboard'
  AND NOT EXISTS (
    SELECT 1 FROM workspace_panels wp
    WHERE wp.workspace_id = dashboard.id AND wp.panel_type = 'navigator'
  );

-- Recent Panel
INSERT INTO workspace_panels (id, workspace_id, panel_type, title, position_x, position_y, width, height, z_index, config)
SELECT
  gen_random_uuid(),
  dashboard.id,
  'recent',
  'Recent',
  380, 40, 280, 220,
  3,
  '{"limit": 10}'::jsonb
FROM note_workspaces dashboard
JOIN items home ON dashboard.item_id = home.id
WHERE home.is_system = TRUE AND home.name = 'Home' AND dashboard.name = 'Dashboard'
  AND NOT EXISTS (
    SELECT 1 FROM workspace_panels wp
    WHERE wp.workspace_id = dashboard.id AND wp.panel_type = 'recent'
  );

-- Quick Capture Panel
INSERT INTO workspace_panels (id, workspace_id, panel_type, title, position_x, position_y, width, height, z_index, config)
SELECT
  gen_random_uuid(),
  dashboard.id,
  'quick_capture',
  'Quick Capture',
  380, 280, 280, 180,
  4,
  '{}'::jsonb
FROM note_workspaces dashboard
JOIN items home ON dashboard.item_id = home.id
WHERE home.is_system = TRUE AND home.name = 'Home' AND dashboard.name = 'Dashboard'
  AND NOT EXISTS (
    SELECT 1 FROM workspace_panels wp
    WHERE wp.workspace_id = dashboard.id AND wp.panel_type = 'quick_capture'
  );

-- Links Note Panel
INSERT INTO workspace_panels (id, workspace_id, panel_type, title, position_x, position_y, width, height, z_index, config)
SELECT
  gen_random_uuid(),
  dashboard.id,
  'note',
  'Quick Links',
  700, 40, 320, 320,
  5,
  '{"content": "<h3>Daily Work</h3><p>Add workspace links here...</p><h3>Projects</h3><p>Organize your projects...</p>"}'::jsonb
FROM note_workspaces dashboard
JOIN items home ON dashboard.item_id = home.id
WHERE home.is_system = TRUE AND home.name = 'Home' AND dashboard.name = 'Dashboard'
  AND NOT EXISTS (
    SELECT 1 FROM workspace_panels wp
    WHERE wp.workspace_id = dashboard.id AND wp.panel_type = 'note' AND wp.title = 'Quick Links'
  );

-- Step 8: Initialize user_preferences for each user with their Ideas Inbox as quick_capture destination
INSERT INTO user_preferences (id, user_id, quick_capture_entry_id, last_workspace_id)
SELECT
  gen_random_uuid(),
  home.user_id,
  ideas.id,
  NULL
FROM items home
LEFT JOIN items ideas ON ideas.parent_id = home.id AND ideas.name = 'Ideas Inbox'
WHERE home.is_system = TRUE AND home.name = 'Home'
  AND NOT EXISTS (
    SELECT 1 FROM user_preferences up
    WHERE up.user_id = home.user_id
  );

-- Step 9: Enforce item_id NOT NULL on note_workspaces
-- All workspaces should now have item_id (either Home for Dashboard, or Legacy for existing)
-- Note: This may fail if there are orphaned workspaces - check before running
ALTER TABLE note_workspaces ALTER COLUMN item_id SET NOT NULL;

-- Add comments
COMMENT ON COLUMN items.user_id IS 'User who owns this item. NULL for shared/global items like Knowledge Base.';

COMMIT;
