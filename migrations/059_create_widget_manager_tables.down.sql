-- Migration: Drop Widget Manager tables
-- Reverses: 059_create_widget_manager_tables.up.sql

-- Drop tables (order matters due to FK constraints)
DROP TABLE IF EXISTS widget_instances;
DROP TABLE IF EXISTS installed_widgets;

-- Drop enum type
DROP TYPE IF EXISTS widget_source_type;
