-- Add workspace_id to document_saves table (was missed in initial Phase 1 implementation)
-- This is required for the enforce_child_ws() trigger to work properly

-- 0. Ensure workspaces table exists (created fully in 037, but needed here for FK)
CREATE TABLE IF NOT EXISTS workspaces (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL DEFAULT 'Default Workspace',
  is_default BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  metadata JSONB NOT NULL DEFAULT '{}'::JSONB
);

-- 1. Add the column (nullable initially for existing data)
ALTER TABLE document_saves
  ADD COLUMN IF NOT EXISTS workspace_id UUID REFERENCES workspaces(id) ON DELETE RESTRICT;

-- 2. Backfill workspace_id from the related notes table (if notes has workspace_id)
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'notes' AND column_name = 'workspace_id'
  ) THEN
    EXECUTE 'UPDATE document_saves ds SET workspace_id = n.workspace_id FROM notes n WHERE ds.note_id = n.id AND ds.workspace_id IS NULL';
  END IF;
END $$;

-- 3. Skip NOT NULL for now — applied later once workspace_id is backfilled
-- ALTER TABLE document_saves ALTER COLUMN workspace_id SET NOT NULL;

-- 4. Add index for performance
CREATE INDEX IF NOT EXISTS idx_document_saves_workspace 
  ON document_saves(workspace_id);

-- 5. Add composite index for workspace-scoped queries
CREATE INDEX IF NOT EXISTS idx_document_saves_ws_note_panel 
  ON document_saves(workspace_id, note_id, panel_id, version DESC);