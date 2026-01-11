-- Migration: Create docs_knowledge_chunks table for Phase 2 chunk-level retrieval
-- Part of: cursor-style-doc-retrieval-plan.md (Phase 2)

CREATE TABLE IF NOT EXISTS docs_knowledge_chunks (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  doc_slug TEXT NOT NULL,
  category TEXT NOT NULL,
  title TEXT NOT NULL,
  header_path TEXT NOT NULL,
  chunk_index INT NOT NULL,
  content TEXT NOT NULL,
  keywords TEXT[] DEFAULT '{}',
  chunk_hash TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  -- Foreign key to parent doc (CASCADE delete removes chunks when doc is deleted)
  CONSTRAINT fk_docs_knowledge_chunks_doc
    FOREIGN KEY (doc_slug) REFERENCES docs_knowledge(slug) ON DELETE CASCADE
);

-- Unique constraint for idempotent upserts by (doc_slug, chunk_index)
CREATE UNIQUE INDEX IF NOT EXISTS ux_docs_knowledge_chunks_doc_index
  ON docs_knowledge_chunks(doc_slug, chunk_index);

-- Index for category-based filtering
CREATE INDEX IF NOT EXISTS idx_docs_knowledge_chunks_category
  ON docs_knowledge_chunks(category);

-- Index for doc_slug lookups (cleanup queries)
CREATE INDEX IF NOT EXISTS idx_docs_knowledge_chunks_doc_slug
  ON docs_knowledge_chunks(doc_slug);

-- GIN index for keyword search
CREATE INDEX IF NOT EXISTS idx_docs_knowledge_chunks_keywords
  ON docs_knowledge_chunks USING GIN(keywords);

-- Full-text search index on content
CREATE INDEX IF NOT EXISTS idx_docs_knowledge_chunks_fts
  ON docs_knowledge_chunks USING GIN(to_tsvector('english', content));

-- Trigger to auto-update updated_at
CREATE OR REPLACE FUNCTION update_docs_knowledge_chunks_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_docs_knowledge_chunks_updated_at ON docs_knowledge_chunks;
CREATE TRIGGER trg_docs_knowledge_chunks_updated_at
  BEFORE UPDATE ON docs_knowledge_chunks
  FOR EACH ROW
  EXECUTE FUNCTION update_docs_knowledge_chunks_updated_at();

-- Comment
COMMENT ON TABLE docs_knowledge_chunks IS 'Chunked documentation for Phase 2 retrieval with header_path context';
