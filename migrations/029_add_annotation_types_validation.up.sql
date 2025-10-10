-- Migration 029: Add Security Validation Constraints to annotation_types
-- Purpose: Prevent XSS, injection, and malicious data BEFORE Phase 2 write endpoints
-- Created: 2025-10-09
-- CRITICAL: Must be applied before POST /api/annotation-types endpoint goes live

-- 1. Gradient validation: Only allow valid CSS gradients or hex colors
-- Blocks: javascript:alert(1), data:text/html;base64,..., vbscript:, etc.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'annotation_types_gradient_check'
  ) THEN
    ALTER TABLE annotation_types
    ADD CONSTRAINT annotation_types_gradient_check
    CHECK (
      gradient ~ '^linear-gradient\([^)]+\)$' OR
      gradient ~ '^radial-gradient\([^)]+\)$' OR
      gradient ~ '^conic-gradient\([^)]+\)$' OR
      gradient ~ '^#[0-9a-fA-F]{6}$'
    );
  END IF;
END $$;

-- 2. Metadata validation: Define allowed keys (whitelist approach) using a TRIGGER
-- Allowed keys: tags, description, category, author, version
-- Blocks: __proto__, constructor, and other prototype pollution attempts
--
-- NOTE: PostgreSQL doesn't allow subqueries in CHECK constraints, so we use a trigger instead.

-- Create recursive function to scan for forbidden keys (prototype pollution)
CREATE OR REPLACE FUNCTION jsonb_has_forbidden_key(data jsonb, path text DEFAULT '')
RETURNS text AS $$
DECLARE
  key text;
  value jsonb;
  result text;
  forbidden_keys text[] := ARRAY['__proto__', 'constructor', 'prototype'];
BEGIN
  -- Check if data is an object
  IF jsonb_typeof(data) != 'object' THEN
    RETURN NULL;
  END IF;

  -- Iterate through all keys at this level
  FOR key, value IN SELECT * FROM jsonb_each(data)
  LOOP
    -- Check if key is forbidden
    IF key = ANY(forbidden_keys) THEN
      RETURN format('Forbidden key "%s" found at %s.%s', key, path, key);
    END IF;

    -- Recursively check nested objects
    IF jsonb_typeof(value) = 'object' THEN
      result := jsonb_has_forbidden_key(value, path || '.' || key);
      IF result IS NOT NULL THEN
        RETURN result;
      END IF;
    END IF;

    -- Recursively check arrays
    IF jsonb_typeof(value) = 'array' THEN
      -- Check each element in array
      FOR i IN 0..(jsonb_array_length(value) - 1)
      LOOP
        result := jsonb_has_forbidden_key(value -> i, path || '.' || key || '[' || i || ']');
        IF result IS NOT NULL THEN
          RETURN result;
        END IF;
      END LOOP;
    END IF;
  END LOOP;

  RETURN NULL;
END;
$$ LANGUAGE plpgsql IMMUTABLE;

-- Create function to validate metadata keys
CREATE OR REPLACE FUNCTION validate_annotation_type_metadata()
RETURNS TRIGGER AS $$
DECLARE
  allowed_keys text[] := ARRAY['tags', 'description', 'category', 'author', 'version'];
  metadata_keys text[];
  invalid_key text;
  forbidden_key_error text;
BEGIN
  -- Skip validation if metadata is empty
  IF NEW.metadata = '{}'::jsonb THEN
    RETURN NEW;
  END IF;

  -- First check: Top-level keys must be in whitelist
  SELECT array_agg(key) INTO metadata_keys
  FROM jsonb_object_keys(NEW.metadata) AS key;

  FOREACH invalid_key IN ARRAY metadata_keys
  LOOP
    IF NOT (invalid_key = ANY(allowed_keys)) THEN
      RAISE EXCEPTION 'Invalid metadata key: %. Allowed keys: %', invalid_key, array_to_string(allowed_keys, ', ');
    END IF;
  END LOOP;

  -- Second check: Recursively scan for forbidden keys (prototype pollution)
  forbidden_key_error := jsonb_has_forbidden_key(NEW.metadata, 'metadata');
  IF forbidden_key_error IS NOT NULL THEN
    RAISE EXCEPTION '%', forbidden_key_error;
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Create trigger that runs before INSERT or UPDATE
DROP TRIGGER IF EXISTS trigger_validate_annotation_type_metadata ON annotation_types;
CREATE TRIGGER trigger_validate_annotation_type_metadata
  BEFORE INSERT OR UPDATE ON annotation_types
  FOR EACH ROW
  EXECUTE FUNCTION validate_annotation_type_metadata();

-- 3. Icon validation: Prevent excessively long strings (emojis are 1-4 bytes)
-- This blocks attempts to inject long HTML/JS strings as icons
-- Most emojis are 1-2 characters, emoji sequences (like 👨‍💻) can be up to 4
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'annotation_types_icon_length_check'
  ) THEN
    ALTER TABLE annotation_types
    ADD CONSTRAINT annotation_types_icon_length_check
    CHECK (char_length(icon) <= 4);
  END IF;
END $$;

-- 4. Label validation: Prevent control characters and excessive length
-- Already have VARCHAR(100) but add CHECK to prevent control chars
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'annotation_types_label_printable_check'
  ) THEN
    ALTER TABLE annotation_types
    ADD CONSTRAINT annotation_types_label_printable_check
    CHECK (label ~ '^[a-zA-Z0-9\s\-_()]+$');
  END IF;
END $$;

-- Verification queries (run these manually to test constraints):
--
-- -- Should FAIL (javascript: URI):
-- INSERT INTO annotation_types (id, label, color, gradient, icon, default_width)
-- VALUES ('evil1', 'Evil', '#FF0000', 'javascript:alert(1)', '💀', 400);
--
-- -- Should FAIL (data: URI):
-- INSERT INTO annotation_types (id, label, color, gradient, icon, default_width)
-- VALUES ('evil2', 'Evil', '#FF0000', 'data:text/html,<script>alert(1)</script>', '💀', 400);
--
-- -- Should FAIL (invalid metadata key):
-- INSERT INTO annotation_types (id, label, color, gradient, icon, default_width, metadata)
-- VALUES ('evil3', 'Evil', '#FF0000', '#FF0000', '💀', 400, '{"__proto__": "bad"}'::jsonb);
--
-- -- Should SUCCEED (valid gradient):
-- INSERT INTO annotation_types (id, label, color, gradient, icon, default_width)
-- VALUES ('test1', 'Test', '#FF0000', 'linear-gradient(135deg, #FF0000 0%, #AA0000 100%)', '🔥', 400);
--
-- -- Should SUCCEED (valid metadata):
-- INSERT INTO annotation_types (id, label, color, gradient, icon, default_width, metadata)
-- VALUES ('test2', 'Test', '#FF0000', '#FF0000', '🔥', 400, '{"tags": ["test"], "description": "A test type"}'::jsonb);
