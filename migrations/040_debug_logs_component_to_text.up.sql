-- Allow arbitrarily long component/action identifiers in debug logs
ALTER TABLE debug_logs
  ALTER COLUMN component TYPE TEXT,
  ALTER COLUMN action TYPE TEXT;
