-- Rollback Phase 1: Tree Structure for Notes/Folders

-- Drop compatibility view
DROP VIEW IF EXISTS notes_compat;

-- Remove dual-write columns
ALTER TABLE branches DROP COLUMN IF EXISTS item_id;
ALTER TABLE panels DROP COLUMN IF EXISTS item_id;

-- Drop functions
DROP FUNCTION IF EXISTS verify_migration() CASCADE;
DROP FUNCTION IF EXISTS move_item(UUID, UUID, INTEGER) CASCADE;
DROP FUNCTION IF EXISTS check_folder_limits() CASCADE;
DROP FUNCTION IF EXISTS check_no_cycles() CASCADE;
DROP FUNCTION IF EXISTS update_updated_at() CASCADE;
DROP FUNCTION IF EXISTS normalize_path(TEXT) CASCADE;

-- Drop triggers (if not already dropped by CASCADE)
DROP TRIGGER IF EXISTS trg_check_folder_limits ON items;
DROP TRIGGER IF EXISTS trg_prevent_cycles ON items;
DROP TRIGGER IF EXISTS trg_items_updated_at ON items;

-- Drop table
DROP TABLE IF EXISTS items CASCADE;

-- Note: We keep pg_trgm and unaccent extensions as they might be used elsewhere