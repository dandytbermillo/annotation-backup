-- Migration: Add annotation_types table for extensible annotation type system
-- Author: Claude (Senior Software Engineer)
-- Date: 2025-10-09
-- Purpose: Enable database-backed annotation types instead of hardcoded types
-- Related: docs/proposal/extensible-annotation-types/IMPLEMENTATION_PLAN.md

-- Create annotation_types table
CREATE TABLE IF NOT EXISTS annotation_types (
  id                VARCHAR(64) PRIMARY KEY,
  label             VARCHAR(100) NOT NULL,
  color             VARCHAR(7)   NOT NULL CHECK (color ~ '^#[0-9a-fA-F]{6}$'),
  gradient          TEXT         NOT NULL,
  icon              VARCHAR(16)  NOT NULL,
  default_width     INTEGER      NOT NULL CHECK (default_width BETWEEN 120 AND 1200),
  metadata          JSONB        DEFAULT '{}'::jsonb,
  is_system         BOOLEAN      NOT NULL DEFAULT FALSE,
  created_at        TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  updated_at        TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

-- Add indexes for common queries
CREATE INDEX IF NOT EXISTS idx_annotation_types_is_system ON annotation_types(is_system);
CREATE INDEX IF NOT EXISTS idx_annotation_types_created_at ON annotation_types(created_at);

-- Add trigger for updated_at (idempotent)
CREATE OR REPLACE FUNCTION update_annotation_types_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Drop trigger if exists, then create (idempotent)
DROP TRIGGER IF EXISTS trigger_annotation_types_updated_at ON annotation_types;
CREATE TRIGGER trigger_annotation_types_updated_at
  BEFORE UPDATE ON annotation_types
  FOR EACH ROW
  EXECUTE FUNCTION update_annotation_types_updated_at();

-- Insert seed data for existing hardcoded types
-- These match the existing types in lib/models/annotation.ts
INSERT INTO annotation_types (id, label, color, gradient, icon, default_width, is_system) VALUES
  (
    'note',
    'Note',
    '#3498db',
    'linear-gradient(135deg, #3498db 0%, #2980b9 100%)',
    '📝',
    380,
    TRUE
  ),
  (
    'explore',
    'Explore',
    '#f39c12',
    'linear-gradient(135deg, #f39c12 0%, #e67e22 100%)',
    '🔍',
    500,
    TRUE
  ),
  (
    'promote',
    'Promote',
    '#27ae60',
    'linear-gradient(135deg, #27ae60 0%, #229954 100%)',
    '⭐',
    550,
    TRUE
  )
ON CONFLICT (id) DO NOTHING; -- Idempotent: skip if already exists

-- Add comment to table for documentation
COMMENT ON TABLE annotation_types IS 'Stores extensible annotation type definitions. System types (is_system=true) are immutable.';
COMMENT ON COLUMN annotation_types.id IS 'Unique identifier (kebab-case, 1-64 chars)';
COMMENT ON COLUMN annotation_types.label IS 'Display name for UI';
COMMENT ON COLUMN annotation_types.color IS 'Hex color code for visual differentiation';
COMMENT ON COLUMN annotation_types.gradient IS 'CSS gradient for panel headers';
COMMENT ON COLUMN annotation_types.icon IS 'Emoji or icon character';
COMMENT ON COLUMN annotation_types.default_width IS 'Default panel width in pixels (120-1200)';
COMMENT ON COLUMN annotation_types.metadata IS 'Extensible JSON metadata for future features';
COMMENT ON COLUMN annotation_types.is_system IS 'True for built-in types (cannot be deleted)';
