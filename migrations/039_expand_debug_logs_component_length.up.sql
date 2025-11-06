-- Expand debug_logs component/action fields to accommodate longer identifiers
ALTER TABLE debug_logs
  ALTER COLUMN component TYPE VARCHAR(255),
  ALTER COLUMN action TYPE VARCHAR(255);
