-- Phase 2a Fix 3 Part A Integration — down is a no-op.
--
-- The .up migration soft-deletes orphan `widget_preseed` rows. Reversing would
-- require preserving the list of affected ids at migration time, and the
-- cleanup is forward-only per the plan (re-activating known-orphan rows is
-- never desirable).
SELECT 1 AS noop;
