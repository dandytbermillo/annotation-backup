-- Rollback: Remove workspace_id from items_knowledge_chunks

DROP INDEX IF EXISTS idx_items_knowledge_chunks_workspace_user;
DROP INDEX IF EXISTS idx_items_knowledge_chunks_workspace;
ALTER TABLE items_knowledge_chunks DROP COLUMN IF EXISTS workspace_id;
