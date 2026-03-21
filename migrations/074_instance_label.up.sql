-- Migration 074: Generic duplicate panel instance identity
--
-- Adds instance_label and duplicate_family columns to workspace_panels.
-- Generalizes the Links-only badge system into a shared duplicate-instance
-- identity contract for any duplicable panel family.

-- Add generic instance_label column
ALTER TABLE workspace_panels
  ADD COLUMN IF NOT EXISTS instance_label VARCHAR(5);

-- Add duplicate_family column (denormalized for DB-level uniqueness enforcement)
-- Matches the authoritative DUPLICATE_FAMILY_MAP in lib/dashboard/duplicate-family-map.ts
ALTER TABLE workspace_panels
  ADD COLUMN IF NOT EXISTS duplicate_family VARCHAR(50);

-- Backfill Links Panels: copy existing badge → instance_label
UPDATE workspace_panels
  SET instance_label = badge,
      duplicate_family = 'quick-links'
  WHERE panel_type IN ('links_note', 'links_note_tiptap')
    AND badge IS NOT NULL
    AND instance_label IS NULL;

-- Safety check: fail migration if any workspace has >26 navigator instances
DO $$
BEGIN
  IF EXISTS (
    SELECT workspace_id FROM workspace_panels
    WHERE panel_type = 'navigator' AND deleted_at IS NULL
    GROUP BY workspace_id HAVING COUNT(*) > 26
  ) THEN
    RAISE EXCEPTION 'Migration blocked: workspace with >26 navigator panels. Manual cleanup required.';
  END IF;
END $$;

-- Backfill Navigator: assign labels by creation order within each workspace
-- Uses a deterministic window function (created_at ASC, id ASC) for stable ordering.
WITH navigator_ranked AS (
  SELECT id, workspace_id,
         ROW_NUMBER() OVER (PARTITION BY workspace_id ORDER BY created_at ASC, id ASC) AS rn
  FROM workspace_panels
  WHERE panel_type = 'navigator'
    AND deleted_at IS NULL
    AND instance_label IS NULL
)
UPDATE workspace_panels wp
  SET instance_label = CHR(64 + nr.rn::int),
      duplicate_family = 'navigator'
  FROM navigator_ranked nr
  WHERE wp.id = nr.id;

-- Family-scoped unique constraint: no two siblings of the same family share a label
-- This is the write-time safety net that prevents concurrent allocation conflicts
-- across panel_type values within the same family (e.g., links_note/A + links_note_tiptap/A)
CREATE UNIQUE INDEX IF NOT EXISTS ux_workspace_panels_family_instance_label
  ON workspace_panels(workspace_id, duplicate_family, instance_label)
  WHERE instance_label IS NOT NULL AND duplicate_family IS NOT NULL AND deleted_at IS NULL;
