-- Migration: 006 - Add plain-mode columns to branches
-- Purpose: Align branches schema with Option A API expectations
-- Adds parent_id (self-referencing) and anchors (JSONB) columns

BEGIN;

ALTER TABLE branches
  ADD COLUMN IF NOT EXISTS parent_id UUID REFERENCES branches(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS anchors JSONB;

-- Helpful indexes
CREATE INDEX IF NOT EXISTS idx_branches_parent_id ON branches(parent_id);

-- Documentation comments
COMMENT ON COLUMN branches.parent_id IS 'Optional parent branch for hierarchical relationships (plain mode)';
COMMENT ON COLUMN branches.anchors IS 'Plain mode anchor payload (e.g., text positions)';

COMMIT;

