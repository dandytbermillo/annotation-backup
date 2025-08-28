-- Create document_saves table for Option A (plain mode) document storage
-- Stores editor content as ProseMirror JSON or structured HTML-as-JSON

CREATE TABLE IF NOT EXISTS document_saves (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  note_id UUID NOT NULL REFERENCES notes(id) ON DELETE CASCADE,
  panel_id UUID,
  content JSONB NOT NULL,         -- ProseMirror JSON or structured HTML-as-JSON
  version INTEGER NOT NULL DEFAULT 1,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE (note_id, panel_id, version)
);

-- Create indexes for efficient queries
CREATE INDEX idx_document_saves_note_panel ON document_saves(note_id, panel_id, version DESC);
CREATE INDEX idx_document_saves_created ON document_saves(created_at DESC);

-- Add comments for documentation
COMMENT ON TABLE document_saves IS 'Stores document content for Option A (plain mode) - non-Yjs editor content';
COMMENT ON COLUMN document_saves.note_id IS 'Reference to the note this document belongs to';
COMMENT ON COLUMN document_saves.panel_id IS 'Panel ID for multi-panel support';
COMMENT ON COLUMN document_saves.content IS 'ProseMirror JSON or HTML content stored as JSONB';
COMMENT ON COLUMN document_saves.version IS 'Version number for the document';
COMMENT ON COLUMN document_saves.created_at IS 'Timestamp when this version was created';