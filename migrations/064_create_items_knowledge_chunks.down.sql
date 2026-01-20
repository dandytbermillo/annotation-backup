-- Rollback: Drop items_knowledge_chunks table
-- Part of: unified-retrieval-prereq-plan.md

DROP TRIGGER IF EXISTS trg_items_knowledge_chunks_updated_at ON items_knowledge_chunks;
DROP FUNCTION IF EXISTS update_items_knowledge_chunks_updated_at();
DROP TABLE IF EXISTS items_knowledge_chunks;
