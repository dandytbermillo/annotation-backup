-- Drop debug logs table and related objects
DROP FUNCTION IF EXISTS cleanup_old_debug_logs();
DROP TABLE IF EXISTS debug_logs;