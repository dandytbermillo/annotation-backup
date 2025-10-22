-- Migration: Add workspace version column for conflict-free reconciliation
-- Introduces a monotonic integer version on canvas_workspace_notes so clients can
-- validate local caches and prevent ghost panel resurrection on reload.

ALTER TABLE canvas_workspace_notes
  ADD COLUMN version INTEGER NOT NULL DEFAULT 0;

-- Ensure version never regresses (monotonic counter)
CREATE OR REPLACE FUNCTION enforce_canvas_workspace_version_monotonicity()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.version < OLD.version THEN
    RAISE EXCEPTION 'canvas_workspace_notes.version cannot decrease (old %, new %)', OLD.version, NEW.version;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_canvas_workspace_version_monotonicity
  BEFORE UPDATE ON canvas_workspace_notes
  FOR EACH ROW
  EXECUTE FUNCTION enforce_canvas_workspace_version_monotonicity();

COMMENT ON COLUMN canvas_workspace_notes.version IS
  'Monotonic version incremented on every workspace persistence change';
