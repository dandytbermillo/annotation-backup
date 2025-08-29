-- Migration: 008 - Fix branches required columns for plain mode
-- Makes Yjs-specific columns nullable since they're not used in plain mode

BEGIN;

-- Make Yjs-specific columns nullable
ALTER TABLE branches
  ALTER COLUMN branch_id DROP NOT NULL,
  ALTER COLUMN source_panel DROP NOT NULL,
  ALTER COLUMN target_panel DROP NOT NULL,
  ALTER COLUMN anchor_start DROP NOT NULL,
  ALTER COLUMN anchor_end DROP NOT NULL,
  ALTER COLUMN "order" DROP NOT NULL;

-- Add comments explaining the nullable columns
COMMENT ON COLUMN branches.branch_id IS 'YJS map key (nullable in plain mode)';
COMMENT ON COLUMN branches.source_panel IS 'YJS source panel (nullable in plain mode)';
COMMENT ON COLUMN branches.target_panel IS 'YJS target panel (nullable in plain mode)';
COMMENT ON COLUMN branches.anchor_start IS 'YJS anchor start (nullable in plain mode)';
COMMENT ON COLUMN branches.anchor_end IS 'YJS anchor end (nullable in plain mode)';
COMMENT ON COLUMN branches."order" IS 'Fractional index for ordering (nullable in plain mode)';

COMMIT;