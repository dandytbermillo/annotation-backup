-- Phase 1: Tree Structure for Notes/Folders
-- Following the approved proposal in docs/proposal/user_friendly_tree_view/user-friendly-tree-view-proposal-v2-merged.md

-- Enable required extensions (pgcrypto already enabled in earlier migrations)
CREATE EXTENSION IF NOT EXISTS pg_trgm;   -- For fuzzy search
CREATE EXTENSION IF NOT EXISTS unaccent;  -- For diacritics

-- Path normalization helper function
CREATE OR REPLACE FUNCTION normalize_path(p TEXT)
RETURNS TEXT AS $$
  SELECT CASE 
           WHEN p IS NULL OR p = '' THEN '/'
           ELSE '/' || regexp_replace(trim(both '/' from p), '/+', '/', 'g')
         END;
$$ LANGUAGE sql IMMUTABLE;

-- Main items table (folders and notes)
CREATE TABLE IF NOT EXISTS items (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  type             VARCHAR(10) NOT NULL CHECK (type IN ('folder','note')),
  parent_id        UUID REFERENCES items(id) ON DELETE CASCADE,
  path             TEXT NOT NULL,
  name             VARCHAR(255) NOT NULL,
  slug             VARCHAR(255) GENERATED ALWAYS AS (
                     regexp_replace(lower(name), '[^a-z0-9-]+', '-', 'g')
                   ) STORED,
  position         INTEGER DEFAULT 0,
  content          JSONB,                 -- NULL for folders
  metadata         JSONB NOT NULL DEFAULT '{}',
  icon             VARCHAR(50),
  color            VARCHAR(7),
  last_accessed_at TIMESTAMP,
  created_at       TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at       TIMESTAMP NOT NULL DEFAULT NOW(),
  deleted_at       TIMESTAMP,
  
  -- Constraints
  -- Root rule: allow multiple single-segment roots; non-roots must have parent
  CHECK ((parent_id IS NULL AND path ~ '^/[^/]+$') OR (parent_id IS NOT NULL)),
  -- Advisory depth cap
  CHECK (char_length(path) - char_length(replace(path, '/', '')) <= 100),
  -- Type-specific constraints
  CHECK ((type = 'folder' AND content IS NULL) OR type = 'note')
);

-- Indexes for performance
CREATE UNIQUE INDEX IF NOT EXISTS ux_items_path 
  ON items(path) WHERE deleted_at IS NULL;

CREATE UNIQUE INDEX IF NOT EXISTS ux_items_parent_slug 
  ON items(parent_id, slug) WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_items_parent 
  ON items(parent_id) WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_items_type 
  ON items(type) WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_items_name_trgm 
  ON items USING gin(name gin_trgm_ops) WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_items_path_trgm 
  ON items USING gin(path gin_trgm_ops) WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_notes_recent 
  ON items(last_accessed_at DESC) 
  WHERE type = 'note' AND deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_folders 
  ON items(parent_id, position, name) 
  WHERE type = 'folder' AND deleted_at IS NULL;

-- Update trigger for updated_at
CREATE OR REPLACE FUNCTION update_updated_at()
RETURNS TRIGGER AS $$ 
BEGIN 
  NEW.updated_at = NOW(); 
  RETURN NEW; 
END; 
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_items_updated_at 
  BEFORE UPDATE ON items 
  FOR EACH ROW 
  EXECUTE FUNCTION update_updated_at();

-- Cycle prevention (by ID ancestry)
CREATE OR REPLACE FUNCTION check_no_cycles()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.parent_id IS NOT NULL THEN
    WITH RECURSIVE ancestors AS (
      SELECT id, parent_id FROM items WHERE id = NEW.parent_id
      UNION ALL
      SELECT i.id, i.parent_id FROM items i 
      JOIN ancestors a ON i.id = a.parent_id
    )
    SELECT 1 FROM ancestors WHERE id = NEW.id LIMIT 1;
    
    IF FOUND THEN 
      RAISE EXCEPTION 'Circular reference detected: Cannot move item into its own subtree';
    END IF;
  END IF;
  RETURN NEW;
END; 
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_prevent_cycles
  BEFORE UPDATE OF parent_id ON items
  FOR EACH ROW 
  EXECUTE FUNCTION check_no_cycles();

