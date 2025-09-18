-- Revert workspace_id addition to document_saves

-- Drop indexes first
DROP INDEX IF EXISTS idx_document_saves_ws_note_panel;
DROP INDEX IF EXISTS idx_document_saves_workspace;

-- Remove the workspace_id column
ALTER TABLE document_saves 
  DROP COLUMN IF EXISTS workspace_id;