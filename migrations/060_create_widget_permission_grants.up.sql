-- Migration 060: Create widget_permission_grants table
-- Phase 3: Safe Custom Widgets - Permission persistence
--
-- Stores user approval decisions for widget permissions (per widget instance).

CREATE TABLE widget_permission_grants (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  widget_instance_id UUID NOT NULL REFERENCES widget_instances(id) ON DELETE CASCADE,
  user_id UUID, -- nullable for single-user mode
  permission TEXT NOT NULL,
  allow_level TEXT NOT NULL CHECK (allow_level IN ('once', 'always', 'never')),
  granted_at TIMESTAMPTZ DEFAULT now(),
  expires_at TIMESTAMPTZ, -- null = permanent, set for 'once' grants
  updated_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE(widget_instance_id, user_id, permission)
);

-- Indexes for efficient lookups
CREATE INDEX idx_widget_permission_grants_widget_instance ON widget_permission_grants(widget_instance_id);
CREATE INDEX idx_widget_permission_grants_user ON widget_permission_grants(user_id);

-- Comment for documentation
COMMENT ON TABLE widget_permission_grants IS 'Stores user approval decisions for sandboxed widget permissions';
COMMENT ON COLUMN widget_permission_grants.allow_level IS 'once = single use, always = permanent allow, never = permanent deny';
COMMENT ON COLUMN widget_permission_grants.expires_at IS 'For once grants, when the permission expires (null = permanent)';