-- Folder size/depth limits (GUC-driven warnings)
CREATE OR REPLACE FUNCTION check_folder_limits()
RETURNS TRIGGER AS $$
DECLARE 
  v_depth INT; 
  v_count INT; 
  v_depth_limit INT; 
  v_items_limit INT; 
BEGIN
  -- Get configurable limits with fallbacks
  BEGIN 
    v_depth_limit := current_setting('app.max_folder_depth')::INT; 
  EXCEPTION WHEN others THEN 
    v_depth_limit := 10; 
  END;
  
  BEGIN 
    v_items_limit := current_setting('app.max_folder_items')::INT; 
  EXCEPTION WHEN others THEN 
    v_items_limit := 1000; 
  END;
  
  -- Check depth
  v_depth := char_length(NEW.path) - char_length(replace(NEW.path, '/', ''));
  IF v_depth > v_depth_limit THEN 
    RAISE WARNING 'Folder depth % exceeds limit % for item %', v_depth, v_depth_limit, NEW.id; 
  END IF;
  
  -- Check folder size
  IF NEW.parent_id IS NOT NULL THEN
    SELECT COUNT(*) INTO v_count 
    FROM items 
    WHERE parent_id = NEW.parent_id AND deleted_at IS NULL;
    
    IF v_count > v_items_limit THEN 
      RAISE WARNING 'Folder contains % items (limit %), parent %', v_count, v_items_limit, NEW.parent_id; 
    END IF;
  END IF;
  
  RETURN NEW; 
END; 
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_check_folder_limits
  BEFORE INSERT OR UPDATE OF parent_id, path ON items
  FOR EACH ROW 
  EXECUTE FUNCTION check_folder_limits();

-- Move operation (single transaction with normalized paths)
CREATE OR REPLACE FUNCTION move_item(
  p_item_id UUID, 
  p_new_parent_id UUID, 
  p_position INTEGER DEFAULT 0
)
RETURNS VOID AS $$
DECLARE 
  v_old_path TEXT; 
  v_new_parent_path TEXT; 
  v_new_path TEXT; 
  v_item_name TEXT; 
BEGIN
  -- Get current item info
  SELECT path, name INTO v_old_path, v_item_name 
  FROM items WHERE id = p_item_id; 
  
  IF NOT FOUND THEN 
    RAISE EXCEPTION 'Item not found: %', p_item_id; 
  END IF;
  
  -- Get new parent path
  IF p_new_parent_id IS NOT NULL THEN
    SELECT path INTO v_new_parent_path 
    FROM items WHERE id = p_new_parent_id; 
    
    IF NOT FOUND THEN 
      RAISE EXCEPTION 'Parent not found: %', p_new_parent_id; 
    END IF;
    
    v_new_path := normalize_path(v_new_parent_path || '/' || v_item_name);
  ELSE
    -- Moving to root
    v_new_path := normalize_path('/' || v_item_name);
  END IF;
  
  -- Update item
  UPDATE items 
  SET parent_id = p_new_parent_id, 
      path = v_new_path, 
      position = COALESCE(p_position, 0), 
      updated_at = NOW() 
  WHERE id = p_item_id;
  
  -- Update all descendants efficiently
  WITH RECURSIVE descendants AS (
    SELECT id, path FROM items WHERE parent_id = p_item_id
    UNION ALL
    SELECT i.id, i.path FROM items i 
    JOIN descendants d ON i.parent_id = d.id
  )
  UPDATE items i
  SET path = normalize_path(v_new_path || substring(i.path FROM length(v_old_path) + 1)), 
      updated_at = NOW()
  FROM descendants d 
  WHERE i.id = d.id;
END; 
$$ LANGUAGE plpgsql;

-- Initial seed data (root folders)
INSERT INTO items (id, type, path, name, position) 
VALUES
  (gen_random_uuid(), 'folder', '/knowledge-base', 'Knowledge Base', 0),
  (gen_random_uuid(), 'folder', '/recent', 'Recent', -1000)  -- Special folder for recent items
ON CONFLICT (path) WHERE deleted_at IS NULL DO NOTHING;

-- Create uncategorized folder under knowledge-base
INSERT INTO items (type, parent_id, path, name, position)
SELECT 
  'folder',
  id,
  '/knowledge-base/uncategorized',
  'Uncategorized',
  999
