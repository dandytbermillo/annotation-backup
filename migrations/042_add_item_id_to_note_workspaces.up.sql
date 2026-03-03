-- Migration 042: Add item_id column to note_workspaces table
-- Part of Dashboard Implementation Plan - Phase 1.2
-- Purpose: Associate workspaces with entries (items) for the Entry -> Workspace hierarchy
-- Note: Column starts nullable, will be made NOT NULL after backfill in migration 046

BEGIN;

-- Ensure note_workspaces table exists (normally created by app runtime ensureSchemaReady,
-- but migrations should be self-contained)
CREATE TABLE IF NOT EXISTS note_workspaces (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL,
  name TEXT NOT NULL DEFAULT 'Workspace',
  payload JSONB NOT NULL DEFAULT '{"schemaVersion":"1.0.0","openNotes":[],"activeNoteId":null,"camera":{"x":0,"y":0,"scale":1}}'::jsonb,
  revision UUID NOT NULL DEFAULT gen_random_uuid(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  is_default BOOLEAN NOT NULL DEFAULT FALSE
);

-- Add item_id column (nullable initially for safe migration)
ALTER TABLE note_workspaces ADD COLUMN IF NOT EXISTS item_id UUID;

-- Add foreign key constraint with CASCADE delete
-- When an entry (item) is deleted, all its workspaces are deleted
ALTER TABLE note_workspaces
  DROP CONSTRAINT IF EXISTS fk_note_workspaces_item_id;

ALTER TABLE note_workspaces
  ADD CONSTRAINT fk_note_workspaces_item_id
  FOREIGN KEY (item_id)
  REFERENCES items(id)
  ON DELETE CASCADE;

-- Create index for efficient lookup of workspaces by item
CREATE INDEX IF NOT EXISTS idx_note_workspaces_item_id ON note_workspaces(item_id);

-- Add comment for documentation
COMMENT ON COLUMN note_workspaces.item_id IS 'Reference to the entry (item) that owns this workspace. Part of Entry->Workspace hierarchy.';

COMMIT;
