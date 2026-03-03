-- Enable required extensions (safe if already enabled)
CREATE EXTENSION IF NOT EXISTS unaccent;
CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- Flatten ProseMirror JSON into searchable text (IMMUTABLE for generated columns)
CREATE OR REPLACE FUNCTION pm_extract_text(doc JSONB)
RETURNS TEXT
LANGUAGE plpgsql
IMMUTABLE
AS $$
DECLARE
  acc TEXT := '';
  node JSONB;
  child JSONB;
  t TEXT;
BEGIN
  IF doc IS NULL THEN
    RETURN '';
  END IF;
  -- Concatenate all "text" fields encountered in the tree
  FOR node IN SELECT * FROM jsonb_path_query(doc, '$.** ? (@.text != null)') LOOP
    t := (node->>'text');
    IF t IS NOT NULL AND length(t) > 0 THEN
      acc := acc || ' ' || t;
    END IF;
  END LOOP;
  RETURN trim(both from acc);
END
$$;

-- Add derived text column (immutable function is safe for generated column)
ALTER TABLE document_saves
  ADD COLUMN IF NOT EXISTS document_text TEXT
    GENERATED ALWAYS AS (pm_extract_text(content)) STORED;

-- search_vector uses to_tsvector+unaccent which are not immutable,
-- so we use a trigger instead of a generated column.
ALTER TABLE document_saves
  ADD COLUMN IF NOT EXISTS search_vector TSVECTOR;

CREATE OR REPLACE FUNCTION document_saves_search_trigger()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.search_vector := to_tsvector('english', unaccent(coalesce(pm_extract_text(NEW.content), '')));
  RETURN NEW;
END
$$;

DROP TRIGGER IF EXISTS trg_document_saves_search ON document_saves;
CREATE TRIGGER trg_document_saves_search
  BEFORE INSERT OR UPDATE OF content ON document_saves
  FOR EACH ROW
  EXECUTE FUNCTION document_saves_search_trigger();

-- GIN index for FTS
CREATE INDEX IF NOT EXISTS idx_document_saves_search
  ON document_saves
  USING GIN (search_vector);

-- Trigram index for fuzzy matching
CREATE INDEX IF NOT EXISTS idx_document_saves_trgm
  ON document_saves
  USING GIN (document_text gin_trgm_ops);

COMMENT ON FUNCTION pm_extract_text(jsonb)
  IS 'Extracts concatenated text from ProseMirror JSON for FTS';
COMMENT ON COLUMN document_saves.document_text
  IS 'Flattened text extracted from ProseMirror JSON for search';
COMMENT ON COLUMN document_saves.search_vector
  IS 'tsvector built from unaccented extracted text for FTS';