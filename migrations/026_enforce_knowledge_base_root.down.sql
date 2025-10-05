-- Rollback: Remove Knowledge Base root enforcement
-- WARNING: This will allow root-level items again but won't move items back to root

-- Step 1: Remove the enforcement trigger
DROP TRIGGER IF EXISTS trg_enforce_knowledge_base_root ON items;

-- Step 2: Remove the enforcement function
DROP FUNCTION IF EXISTS enforce_knowledge_base_root();

-- Step 3: Remove documentation comments
COMMENT ON TABLE items IS 'Hierarchical tree structure for notes and folders.';
COMMENT ON TRIGGER trg_enforce_knowledge_base_root ON items IS NULL;

-- Note: We intentionally do NOT move items back to root level
-- Items that were moved to /knowledge-base/uncategorized will stay there
-- This ensures data consistency and prevents breaking existing paths
-- If you need to restore items to root, do so manually with specific SQL commands
