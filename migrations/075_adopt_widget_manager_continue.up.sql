-- Migration 075: Adopt widget_manager and continue into duplicate-instance identity
--
-- Backfills instance_label and duplicate_family for existing widget_manager
-- and continue panels, matching the pattern from migration 074 (navigator).

-- Safety check: fail if any workspace has >26 widget_manager instances
DO $$
BEGIN
  IF EXISTS (
    SELECT workspace_id FROM workspace_panels
    WHERE panel_type = 'widget_manager' AND deleted_at IS NULL
    GROUP BY workspace_id HAVING COUNT(*) > 26
  ) THEN
    RAISE EXCEPTION 'Migration blocked: workspace with >26 widget_manager panels. Manual cleanup required.';
  END IF;
END $$;

-- Safety check: fail if any workspace has >26 continue instances
DO $$
BEGIN
  IF EXISTS (
    SELECT workspace_id FROM workspace_panels
    WHERE panel_type = 'continue' AND deleted_at IS NULL
    GROUP BY workspace_id HAVING COUNT(*) > 26
  ) THEN
    RAISE EXCEPTION 'Migration blocked: workspace with >26 continue panels. Manual cleanup required.';
  END IF;
END $$;

-- Backfill widget_manager: assign labels by creation order within each workspace
WITH wm_ranked AS (
  SELECT id, workspace_id,
         ROW_NUMBER() OVER (PARTITION BY workspace_id ORDER BY created_at ASC, id ASC) AS rn
  FROM workspace_panels
  WHERE panel_type = 'widget_manager'
    AND deleted_at IS NULL
    AND instance_label IS NULL
)
UPDATE workspace_panels wp
  SET instance_label = CHR(64 + nr.rn::int),
      duplicate_family = 'widget-manager'
  FROM wm_ranked nr
  WHERE wp.id = nr.id;

-- Backfill continue: assign labels by creation order within each workspace
WITH cont_ranked AS (
  SELECT id, workspace_id,
         ROW_NUMBER() OVER (PARTITION BY workspace_id ORDER BY created_at ASC, id ASC) AS rn
  FROM workspace_panels
  WHERE panel_type = 'continue'
    AND deleted_at IS NULL
    AND instance_label IS NULL
)
UPDATE workspace_panels wp
  SET instance_label = CHR(64 + nr.rn::int),
      duplicate_family = 'continue'
  FROM cont_ranked nr
  WHERE wp.id = nr.id;
