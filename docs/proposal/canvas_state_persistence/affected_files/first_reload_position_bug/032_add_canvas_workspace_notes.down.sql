-- Rollback canvas workspace notes table

DROP TRIGGER IF EXISTS trigger_update_canvas_workspace_notes_timestamp ON canvas_workspace_notes;
DROP FUNCTION IF EXISTS update_canvas_workspace_notes_updated_at();
DROP INDEX IF EXISTS idx_workspace_open;
DROP TABLE IF EXISTS canvas_workspace_notes;
