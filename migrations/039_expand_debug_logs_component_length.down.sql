-- Revert debug_logs component/action fields back to 100 characters
ALTER TABLE debug_logs
  ALTER COLUMN component TYPE VARCHAR(100) USING LEFT(component, 100),
  ALTER COLUMN action TYPE VARCHAR(100) USING LEFT(action, 100);
