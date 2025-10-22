-- Rollback: Remove workspace version tracking

DROP TRIGGER IF EXISTS trg_canvas_workspace_version_monotonicity ON canvas_workspace_notes;
DROP FUNCTION IF EXISTS enforce_canvas_workspace_version_monotonicity();

ALTER TABLE canvas_workspace_notes
  DROP COLUMN IF EXISTS version;
