-- Migration 075 down: Remove widget_manager and continue from duplicate-instance identity

UPDATE workspace_panels
  SET instance_label = NULL, duplicate_family = NULL
  WHERE duplicate_family IN ('widget-manager', 'continue');
