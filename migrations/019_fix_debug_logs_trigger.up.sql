-- Fix debug_logs trigger to properly handle NULL note_id cases
-- This allows debug logs that aren't associated with a specific note

-- First, drop the existing problematic trigger if it exists
DROP TRIGGER IF EXISTS debug_logs_ws_guard ON debug_logs;

-- Drop the old enforce_child_ws function if it's being used for debug_logs
-- (We'll create a specific one for debug_logs)

-- Create a new trigger function that handles NULL note_id for debug_logs
CREATE OR REPLACE FUNCTION enforce_debug_log_ws() RETURNS trigger AS $$
DECLARE
  parent_ws uuid;
  default_ws uuid;
BEGIN
  -- If note_id is NULL, we don't need to check workspace consistency
  -- Just ensure workspace_id is set (it's NOT NULL in the table)
  IF NEW.note_id IS NULL THEN
    -- If workspace_id is not provided, try to set it to the default workspace
    IF NEW.workspace_id IS NULL THEN
      SELECT id INTO default_ws FROM workspaces WHERE is_default = true LIMIT 1;
      IF default_ws IS NULL THEN
        RAISE EXCEPTION 'No default workspace found and workspace_id is required';
      END IF;
      NEW.workspace_id := default_ws;
    END IF;
    RETURN NEW;
  END IF;
  
  -- If note_id is provided, check workspace consistency
  SELECT workspace_id INTO parent_ws FROM notes WHERE id = NEW.note_id;
  IF parent_ws IS NULL THEN
    RAISE EXCEPTION 'Note % does not exist', NEW.note_id;
  END IF;
  
  -- Ensure workspace_id matches the parent note's workspace
  -- Auto-fix the workspace_id if it doesn't match
  IF NEW.workspace_id IS NULL OR NEW.workspace_id IS DISTINCT FROM parent_ws THEN
    NEW.workspace_id := parent_ws;
  END IF;
  
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Create the new trigger for debug_logs
CREATE TRIGGER debug_logs_ws_guard 
  BEFORE INSERT OR UPDATE ON debug_logs
  FOR EACH ROW 
  EXECUTE FUNCTION enforce_debug_log_ws();

-- Add comment explaining the trigger behavior
COMMENT ON FUNCTION enforce_debug_log_ws() IS 
'Handles workspace_id for debug_logs entries. When note_id is NULL, uses default workspace. When note_id is provided, ensures workspace consistency with the parent note.';