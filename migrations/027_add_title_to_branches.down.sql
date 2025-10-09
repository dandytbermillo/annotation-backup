-- Migration: 027 - Rollback title column from branches table
-- WARNING: This will lose branch titles that are not in the panels table

BEGIN;

-- Remove title column from branches
ALTER TABLE branches DROP COLUMN IF EXISTS title;

COMMIT;
