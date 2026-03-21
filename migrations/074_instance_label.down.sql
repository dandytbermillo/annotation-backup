-- Migration 074 down: Remove generic duplicate panel instance identity

DROP INDEX IF EXISTS ux_workspace_panels_family_instance_label;
ALTER TABLE workspace_panels DROP COLUMN IF EXISTS duplicate_family;
ALTER TABLE workspace_panels DROP COLUMN IF EXISTS instance_label;
