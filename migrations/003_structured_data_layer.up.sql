-- PostgreSQL Migration for Structured Data Layer - Phase 2B
-- Migration: 003_structured_data_layer.up.sql
-- Purpose: Add structured data extraction columns for SQL search/filter capabilities

BEGIN;

-- Add full-text search columns to notes
ALTER TABLE notes 
  ADD COLUMN IF NOT EXISTS content_text TEXT,
  ADD COLUMN IF NOT EXISTS search_vector tsvector,
  ADD COLUMN IF NOT EXISTS word_count INTEGER DEFAULT 0,
  ADD COLUMN IF NOT EXISTS last_sync_at TIMESTAMPTZ;

-- Create GIN index for full-text search
CREATE INDEX IF NOT EXISTS idx_notes_search ON notes USING GIN(search_vector);

-- Update panels table with extracted content
ALTER TABLE panels
  ADD COLUMN IF NOT EXISTS content_html TEXT,
  ADD COLUMN IF NOT EXISTS content_text TEXT,
  ADD COLUMN IF NOT EXISTS search_vector tsvector;

CREATE INDEX IF NOT EXISTS idx_panels_search ON panels USING GIN(search_vector);

-- Update branches table with extracted text
ALTER TABLE branches
  ADD COLUMN IF NOT EXISTS extracted_text TEXT,
  ADD COLUMN IF NOT EXISTS position_start INTEGER,
  ADD COLUMN IF NOT EXISTS position_end INTEGER;

-- Create search history table
CREATE TABLE IF NOT EXISTS search_history (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  query TEXT NOT NULL,
  results_count INTEGER DEFAULT 0,
  user_id TEXT,
  filters JSONB DEFAULT '{}',
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Create sync status table
CREATE TABLE IF NOT EXISTS sync_status (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  doc_name TEXT UNIQUE NOT NULL,
  last_update_id BIGINT,
  last_sync_at TIMESTAMPTZ,
  sync_status TEXT CHECK (sync_status IN ('pending', 'syncing', 'completed', 'failed')),
  error_message TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Add trigger to update search vectors
CREATE OR REPLACE FUNCTION update_search_vector() RETURNS trigger AS $$
BEGIN
  NEW.search_vector := 
    setweight(to_tsvector('english', COALESCE(NEW.title, '')), 'A') ||
    setweight(to_tsvector('english', COALESCE(NEW.content_text, '')), 'B');
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER update_notes_search BEFORE INSERT OR UPDATE ON notes
  FOR EACH ROW EXECUTE FUNCTION update_search_vector();

CREATE TRIGGER update_panels_search BEFORE INSERT OR UPDATE ON panels
  FOR EACH ROW EXECUTE FUNCTION update_search_vector();

-- Analytics views
CREATE OR REPLACE VIEW note_analytics AS
SELECT 
  n.id,
  n.title,
  n.word_count,
  COUNT(DISTINCT p.id) as panel_count,
  COUNT(DISTINCT b.id) as branch_count,
  n.created_at,
  n.updated_at,
  n.last_sync_at
FROM notes n
LEFT JOIN panels p ON p.note_id = n.id AND p.deleted_at IS NULL
LEFT JOIN branches b ON b.note_id = n.id AND b.deleted_at IS NULL
WHERE n.deleted_at IS NULL
GROUP BY n.id;

-- Add indexes for performance
CREATE INDEX IF NOT EXISTS idx_sync_status_doc_name ON sync_status(doc_name);
CREATE INDEX IF NOT EXISTS idx_search_history_created ON search_history(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_branches_extracted_text ON branches USING GIN(to_tsvector('english', extracted_text));

-- Add update trigger for sync_status
CREATE TRIGGER update_sync_status_updated BEFORE UPDATE ON sync_status
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- Add comments for documentation
COMMENT ON TABLE search_history IS 'Tracks search queries for analytics and optimization';
COMMENT ON TABLE sync_status IS 'Tracks synchronization status between YJS documents and structured tables';

COMMENT ON COLUMN notes.content_text IS 'Extracted plain text content for full-text search';
COMMENT ON COLUMN notes.search_vector IS 'PostgreSQL tsvector for efficient full-text search';
COMMENT ON COLUMN notes.word_count IS 'Total word count of the note content';
COMMENT ON COLUMN notes.last_sync_at IS 'Last time the note was synced from YJS to structured data';

COMMENT ON COLUMN panels.content_html IS 'Extracted HTML content from TipTap editor';
COMMENT ON COLUMN panels.content_text IS 'Plain text version of panel content for search';

COMMENT ON COLUMN branches.extracted_text IS 'Text content of the annotation for search';
COMMENT ON COLUMN branches.position_start IS 'Start position of annotation in document';
COMMENT ON COLUMN branches.position_end IS 'End position of annotation in document';

COMMIT;