-- Revert workspace-aware uniqueness on document_saves
BEGIN;

ALTER TABLE document_saves
  DROP CONSTRAINT IF EXISTS document_saves_note_panel_ws_version_unique;

DROP INDEX IF EXISTS idx_document_saves_workspace_note_panel_version;

ALTER TABLE document_saves
  ADD CONSTRAINT document_saves_note_id_panel_id_version_key
    UNIQUE (note_id, panel_id, version);

CREATE INDEX IF NOT EXISTS idx_document_saves_note_panel
  ON document_saves(note_id, panel_id, version DESC);

COMMIT;
