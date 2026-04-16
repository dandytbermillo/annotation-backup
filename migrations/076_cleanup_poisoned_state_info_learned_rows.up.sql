-- Phase 1.6 Fix 1c: one-time cleanup of poisoned state-info learned rows.
--
-- Background:
-- Before Phase 1.6 Fix 1 (write-side poison guard at routing-dispatcher.ts:1432)
-- and Fix 1b (retrieval-side veto), state-info questions like `is links panel h open?`
-- could be auto-executed as open_panel actions via various code paths (LLM
-- visible-panel fallback, seed coverage gap, or other regressions). When that
-- happened, a pending Phase 5 write payload carried intent_id='open_panel' with
-- raw_query_text='is links panel h open?'; recordMemoryEntry promoted it, and
-- the poisoned learned row landed in chat_routing_memory_index. On subsequent
-- turns, semantic retrieval returned the learned row ahead of curated state_info
-- seeds and reinforced the wrong answer.
--
-- Fix 1 + Fix 1b prevent FUTURE poisoning and neutralize it at retrieval time,
-- but existing poisoned rows in the DB still waste pool slots, confuse telemetry,
-- and risk re-emergence if the retrieval filter is ever removed.
--
-- This migration soft-deletes all scope_source='routing_dispatcher' rows whose
-- normalized_query_text matches the STATE_INFO_QUESTION_SHAPE regex AND whose
-- slots_json.action_type is 'open_panel'. The regex mirrors state-info-resolvers.ts:459.
--
-- Soft-delete (is_deleted = true) preserves audit history; hard-delete is not
-- performed here. Run is forward-only — the .down.sql is a no-op.

DO $$
DECLARE
  v_cleanup_count INT;
BEGIN
  WITH updated AS (
    UPDATE chat_routing_memory_index
       SET is_deleted = true,
           updated_at = NOW()
     WHERE scope_source = 'routing_dispatcher'
       AND is_deleted = false
       AND (slots_json->>'action_type') = 'open_panel'
       AND normalized_query_text ~* '^(is|are|which|what)\s+.+\s+(open|opened|visible)\s*\??\s*$'
    RETURNING id
  )
  SELECT COUNT(*) INTO v_cleanup_count FROM updated;

  RAISE NOTICE 'Fix 1c cleanup: soft-deleted % poisoned state-info open_panel rows', v_cleanup_count;
END $$;
