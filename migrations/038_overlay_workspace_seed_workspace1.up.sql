-- Seed a shared "Workspace 1" snapshot based on the default workspace layout

BEGIN;

DO $$
DECLARE
  default_ws UUID;
  cloned_ws UUID;
  inserted_count INTEGER := 0;
BEGIN
  SELECT id INTO default_ws
    FROM workspaces
   WHERE is_default = TRUE
   LIMIT 1;

  IF default_ws IS NULL THEN
    RETURN;
  END IF;

  IF EXISTS (
    SELECT 1 FROM workspaces WHERE name = 'Workspace 1'
  ) THEN
    RETURN;
  END IF;

  INSERT INTO workspaces (name, is_default)
  VALUES ('Workspace 1', FALSE)
  RETURNING id INTO cloned_ws;

  INSERT INTO overlay_layouts (workspace_id, user_id, layout, version)
  SELECT cloned_ws, user_id, layout, version
    FROM overlay_layouts
   WHERE workspace_id = default_ws
     AND user_id IS NULL;

  GET DIAGNOSTICS inserted_count = ROW_COUNT;

  IF inserted_count = 0 THEN
    INSERT INTO overlay_layouts (workspace_id, user_id, layout, version)
    VALUES (
      cloned_ws,
      NULL,
      jsonb_build_object(
        'schemaVersion', '2.0.0',
        'popups', '[]'::JSONB,
        'inspectors', '[]'::JSONB,
        'lastSavedAt', to_char(NOW() AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')
      ),
      '2.0.0'
    );
  END IF;
END;
$$;

COMMIT;
