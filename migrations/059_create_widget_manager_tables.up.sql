-- Migration: Create Widget Manager tables
-- Purpose: Store installed widgets and their dashboard instances for chat integration
-- Reference: docs/proposal/chat-navigation/plan/panels/widget_manager/widget-manager-plan.md

-- Ensure pgcrypto extension for gen_random_uuid()
CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- Create source_type enum for widget installation sources
DO $$ BEGIN
  CREATE TYPE widget_source_type AS ENUM ('url', 'file', 'store', 'builtin');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

-- Table: installed_widgets
-- Stores widget metadata and manifest for server-side chat usage
-- Key design: Server-side manifest source of truth (not client-side registration)
CREATE TABLE installed_widgets (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NULL, -- nullable for single-user mode
  name text NOT NULL,
  slug text NOT NULL,
  source_type widget_source_type NOT NULL DEFAULT 'url',
  source_ref text NULL, -- URL or file identifier (null for builtin)
  version text NOT NULL DEFAULT '1.0.0',
  manifest jsonb NOT NULL, -- PanelChatManifest: panelId, panelType, title, intents[]
  enabled boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- Unique slug per user (or globally if user_id is null)
CREATE UNIQUE INDEX installed_widgets_user_slug_unique
  ON installed_widgets (COALESCE(user_id, '00000000-0000-0000-0000-000000000000'::uuid), slug);

-- Index for loading enabled widgets for chat prompt
CREATE INDEX installed_widgets_enabled_idx
  ON installed_widgets (user_id, enabled)
  WHERE enabled = true;

-- Table: widget_instances
-- Stores placement of a widget on a dashboard
-- panel_id must be unique per instance for chat targeting
CREATE TABLE widget_instances (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NULL, -- nullable for single-user mode
  widget_id uuid NOT NULL REFERENCES installed_widgets(id) ON DELETE CASCADE,
  entry_id uuid NULL REFERENCES items(id) ON DELETE CASCADE, -- entry context
  workspace_id uuid NULL REFERENCES note_workspaces(id) ON DELETE CASCADE, -- dashboard workspace
  panel_id text NOT NULL, -- unique instance panelId for chat (e.g., "task-board-1")
  config jsonb NULL, -- widget-specific configuration
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- Unique panel_id per user (for chat targeting)
CREATE UNIQUE INDEX widget_instances_user_panel_id_unique
  ON widget_instances (COALESCE(user_id, '00000000-0000-0000-0000-000000000000'::uuid), panel_id);

-- Index for loading widget instances by workspace
CREATE INDEX widget_instances_workspace_idx
  ON widget_instances (workspace_id);

-- Index for loading widget instances by widget
CREATE INDEX widget_instances_widget_idx
  ON widget_instances (widget_id);

-- Comments for documentation
COMMENT ON TABLE installed_widgets IS 'Installed widgets with manifests for server-side chat integration';
COMMENT ON TABLE widget_instances IS 'Widget placements on dashboards with unique panel IDs for chat targeting';
COMMENT ON COLUMN installed_widgets.manifest IS 'PanelChatManifest JSON: { panelId, panelType, title, intents: [{ name, description, examples, handler, permission }] }';
COMMENT ON COLUMN installed_widgets.enabled IS 'When false, widget manifest is not loaded for chat prompt';
COMMENT ON COLUMN widget_instances.panel_id IS 'Unique instance ID for chat commands (e.g., "quick-links-d")';
COMMENT ON COLUMN widget_instances.config IS 'Widget-specific settings (e.g., { location: "San Francisco" } for weather)';
