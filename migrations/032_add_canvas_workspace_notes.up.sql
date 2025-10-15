-- Canvas Workspace Notes
-- Tracks which notes should hydrate into the global canvas at startup
-- and remembers their main panel positions for multi-note workspace persistence.

CREATE TABLE canvas_workspace_notes (
  note_id UUID PRIMARY KEY REFERENCES notes(id) ON DELETE CASCADE,
  is_open BOOLEAN NOT NULL DEFAULT FALSE,
  main_position_x NUMERIC,
  main_position_y NUMERIC,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_by UUID,
  schema_version INTEGER NOT NULL DEFAULT 1,

  -- Ensure positions are valid when note is open
  -- Positions must be: non-null, finite, and within reasonable bounds
  CHECK (
    (is_open = FALSE) OR
    (
      main_position_x IS NOT NULL AND
      main_position_y IS NOT NULL AND
      main_position_x BETWEEN -1000000 AND 1000000 AND
      main_position_y BETWEEN -1000000 AND 1000000
    )
  )
);

-- Index for fast lookup of open notes at startup
CREATE INDEX idx_workspace_open
  ON canvas_workspace_notes (is_open)
  WHERE is_open = TRUE;

-- Trigger to update updated_at timestamp
CREATE OR REPLACE FUNCTION update_canvas_workspace_notes_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trigger_update_canvas_workspace_notes_timestamp
  BEFORE UPDATE ON canvas_workspace_notes
  FOR EACH ROW
  EXECUTE FUNCTION update_canvas_workspace_notes_updated_at();

-- Comment for documentation
COMMENT ON TABLE canvas_workspace_notes IS
  'Tracks which notes are open in the canvas workspace and their main panel positions for multi-note layout persistence';
COMMENT ON COLUMN canvas_workspace_notes.is_open IS
  'Whether this note should hydrate into the canvas at startup';
COMMENT ON COLUMN canvas_workspace_notes.main_position_x IS
  'World-space X coordinate of the note''s main panel (null when never positioned)';
COMMENT ON COLUMN canvas_workspace_notes.main_position_y IS
  'World-space Y coordinate of the note''s main panel (null when never positioned)';
