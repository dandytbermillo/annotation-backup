-- Migration 045: Create user_preferences table
-- Part of Dashboard Implementation Plan - Phase 1.6
-- Purpose: Store user-specific preferences for dashboard functionality

BEGIN;

-- Create the user_preferences table
CREATE TABLE IF NOT EXISTS user_preferences (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL UNIQUE, -- One preferences record per user
  last_workspace_id UUID REFERENCES note_workspaces(id) ON DELETE SET NULL,
  quick_capture_entry_id UUID REFERENCES items(id) ON DELETE SET NULL,
  settings JSONB NOT NULL DEFAULT '{}', -- Additional settings as needed
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Index for efficient user lookup (already covered by UNIQUE but explicit for clarity)
CREATE INDEX IF NOT EXISTS idx_user_preferences_user_id
  ON user_preferences(user_id);

-- Trigger to update updated_at timestamp
CREATE TRIGGER trg_user_preferences_updated_at
  BEFORE UPDATE ON user_preferences
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at();

-- Comments for documentation
COMMENT ON TABLE user_preferences IS 'Stores per-user preferences for dashboard and workspace behavior';
COMMENT ON COLUMN user_preferences.last_workspace_id IS 'The last non-Home workspace the user visited. Used by Continue panel.';
COMMENT ON COLUMN user_preferences.quick_capture_entry_id IS 'Entry (item) where Quick Capture notes are saved. Defaults to Ideas Inbox if NULL.';
COMMENT ON COLUMN user_preferences.settings IS 'Additional user settings as JSON. E.g., {theme: "dark", shortcuts: {...}}';

COMMIT;
