-- Migration: Extend Panel Type Enum
-- Adds 'widget' type to panels.type CHECK constraint to support non-note components
--
-- @see docs/proposal/canvas_state_persistence/design/2025-10-19-toolbar-ordering-and-visibility-tdd.md lines 95-119

ALTER TABLE panels
DROP CONSTRAINT IF EXISTS check_panel_type;

ALTER TABLE panels
ADD CONSTRAINT check_panel_type
CHECK (
  type = ANY (
    ARRAY[
      'main',
      'branch',
      'editor',
      'context',
      'toolbar',
      'annotation',
      'widget'
    ]
  )
);

COMMENT ON COLUMN panels.metadata IS
  'JSONB metadata; for type ''widget'' include {"widget_type": "..."} for concrete widget identification';