FROM items 
WHERE path = '/knowledge-base'
ON CONFLICT (path) WHERE deleted_at IS NULL DO NOTHING;

-- Dual-write columns for gradual migration
ALTER TABLE branches ADD COLUMN IF NOT EXISTS item_id UUID REFERENCES items(id);
ALTER TABLE panels ADD COLUMN IF NOT EXISTS item_id UUID REFERENCES items(id);

-- Create compatibility view for gradual migration
CREATE OR REPLACE VIEW notes_compat AS
  SELECT 
    id, 
    name AS title, 
    metadata, 
    created_at, 
    updated_at
  FROM items 
  WHERE type = 'note' AND deleted_at IS NULL;

-- Migration verifier function
CREATE OR REPLACE FUNCTION verify_migration()
RETURNS TABLE(
  check_name TEXT, 
  expected BIGINT, 
  actual BIGINT, 
  passed BOOLEAN
) AS $$
BEGIN
  -- Check notes count
  RETURN QUERY 
  SELECT 
    'notes_count'::TEXT, 
    (SELECT COUNT(*) FROM notes)::BIGINT, 
    (SELECT COUNT(*) FROM items WHERE type = 'note')::BIGINT,
    (SELECT COUNT(*) FROM notes) = (SELECT COUNT(*) FROM items WHERE type = 'note');
  
  -- Check branches item_ids match
  RETURN QUERY 
  SELECT 
    'branches_item_ids_match'::TEXT, 
    (SELECT COUNT(*) FROM branches WHERE note_id IS NOT NULL)::BIGINT,
    (SELECT COUNT(*) FROM branches WHERE item_id IS NOT NULL)::BIGINT,
    (SELECT COUNT(*) FROM branches WHERE note_id IS NOT NULL) = 
    (SELECT COUNT(*) FROM branches WHERE item_id IS NOT NULL);
  
  -- Check panels item_ids match
  RETURN QUERY 
  SELECT 
    'panels_item_ids_match'::TEXT, 
    (SELECT COUNT(*) FROM panels WHERE note_id IS NOT NULL)::BIGINT,
    (SELECT COUNT(*) FROM panels WHERE item_id IS NOT NULL)::BIGINT,
    (SELECT COUNT(*) FROM panels WHERE note_id IS NOT NULL) = 
    (SELECT COUNT(*) FROM panels WHERE item_id IS NOT NULL);
    
  -- Check path normalization
  RETURN QUERY
  SELECT
    'paths_normalized'::TEXT,
    (SELECT COUNT(*) FROM items)::BIGINT,
    (SELECT COUNT(*) FROM items WHERE path = normalize_path(path))::BIGINT,
    (SELECT COUNT(*) FROM items) = 
    (SELECT COUNT(*) FROM items WHERE path = normalize_path(path));
END; 
$$ LANGUAGE plpgsql;

-- Migrate existing notes to items table (idempotent)
-- Handle duplicate titles by appending row number
WITH kb AS (
  SELECT id FROM items WHERE path = '/knowledge-base/uncategorized'
),
numbered_notes AS (
  SELECT 
    n.*,
    ROW_NUMBER() OVER (PARTITION BY n.title ORDER BY n.created_at) as rn
  FROM notes n
)
INSERT INTO items (id, type, parent_id, path, name, metadata, created_at, updated_at)
SELECT 
  nn.id,
  'note',
  kb.id,
  '/knowledge-base/uncategorized/' || 
    CASE 
      WHEN nn.rn = 1 THEN COALESCE(nn.title, 'Untitled-' || substring(nn.id::text, 1, 8))
      ELSE COALESCE(nn.title, 'Untitled') || '-' || nn.rn
    END,
  CASE 
    WHEN nn.rn = 1 THEN COALESCE(nn.title, 'Untitled')
    ELSE COALESCE(nn.title, 'Untitled') || ' (' || nn.rn || ')'
  END,
  nn.metadata,
  nn.created_at,
  nn.updated_at
FROM numbered_notes nn, kb
WHERE NOT EXISTS (
  SELECT 1 FROM items WHERE id = nn.id
);

-- Update dual-write columns
UPDATE branches b 
SET item_id = note_id 
WHERE item_id IS NULL AND note_id IS NOT NULL;

UPDATE panels p 
SET item_id = note_id 
WHERE item_id IS NULL AND note_id IS NOT NULL;