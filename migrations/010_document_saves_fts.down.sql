DROP INDEX IF EXISTS idx_document_saves_trgm;
DROP INDEX IF EXISTS idx_document_saves_search;
ALTER TABLE document_saves
  DROP COLUMN IF EXISTS search_vector,
  DROP COLUMN IF EXISTS document_text;
DROP FUNCTION IF EXISTS pm_extract_text(jsonb);