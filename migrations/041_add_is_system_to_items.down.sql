-- Migration 041 Rollback: Remove is_system column from items table

BEGIN;

-- Drop the index first
DROP INDEX IF EXISTS idx_items_is_system;

-- Remove the column
ALTER TABLE items DROP COLUMN IF EXISTS is_system;

COMMIT;
