-- Migration 044: Create workspace_panels table
-- Part of Dashboard Implementation Plan - Phase 1.4
-- Purpose: Store panel instances for workspaces (both dashboard and regular workspaces)
-- Panel types: 'note', 'navigator', 'recent', 'continue', 'quick_capture'

BEGIN;

-- Create the workspace_panels table
CREATE TABLE IF NOT EXISTS workspace_panels (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL REFERENCES note_workspaces(id) ON DELETE CASCADE,
  panel_type TEXT NOT NULL CHECK (panel_type IN ('note', 'navigator', 'recent', 'continue', 'quick_capture')),
  title TEXT, -- Optional title (mainly for 'note' panels)
  position_x INT NOT NULL DEFAULT 0,
  position_y INT NOT NULL DEFAULT 0,
  width INT NOT NULL DEFAULT 280,
  height INT NOT NULL DEFAULT 200,
  z_index INT NOT NULL DEFAULT 0,
  config JSONB NOT NULL DEFAULT '{}', -- Panel-specific configuration
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Index for efficient lookup by workspace
CREATE INDEX IF NOT EXISTS idx_workspace_panels_workspace_id
  ON workspace_panels(workspace_id);

-- Index for panel type queries (e.g., find all navigator panels)
CREATE INDEX IF NOT EXISTS idx_workspace_panels_type
  ON workspace_panels(panel_type);

-- Trigger to update updated_at timestamp
CREATE TRIGGER trg_workspace_panels_updated_at
  BEFORE UPDATE ON workspace_panels
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at();

-- Comments for documentation
COMMENT ON TABLE workspace_panels IS 'Panel instances for workspaces. Supports dashboard panels (navigator, continue, recent, quick_capture) and regular note panels.';
COMMENT ON COLUMN workspace_panels.panel_type IS 'Type of panel: note (text editor), navigator (entry tree), recent (recent workspaces), continue (resume last workspace), quick_capture (quick note input)';
COMMENT ON COLUMN workspace_panels.config IS 'Panel-specific configuration. For note panels: {content: "..."}. For navigator: {expandedEntries: [...]}. etc.';
COMMENT ON COLUMN workspace_panels.z_index IS 'Stacking order of panels. Higher values appear on top.';

COMMIT;
