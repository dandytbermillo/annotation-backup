-- Migration 041: Add is_system column to items table
-- Part of Dashboard Implementation Plan - Phase 1.1
-- Purpose: Allow marking system entries (like Home) that cannot be deleted by users

BEGIN;

-- Add is_system column with default false
ALTER TABLE items ADD COLUMN IF NOT EXISTS is_system BOOLEAN NOT NULL DEFAULT FALSE;

-- Create index for quick lookup of system items
CREATE INDEX IF NOT EXISTS idx_items_is_system ON items(is_system) WHERE is_system = TRUE;

-- Add comment for documentation
COMMENT ON COLUMN items.is_system IS 'System entries (e.g., Home) that are auto-created and cannot be deleted by users';

COMMIT;
