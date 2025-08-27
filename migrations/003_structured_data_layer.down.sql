-- Rollback Migration for Structured Data Layer - Phase 2B
-- Migration: 003_structured_data_layer.down.sql
-- Purpose: Remove structured data extraction columns and related objects

BEGIN;

-- Drop views
DROP VIEW IF EXISTS note_analytics;

-- Drop triggers
DROP TRIGGER IF EXISTS update_notes_search ON notes;
DROP TRIGGER IF EXISTS update_panels_search ON panels;
DROP TRIGGER IF EXISTS update_sync_status_updated ON sync_status;

-- Drop functions
DROP FUNCTION IF EXISTS update_search_vector();

-- Drop indexes
DROP INDEX IF EXISTS idx_notes_search;
DROP INDEX IF EXISTS idx_panels_search;
DROP INDEX IF EXISTS idx_sync_status_doc_name;
DROP INDEX IF EXISTS idx_search_history_created;
DROP INDEX IF EXISTS idx_branches_extracted_text;

-- Drop tables
DROP TABLE IF EXISTS search_history;
DROP TABLE IF EXISTS sync_status;

-- Remove columns from branches table
ALTER TABLE branches
  DROP COLUMN IF EXISTS extracted_text,
  DROP COLUMN IF EXISTS position_start,
  DROP COLUMN IF EXISTS position_end;

-- Remove columns from panels table
ALTER TABLE panels
  DROP COLUMN IF EXISTS content_html,
  DROP COLUMN IF EXISTS content_text,
  DROP COLUMN IF EXISTS search_vector;

-- Remove columns from notes table
ALTER TABLE notes
  DROP COLUMN IF EXISTS content_text,
  DROP COLUMN IF EXISTS search_vector,
  DROP COLUMN IF EXISTS word_count,
  DROP COLUMN IF EXISTS last_sync_at;

COMMIT;