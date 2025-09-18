-- Ensure document_saves rows remain scoped per workspace
BEGIN;

-- Align existing rows with their parent note workspace_id
UPDATE document_saves ds
SET workspace_id = n.workspace_id
FROM notes n
WHERE ds.note_id = n.id
  AND ds.workspace_id IS DISTINCT FROM n.workspace_id;

-- Drop legacy uniqueness that ignored workspace scope
ALTER TABLE document_saves
  DROP CONSTRAINT IF EXISTS document_saves_note_id_panel_id_version_key;

DROP INDEX IF EXISTS idx_document_saves_note_panel;

-- Enforce workspace-aware uniqueness and supporting index
ALTER TABLE document_saves
  ADD CONSTRAINT document_saves_note_panel_ws_version_unique
    UNIQUE (note_id, panel_id, workspace_id, version);

CREATE INDEX IF NOT EXISTS idx_document_saves_workspace_note_panel_version
  ON document_saves(workspace_id, note_id, panel_id, version DESC);

COMMIT;
