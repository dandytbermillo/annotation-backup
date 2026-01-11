-- Migration: Create docs_knowledge table for chat documentation retrieval
-- Part of: cursor-style-doc-retrieval-plan.md (Phase 0)

CREATE TABLE IF NOT EXISTS docs_knowledge (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  slug TEXT NOT NULL UNIQUE,
  category TEXT NOT NULL,
  title TEXT NOT NULL,
  content TEXT NOT NULL,
  keywords TEXT[] DEFAULT '{}',
  content_hash TEXT NOT NULL,
  version TEXT DEFAULT '1.0.0',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Index for category-based filtering
CREATE INDEX IF NOT EXISTS idx_docs_knowledge_category ON docs_knowledge(category);

-- Index for keyword search (GIN for array containment)
CREATE INDEX IF NOT EXISTS idx_docs_knowledge_keywords ON docs_knowledge USING GIN(keywords);

-- Full-text search index on title and content
CREATE INDEX IF NOT EXISTS idx_docs_knowledge_fts ON docs_knowledge
  USING GIN(to_tsvector('english', title || ' ' || content));

-- Trigger to auto-update updated_at
CREATE OR REPLACE FUNCTION update_docs_knowledge_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trigger_docs_knowledge_updated_at ON docs_knowledge;
CREATE TRIGGER trigger_docs_knowledge_updated_at
  BEFORE UPDATE ON docs_knowledge
  FOR EACH ROW
  EXECUTE FUNCTION update_docs_knowledge_updated_at();

COMMENT ON TABLE docs_knowledge IS 'Stores app documentation for chat retrieval (meta-explain, keyword search)';
COMMENT ON COLUMN docs_knowledge.slug IS 'Unique identifier derived from filename';
COMMENT ON COLUMN docs_knowledge.category IS 'Category: concepts, widgets, actions, panels';
COMMENT ON COLUMN docs_knowledge.keywords IS 'Array of keywords for retrieval scoring';
COMMENT ON COLUMN docs_knowledge.content_hash IS 'MD5 hash of content for change detection';
