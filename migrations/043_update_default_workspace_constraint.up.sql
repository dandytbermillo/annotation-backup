-- Migration 043: Update default workspace constraint
-- Part of Dashboard Implementation Plan - Phase 1.3
-- Purpose: Change from "one default per user" to "one default per entry (item)"
-- This allows each entry to have its own default workspace

BEGIN;

-- Drop the old constraint (one default per user globally)
DROP INDEX IF EXISTS note_workspaces_unique_default_per_user;

-- Add new constraint (one default per user per entry)
-- Note: Only applies where item_id IS NOT NULL to handle migration period
-- After backfill in migration 046, all workspaces will have item_id
CREATE UNIQUE INDEX IF NOT EXISTS note_workspaces_unique_default_per_entry
  ON note_workspaces(user_id, item_id)
  WHERE is_default AND item_id IS NOT NULL;

-- Add comment for documentation
COMMENT ON INDEX note_workspaces_unique_default_per_entry IS
  'Ensures each entry (item) can have at most one default workspace per user';

COMMIT;
