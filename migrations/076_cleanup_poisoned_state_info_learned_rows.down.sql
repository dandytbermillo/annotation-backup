-- Phase 1.6 Fix 1c down: no-op.
--
-- The .up migration soft-deletes poisoned learned rows via
-- `UPDATE ... SET is_deleted = true`. Reversing that would require storing
-- the list of affected row ids at migration time, and the cleanup is forward-only
-- per the plan (re-promoting known-poisoned rows is never desirable).
--
-- If a row soft-deleted by the .up migration needs to be restored, do it
-- manually with targeted UPDATE statements rather than via `.down.sql`.
SELECT 1 AS noop;
