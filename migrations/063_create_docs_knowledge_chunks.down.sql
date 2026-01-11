-- Rollback: Drop docs_knowledge_chunks table
-- Part of: cursor-style-doc-retrieval-plan.md (Phase 2)

DROP TRIGGER IF EXISTS trg_docs_knowledge_chunks_updated_at ON docs_knowledge_chunks;
DROP FUNCTION IF EXISTS update_docs_knowledge_chunks_updated_at();
DROP TABLE IF EXISTS docs_knowledge_chunks;
