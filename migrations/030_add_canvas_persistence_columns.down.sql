-- Rollback: Remove Canvas Persistence Columns
-- Reverts changes from 030_add_canvas_persistence_columns.up.sql

-- Drop indexes
DROP INDEX IF EXISTS idx_panels_revision;
DROP INDEX IF EXISTS idx_panels_updated_at;
DROP INDEX IF EXISTS idx_panels_note_position;

-- Drop constraint
ALTER TABLE panels
DROP CONSTRAINT IF EXISTS check_panel_type;

-- Drop persistence metadata columns
ALTER TABLE panels
DROP COLUMN IF EXISTS schema_version,
DROP COLUMN IF EXISTS revision_token,
DROP COLUMN IF EXISTS updated_by;

-- Drop z-index
ALTER TABLE panels
DROP COLUMN IF EXISTS z_index;

-- Drop world-space dimension columns
ALTER TABLE panels
DROP COLUMN IF EXISTS height_world,
DROP COLUMN IF EXISTS width_world;

-- Drop world-space position columns
ALTER TABLE panels
DROP COLUMN IF EXISTS position_y_world,
DROP COLUMN IF EXISTS position_x_world;
