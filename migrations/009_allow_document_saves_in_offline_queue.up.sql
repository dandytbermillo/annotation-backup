-- Migration: 009 - Allow 'document_saves' in offline_queue table_name CHECK
-- Purpose: Align offline_queue with Option A document_saves offline ops
-- Date: 2025-08-29
-- Critical Fix: Resolves CHECK constraint violation when saving documents offline

BEGIN;

-- Drop the existing constraint (safe with IF EXISTS)
ALTER TABLE offline_queue DROP CONSTRAINT IF EXISTS offline_queue_table_name_check;

-- Add new constraint that includes 'document_saves'
ALTER TABLE offline_queue
  ADD CONSTRAINT offline_queue_table_name_check
  CHECK (table_name IN ('notes', 'branches', 'panels', 'document_saves'));

-- Add descriptive comment
COMMENT ON CONSTRAINT offline_queue_table_name_check ON offline_queue
  IS 'Allow offline ops for notes, branches, panels, and document_saves (Option A)';

COMMIT;