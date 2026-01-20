-- Migration: Create items_knowledge_chunks table for unified retrieval
-- Part of: unified-retrieval-prereq-plan.md (Prerequisite 1: Indexing Strategy)

CREATE TABLE IF NOT EXISTS items_knowledge_chunks (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  item_id UUID NOT NULL,
  user_id UUID,                          -- For access control scoping (nullable for public/shared items)
  item_name TEXT NOT NULL,               -- Denormalized for search display
  item_path TEXT NOT NULL,               -- Denormalized for search display
  header_path TEXT DEFAULT '',           -- Header context if available (e.g., "## Section > ### Subsection")
  chunk_index INT NOT NULL,
  content TEXT NOT NULL,
  keywords TEXT[] DEFAULT '{}',
  chunk_hash TEXT NOT NULL,              -- For deduplication/change detection
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  -- Foreign key to parent item (CASCADE delete removes chunks when item is deleted)
  CONSTRAINT fk_items_knowledge_chunks_item
    FOREIGN KEY (item_id) REFERENCES items(id) ON DELETE CASCADE
);

-- Unique constraint for idempotent upserts by (item_id, chunk_index)
CREATE UNIQUE INDEX IF NOT EXISTS ux_items_knowledge_chunks_item_index
  ON items_knowledge_chunks(item_id, chunk_index);

-- Index for user_id filtering (critical for permissions)
CREATE INDEX IF NOT EXISTS idx_items_knowledge_chunks_user
  ON items_knowledge_chunks(user_id);

-- Index for item_id lookups (cleanup queries)
CREATE INDEX IF NOT EXISTS idx_items_knowledge_chunks_item
  ON items_knowledge_chunks(item_id);

-- GIN index for keyword search
CREATE INDEX IF NOT EXISTS idx_items_knowledge_chunks_keywords
  ON items_knowledge_chunks USING GIN(keywords);

-- Full-text search index on content
CREATE INDEX IF NOT EXISTS idx_items_knowledge_chunks_fts
  ON items_knowledge_chunks USING GIN(to_tsvector('english', content));

-- Full-text search index on item_name for title matching
CREATE INDEX IF NOT EXISTS idx_items_knowledge_chunks_name_fts
  ON items_knowledge_chunks USING GIN(to_tsvector('english', item_name));

-- Composite index for efficient user-scoped queries
CREATE INDEX IF NOT EXISTS idx_items_knowledge_chunks_user_item
  ON items_knowledge_chunks(user_id, item_id);

-- Trigger to auto-update updated_at
CREATE OR REPLACE FUNCTION update_items_knowledge_chunks_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_items_knowledge_chunks_updated_at ON items_knowledge_chunks;
CREATE TRIGGER trg_items_knowledge_chunks_updated_at
  BEFORE UPDATE ON items_knowledge_chunks
  FOR EACH ROW
  EXECUTE FUNCTION update_items_knowledge_chunks_updated_at();

-- Comment
COMMENT ON TABLE items_knowledge_chunks IS 'Chunked notes/files content for unified retrieval with user-scoped access control';
COMMENT ON COLUMN items_knowledge_chunks.user_id IS 'Owner user ID for access control - queries must filter by user_id';
COMMENT ON COLUMN items_knowledge_chunks.item_name IS 'Denormalized note/file name for search result display';
COMMENT ON COLUMN items_knowledge_chunks.item_path IS 'Denormalized path for search result display and disambiguation';
