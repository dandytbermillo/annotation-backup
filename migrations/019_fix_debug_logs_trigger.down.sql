-- Revert the debug_logs trigger fix
-- This will restore the original trigger behavior (if needed)

-- Drop the custom debug_logs trigger function
DROP TRIGGER IF EXISTS debug_logs_ws_guard ON debug_logs;
DROP FUNCTION IF EXISTS enforce_debug_log_ws();

-- Restore the original trigger if it was using enforce_child_ws
-- Note: This assumes the original enforce_child_ws function still exists
-- If not, you'll need to recreate it from the workspace implementation

-- Check if enforce_child_ws exists before creating trigger
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_proc 
    WHERE proname = 'enforce_child_ws'
  ) THEN
    -- Recreate the original trigger
    CREATE TRIGGER debug_logs_ws_guard 
      BEFORE INSERT OR UPDATE ON debug_logs
      FOR EACH ROW 
      EXECUTE FUNCTION enforce_child_ws();
  END IF;
END;
$$;