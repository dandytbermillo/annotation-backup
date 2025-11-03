-- Bootstrap shared workspace catalog and seed overlay layout defaults
-- Ensures /api/overlay/workspaces has backing data in plain mode

BEGIN;

CREATE TABLE IF NOT EXISTS workspaces (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  is_default BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  metadata JSONB NOT NULL DEFAULT '{}'::JSONB
);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'workspaces' AND column_name = 'name'
  ) THEN
    ALTER TABLE workspaces ADD COLUMN name TEXT;
    UPDATE workspaces SET name = 'Workspace' WHERE name IS NULL;
    ALTER TABLE workspaces ALTER COLUMN name SET NOT NULL;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'workspaces' AND column_name = 'is_default'
  ) THEN
    ALTER TABLE workspaces ADD COLUMN is_default BOOLEAN NOT NULL DEFAULT FALSE;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'workspaces' AND column_name = 'created_at'
  ) THEN
    ALTER TABLE workspaces ADD COLUMN created_at TIMESTAMPTZ NOT NULL DEFAULT NOW();
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'workspaces' AND column_name = 'updated_at'
  ) THEN
    ALTER TABLE workspaces ADD COLUMN updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW();
  ELSE
    ALTER TABLE workspaces ALTER COLUMN updated_at SET DEFAULT NOW();
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'workspaces' AND column_name = 'metadata'
  ) THEN
    ALTER TABLE workspaces ADD COLUMN metadata JSONB NOT NULL DEFAULT '{}'::JSONB;
  END IF;
END;
$$;

CREATE UNIQUE INDEX IF NOT EXISTS only_one_default ON workspaces (is_default) WHERE is_default;

CREATE OR REPLACE FUNCTION set_workspaces_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS set_workspaces_updated_at ON workspaces;
CREATE TRIGGER set_workspaces_updated_at
  BEFORE UPDATE ON workspaces
  FOR EACH ROW
  EXECUTE FUNCTION set_workspaces_updated_at();

INSERT INTO workspaces (name, is_default)
SELECT 'Default Workspace', TRUE
WHERE NOT EXISTS (SELECT 1 FROM workspaces WHERE is_default = TRUE);

DO $$
DECLARE
  default_ws UUID;
BEGIN
  SELECT id INTO default_ws FROM workspaces WHERE is_default = TRUE LIMIT 1;

  IF default_ws IS NULL THEN
    RETURN;
  END IF;

  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'notes' AND column_name = 'workspace_id'
  ) THEN
    UPDATE notes SET workspace_id = default_ws WHERE workspace_id IS NULL;
  END IF;

  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'panels' AND column_name = 'workspace_id'
  ) THEN
    UPDATE panels SET workspace_id = default_ws WHERE workspace_id IS NULL;
  END IF;

  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'document_saves' AND column_name = 'workspace_id'
  ) THEN
    UPDATE document_saves SET workspace_id = default_ws WHERE workspace_id IS NULL;
  END IF;

  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'items' AND column_name = 'workspace_id'
  ) THEN
    UPDATE items SET workspace_id = default_ws WHERE workspace_id IS NULL;
  END IF;

  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'debug_logs' AND column_name = 'workspace_id'
  ) THEN
    UPDATE debug_logs SET workspace_id = default_ws WHERE workspace_id IS NULL;
  END IF;
END;
$$;

DO $$
DECLARE
  default_ws UUID;
  iso_now TEXT;
BEGIN
  SELECT id INTO default_ws FROM workspaces WHERE is_default = TRUE LIMIT 1;

  IF default_ws IS NULL THEN
    RETURN;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_name = 'overlay_layouts'
  ) THEN
    RETURN;
  END IF;

  SELECT to_char(NOW() AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') INTO iso_now;

  INSERT INTO overlay_layouts (workspace_id, user_id, layout, version)
  SELECT
    default_ws,
    NULL,
    jsonb_build_object(
      'schemaVersion', '2.0.0',
      'popups', '[]'::JSONB,
      'inspectors', '[]'::JSONB,
      'lastSavedAt', iso_now
    ),
    '2.0.0'
  WHERE NOT EXISTS (
    SELECT 1 FROM overlay_layouts
    WHERE workspace_id = default_ws
      AND user_id IS NULL
  );
END;
$$;

COMMIT;
