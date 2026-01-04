-- Migration 060: Rollback widget_permission_grants table

DROP INDEX IF EXISTS idx_widget_permission_grants_user;
DROP INDEX IF EXISTS idx_widget_permission_grants_widget_instance;
DROP TABLE IF EXISTS widget_permission_grants;
