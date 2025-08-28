-- Drop document_saves table and related objects

-- Drop indexes first
DROP INDEX IF EXISTS idx_document_saves_created;
DROP INDEX IF EXISTS idx_document_saves_note_panel;

-- Drop the table
DROP TABLE IF EXISTS document_saves;