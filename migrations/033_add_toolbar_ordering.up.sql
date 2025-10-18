-- Migration: Add Toolbar Ordering Metadata
-- Extends canvas_workspace_notes with toolbar sequencing and focus tracking
-- for reliable workspace state restoration across sessions.
--
-- @see docs/proposal/canvas_state_persistence/design/2025-10-19-toolbar-ordering-and-visibility-tdd.md lines 38-79

-- Step 1: Add columns without constraint
ALTER TABLE canvas_workspace_notes
ADD COLUMN toolbar_sequence INTEGER,
ADD COLUMN is_focused BOOLEAN NOT NULL DEFAULT FALSE,
ADD COLUMN opened_at TIMESTAMPTZ NOT NULL DEFAULT NOW();

-- Step 2: Backfill toolbar_sequence for notes currently open
WITH ordered_notes AS (
  SELECT note_id,
         ROW_NUMBER() OVER (ORDER BY updated_at) - 1 AS seq
  FROM canvas_workspace_notes
  WHERE is_open = TRUE
)
UPDATE canvas_workspace_notes cwn
SET toolbar_sequence = ordered_notes.seq
FROM ordered_notes
WHERE cwn.note_id = ordered_notes.note_id;

-- Step 3: Pick the first open note as focused (legacy single-workspace assumption)
UPDATE canvas_workspace_notes
SET is_focused = TRUE
WHERE toolbar_sequence = 0
  AND is_open = TRUE;

-- Step 4: Add constraint after data is valid
ALTER TABLE canvas_workspace_notes
ADD CONSTRAINT check_open_notes_have_sequence
CHECK (
  (is_open = FALSE AND toolbar_sequence IS NULL) OR
  (is_open = TRUE AND toolbar_sequence IS NOT NULL)
);

-- Step 5: Create indexes
CREATE UNIQUE INDEX idx_canvas_workspace_notes_focused
  ON canvas_workspace_notes (is_focused)
  WHERE is_focused = TRUE;

CREATE UNIQUE INDEX idx_toolbar_sequence_unique
  ON canvas_workspace_notes (toolbar_sequence)
  WHERE is_open = TRUE AND toolbar_sequence IS NOT NULL;

COMMENT ON COLUMN canvas_workspace_notes.toolbar_sequence IS 'Order of note in the workspace toolbar (0-indexed; NULL when closed)';
COMMENT ON COLUMN canvas_workspace_notes.is_focused IS 'Whether this note is currently highlighted/focused in the toolbar';
COMMENT ON COLUMN canvas_workspace_notes.opened_at IS 'Timestamp when the note entered the workspace';
