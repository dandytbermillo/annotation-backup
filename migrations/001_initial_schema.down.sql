-- PostgreSQL Schema Rollback for YJS Annotation System
-- Migration: 001_initial_schema.down.sql
-- Purpose: Rollback initial schema creation

BEGIN;

-- Drop triggers first
DROP TRIGGER IF EXISTS update_notes_updated ON notes;
DROP TRIGGER IF EXISTS update_branches_updated ON branches;
DROP TRIGGER IF EXISTS update_panels_updated ON panels;

-- Drop function
DROP FUNCTION IF EXISTS update_updated_at() CASCADE;

-- Drop tables in reverse dependency order
DROP TABLE IF EXISTS connections CASCADE;
DROP TABLE IF EXISTS snapshots CASCADE;
DROP TABLE IF EXISTS panels CASCADE;
DROP TABLE IF EXISTS branches CASCADE;
DROP TABLE IF EXISTS yjs_updates CASCADE;
DROP TABLE IF EXISTS notes CASCADE;

COMMIT;