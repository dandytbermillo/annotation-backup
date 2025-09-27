-- Persist overlay canvas layout per workspace/user for Option A plain mode

CREATE TABLE IF NOT EXISTS overlay_layouts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  user_id UUID,
  layout JSONB NOT NULL,
  version TEXT NOT NULL,
  revision UUID NOT NULL DEFAULT gen_random_uuid(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS ux_overlay_layouts_workspace_user
  ON overlay_layouts(workspace_id, COALESCE(user_id, '00000000-0000-0000-0000-000000000000'::uuid));

CREATE INDEX IF NOT EXISTS idx_overlay_layouts_updated_at
  ON overlay_layouts(updated_at DESC);

COMMENT ON TABLE overlay_layouts IS 'Stores popup overlay layout state for Option A plain mode';
COMMENT ON COLUMN overlay_layouts.workspace_id IS 'Workspace owning this layout';
COMMENT ON COLUMN overlay_layouts.user_id IS 'User owning this layout (NULL for shared layout)';
COMMENT ON COLUMN overlay_layouts.layout IS 'Serialized layout metadata (positions, inspector state)';
COMMENT ON COLUMN overlay_layouts.version IS 'Schema version string for layout payload';
COMMENT ON COLUMN overlay_layouts.revision IS 'Optimistic locking token';
