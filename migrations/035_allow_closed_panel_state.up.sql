ALTER TABLE panels
  DROP CONSTRAINT IF EXISTS panels_state_check;

ALTER TABLE panels
  ADD CONSTRAINT panels_state_check
  CHECK (state IN ('active', 'lazy', 'unloaded', 'closed'));
