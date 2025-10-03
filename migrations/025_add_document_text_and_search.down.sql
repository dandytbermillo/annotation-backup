-- Rollback: Remove document_text and search_tsv columns from document_saves

BEGIN;

-- Drop indexes
DROP INDEX IF EXISTS idx_document_saves_search_tsv_gin;
DROP INDEX IF EXISTS idx_document_saves_document_text_trgm;

-- Drop columns
ALTER TABLE document_saves
  DROP COLUMN IF EXISTS search_tsv;

ALTER TABLE document_saves
  DROP COLUMN IF EXISTS document_text;

COMMIT;
