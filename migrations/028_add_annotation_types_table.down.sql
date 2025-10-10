-- Rollback migration: Remove annotation_types table
-- Author: Claude (Senior Software Engineer)
-- Date: 2025-10-09
-- Purpose: Revert to hardcoded annotation types if migration needs to be rolled back

-- Drop trigger first
DROP TRIGGER IF EXISTS trigger_annotation_types_updated_at ON annotation_types;
DROP FUNCTION IF EXISTS update_annotation_types_updated_at();

-- Drop indexes
DROP INDEX IF EXISTS idx_annotation_types_created_at;
DROP INDEX IF EXISTS idx_annotation_types_is_system;

-- Drop table (CASCADE will drop dependent objects if any)
DROP TABLE IF EXISTS annotation_types CASCADE;

-- Note: After rolling back this migration, the codebase will fall back to
-- hardcoded annotation types in lib/models/annotation.ts
