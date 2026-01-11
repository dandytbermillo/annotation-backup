-- Rollback: Drop docs_knowledge table
-- Part of: cursor-style-doc-retrieval-plan.md (Phase 0)

DROP TRIGGER IF EXISTS trigger_docs_knowledge_updated_at ON docs_knowledge;
DROP FUNCTION IF EXISTS update_docs_knowledge_updated_at();
DROP INDEX IF EXISTS idx_docs_knowledge_fts;
DROP INDEX IF EXISTS idx_docs_knowledge_keywords;
DROP INDEX IF EXISTS idx_docs_knowledge_category;
DROP TABLE IF EXISTS docs_knowledge;
