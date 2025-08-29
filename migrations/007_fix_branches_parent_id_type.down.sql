-- Rollback: 007 - Revert branches parent_id to UUID type

BEGIN;

-- Drop the text index
DROP INDEX IF EXISTS idx_branches_parent_id;

-- Convert back to UUID (this will fail if non-UUID values exist)
-- First set non-UUID values to NULL
UPDATE branches 
SET parent_id = NULL 
WHERE parent_id IS NOT NULL 
  AND parent_id !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$';

-- Change column type back to UUID
ALTER TABLE branches 
  ALTER COLUMN parent_id TYPE UUID USING parent_id::UUID;

-- Re-add foreign key constraint
ALTER TABLE branches
  ADD CONSTRAINT branches_parent_id_fkey 
  FOREIGN KEY (parent_id) REFERENCES branches(id) ON DELETE SET NULL;

-- Re-create UUID index
CREATE INDEX idx_branches_parent_id ON branches(parent_id);

COMMIT;