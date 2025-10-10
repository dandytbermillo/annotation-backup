-- Migration 029 Rollback: Remove Security Validation Constraints
-- Purpose: Revert validation constraints if they cause issues
-- Created: 2025-10-09

-- Remove constraints in reverse order of creation
ALTER TABLE annotation_types DROP CONSTRAINT IF EXISTS annotation_types_label_printable_check;
ALTER TABLE annotation_types DROP CONSTRAINT IF EXISTS annotation_types_icon_length_check;
ALTER TABLE annotation_types DROP CONSTRAINT IF EXISTS annotation_types_gradient_check;

-- Remove metadata validation trigger and functions
DROP TRIGGER IF EXISTS trigger_validate_annotation_type_metadata ON annotation_types;
DROP FUNCTION IF EXISTS validate_annotation_type_metadata();
DROP FUNCTION IF EXISTS jsonb_has_forbidden_key(jsonb, text);

-- Note: Existing data is not affected by dropping constraints
-- If you need to re-apply constraints after fixing data, run the .up.sql migration again
