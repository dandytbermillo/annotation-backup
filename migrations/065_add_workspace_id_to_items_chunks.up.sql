-- Migration: Add workspace_id to items_knowledge_chunks for workspace-scoped retrieval
-- Part of: unified-retrieval-prereq-plan.md (Prerequisite 2: Permissions + Visibility)

-- Add workspace_id column (nullable initially for backfill)
ALTER TABLE items_knowledge_chunks
  ADD COLUMN IF NOT EXISTS workspace_id UUID;

-- Index for workspace-scoped queries
CREATE INDEX IF NOT EXISTS idx_items_knowledge_chunks_workspace
  ON items_knowledge_chunks(workspace_id);

-- Composite index for efficient workspace + user scoped queries
CREATE INDEX IF NOT EXISTS idx_items_knowledge_chunks_workspace_user
  ON items_knowledge_chunks(workspace_id, user_id);

-- Backfill workspace_id from items table
UPDATE items_knowledge_chunks ikc
SET workspace_id = i.workspace_id
FROM items i
WHERE ikc.item_id = i.id
  AND ikc.workspace_id IS NULL;

-- Comment
COMMENT ON COLUMN items_knowledge_chunks.workspace_id IS 'Workspace ID for scoped retrieval - denormalized from items table';
