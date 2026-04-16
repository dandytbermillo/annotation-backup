-- Phase 2a Fix 3 Part A Integration (Option A) — one-time cleanup of orphan
-- `widget_preseed` scoped rows written before the partition fix landed.
--
-- Background:
-- The initial Fix 3 Part A implementation wrote widget preseed rows under
-- `scope_source = 'widget_preseed'` and `user_id = <dashboard request user>`
-- (defaulting to '00000000-0000-0000-0000-000000000000'). Runtime verification
-- against Panel M exposed two integration bugs:
--   1. `user_id` did not match any of the three partitions queried by
--      `app/api/chat/routing-memory/semantic-lookup/route.ts` (learned rows use
--      OPTION_A_USER_ID='local'; curated seeds use '__curated_seed__').
--   2. `scope_source='widget_preseed'` was not queried by any SQL branch;
--      PHASE5_SEED_LOOKUP_SQL and PHASE5_EXACT_HIT_SEED_SQL both filter on
--      `scope_source='curated_seed'`.
--
-- Option A resolution: collapse widget preseeds into the curated_seed
-- partition. Going forward, `lib/chat/routing-log/seed-writer.ts` writes with
-- `scope_source='curated_seed'` and `user_id='__curated_seed__'`. Widget-owned
-- rows remain distinguishable from global curated seeds by carrying
-- `slots_json.panelId`. Lifecycle cascades filter by `slots_json->>'panelId'`
-- so they scope correctly to the panel without touching global seeds.
--
-- This migration soft-deletes any remaining `scope_source='widget_preseed'`
-- rows. Panels whose preseeds get cleaned up here will have fresh
-- curated_seed-scoped rows written on the next lifecycle event (rename,
-- restore, or manual recreate). Forward-only — down is a no-op.

DO $$
DECLARE
  v_cleanup_count INT;
BEGIN
  WITH updated AS (
    UPDATE chat_routing_memory_index
       SET is_deleted = true, updated_at = NOW()
     WHERE scope_source = 'widget_preseed'
       AND is_deleted = false
    RETURNING id
  )
  SELECT COUNT(*) INTO v_cleanup_count FROM updated;

  RAISE NOTICE 'Fix 3 Part A Option A cleanup: soft-deleted % orphan widget_preseed rows', v_cleanup_count;
END $$;
