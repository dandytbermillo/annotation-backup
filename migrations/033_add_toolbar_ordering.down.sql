-- Migration Rollback: Remove Toolbar Ordering Metadata
-- Reverts changes from 033_add_toolbar_ordering.up.sql
--
-- @see docs/proposal/canvas_state_persistence/design/2025-10-19-toolbar-ordering-and-visibility-tdd.md lines 81-93

-- Remove indexes
DROP INDEX IF EXISTS idx_toolbar_sequence_unique;
DROP INDEX IF EXISTS idx_canvas_workspace_notes_focused;

-- Remove constraint
ALTER TABLE canvas_workspace_notes
DROP CONSTRAINT IF EXISTS check_open_notes_have_sequence;

-- Remove columns
ALTER TABLE canvas_workspace_notes
DROP COLUMN IF EXISTS toolbar_sequence,
DROP COLUMN IF EXISTS is_focused,
DROP COLUMN IF EXISTS opened_at;
