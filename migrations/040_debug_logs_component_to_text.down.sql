-- Revert debug_logs component/action columns back to VARCHAR(255)
ALTER TABLE debug_logs
  ALTER COLUMN component TYPE VARCHAR(255) USING LEFT(component, 255),
  ALTER COLUMN action TYPE VARCHAR(255) USING LEFT(action, 255);
