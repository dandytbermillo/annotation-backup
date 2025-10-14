-- Rollback: Remove Canvas Camera State Table
-- Reverts changes from 031_add_canvas_camera_state.up.sql

-- Drop trigger
DROP TRIGGER IF EXISTS trigger_update_canvas_camera_updated_at ON canvas_camera_state;

-- Drop function
DROP FUNCTION IF EXISTS update_canvas_camera_updated_at();

-- Drop indexes
DROP INDEX IF EXISTS idx_camera_state_updated;
DROP INDEX IF EXISTS idx_camera_state_user;
DROP INDEX IF EXISTS idx_camera_state_note;

-- Drop table
DROP TABLE IF EXISTS canvas_camera_state;
