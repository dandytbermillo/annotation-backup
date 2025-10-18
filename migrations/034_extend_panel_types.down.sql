-- Migration Rollback: Revert Panel Type Enum Extension
-- Removes 'widget' type from panels.type CHECK constraint
--
-- @see docs/proposal/canvas_state_persistence/design/2025-10-19-toolbar-ordering-and-visibility-tdd.md lines 121-134

ALTER TABLE panels
DROP CONSTRAINT IF EXISTS check_panel_type;

ALTER TABLE panels
ADD CONSTRAINT check_panel_type
CHECK (
  type = ANY (
    ARRAY['main', 'editor', 'branch', 'context', 'toolbar', 'annotation']
  )
);
