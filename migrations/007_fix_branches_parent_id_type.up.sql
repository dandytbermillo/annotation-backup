-- Migration: 007 - Fix branches parent_id type
-- Changes parent_id from UUID to TEXT to support non-UUID identifiers like "main" and "branch-xxx"

BEGIN;

-- Drop the foreign key constraint first
ALTER TABLE branches 
  DROP CONSTRAINT IF EXISTS branches_parent_id_fkey;

-- Drop the index
DROP INDEX IF EXISTS idx_branches_parent_id;

-- Change the column type to TEXT
ALTER TABLE branches 
  ALTER COLUMN parent_id TYPE TEXT USING parent_id::TEXT;

-- Re-create index for performance
CREATE INDEX idx_branches_parent_id ON branches(parent_id);

-- Update comment
COMMENT ON COLUMN branches.parent_id IS 'Parent branch/panel ID (supports "main", "branch-xxx", or UUID formats)';

COMMIT;