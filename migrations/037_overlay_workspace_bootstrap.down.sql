-- Roll back overlay workspace bootstrap seed

BEGIN;

DELETE FROM overlay_layouts
WHERE user_id IS NULL
  AND (layout->>'schemaVersion') = '2.0.0'
  AND (layout->'popups') = '[]'::JSONB
  AND workspace_id IN (
    SELECT id FROM workspaces WHERE is_default = TRUE
  );

COMMIT;
