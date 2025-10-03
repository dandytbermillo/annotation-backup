-- Replace generated columns with app-computed columns for document_saves
-- This follows the recommended approach: app-side extraction + materialized search vector
-- Drops old generated columns (document_text, search_vector) and replaces with app-computed ones

BEGIN;

-- Drop old generated columns
ALTER TABLE document_saves
  DROP COLUMN IF EXISTS document_text CASCADE;

ALTER TABLE document_saves
  DROP COLUMN IF EXISTS search_vector CASCADE;

-- Add new app-computed document_text column
ALTER TABLE document_saves
  ADD COLUMN document_text TEXT;

-- Ensure search_tsv exists (may already exist from previous migration)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'document_saves' AND column_name = 'search_tsv'
  ) THEN
    ALTER TABLE document_saves ADD COLUMN search_tsv tsvector;
  END IF;
END $$;

-- Create GIN index for efficient full-text search
CREATE INDEX IF NOT EXISTS idx_document_saves_search_tsv_gin
  ON document_saves USING GIN(search_tsv);

-- Add index on document_text for LIKE/ILIKE queries (fallback)
CREATE INDEX IF NOT EXISTS idx_document_saves_document_text_trgm
  ON document_saves USING GIN(document_text gin_trgm_ops);

-- Add comments for documentation
COMMENT ON COLUMN document_saves.document_text IS
  'Plain text extraction of content (app-computed, preserves newlines between paragraphs)';

COMMENT ON COLUMN document_saves.search_tsv IS
  'Full-text search vector (app-computed from document_text using to_tsvector)';

COMMIT;
