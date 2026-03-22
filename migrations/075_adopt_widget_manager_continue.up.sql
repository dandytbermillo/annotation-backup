-- Migration 075: Clean up widget_manager and continue duplicate metadata
--
-- These panel types are singletons — they were briefly adopted into the
-- duplicate-instance framework but should not be duplicable.
-- This migration clears any stale instance_label/duplicate_family values.

UPDATE workspace_panels
  SET instance_label = NULL, duplicate_family = NULL
  WHERE panel_type IN ('widget_manager', 'continue')
    AND (instance_label IS NOT NULL OR duplicate_family IS NOT NULL);
