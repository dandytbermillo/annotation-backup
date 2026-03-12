-- ============================================================================
-- Stage 6 Enforcement Runtime Fixture — Dashboard State Setup
-- ============================================================================
--
-- Purpose: Create a controlled dashboard where exactly 1 panel matches
-- "links"-related queries, enabling S6 enforcement open_panel path.
--
-- Prerequisites:
--   .env.local must have:
--     NEXT_PUBLIC_STAGE6_ENFORCE_ENABLED=true
--     NEXT_PUBLIC_STAGE4_FORCE_ABSTAIN=true   (forces Stage 4 LLM → need_more_info)
--
-- Usage:
--   1. Run §1 SETUP to configure dashboard
--   2. Restart dev server (npm run dev) to pick up env changes
--   3. Clear chat, then try test queries from §3
--   4. Check durable log with §4 VERIFY queries
--   5. Run §5 ROLLBACK to restore original state
-- ============================================================================

-- §0 PRE-CHECK: current panel state
SELECT id, title, badge, panel_type, is_visible
FROM workspace_panels
WHERE deleted_at IS NULL
ORDER BY panel_type, badge;

-- ============================================================================
-- §1 SETUP: Hide all panels except a controlled set
-- ============================================================================

-- Step 1a: Hide ALL panels
UPDATE workspace_panels
SET is_visible = false, updated_at = NOW()
WHERE deleted_at IS NULL AND is_visible = true;

-- Step 1b: Show only the fixture set (4 panels)
-- Links Panel D = the single-match target
-- Recent, Continue, Quick Capture = non-links context panels
UPDATE workspace_panels
SET is_visible = true, updated_at = NOW()
WHERE deleted_at IS NULL
  AND (
    (panel_type IN ('links_note', 'links_note_tiptap') AND badge = 'D')
    OR panel_type = 'recent'
    OR panel_type = 'continue'
    OR panel_type = 'quick_capture'
  );

-- Step 1c: Verify fixture state (expect exactly 4 visible)
SELECT id, title, badge, panel_type, is_visible
FROM workspace_panels
WHERE deleted_at IS NULL AND is_visible = true
ORDER BY panel_type;

-- ============================================================================
-- §2 EXPECTED TIER FLOW for test queries
-- ============================================================================
--
-- Query: "take me to my links"
--   Tier 4: normalize → "links" → KNOWN_NOUN_MAP match → strict-exact FAILS
--           (raw "take me to my links" ≠ "Links Panel D")
--           → commandFormExact: canonicalize → "links" ≠ "Links Panel D" → FAILS
--           → matchVisiblePanelCommand: {take, links} vs {links, panel, d} → no full match
--           → defers to Tier 4.5
--   Tier 4.5: deterministic match fails
--             → builds grounding candidates (visible_panels)
--             → calls bounded LLM
--             → FORCE_ABSTAIN=true → returns need_more_info
--             → Stage 6 abstain path fires
--   Stage 6:  inspect_dashboard → sees Links Panel D (only links panel)
--             → single match → open_panel with panelSlug = widgetId
--             → action_executed!
--   Bridge:   TOCTOU revalidation → panel still visible → opens drawer
--   Result:   handledByTier: 6, tierLabel: 's6_enforced:open_panel'
--
-- Alternative queries (if first doesn't reach S6):
--   "show me my saved links"
--   "I need to check my bookmarks"
--   "where are my links"

-- ============================================================================
-- §3 TEST QUERIES (try in chat, in this order)
-- ============================================================================
--
-- 1. "take me to my links"
-- 2. "show me my saved links"
-- 3. "I need to check my bookmarks"
-- 4. "where are my links"
--
-- After each query, check §4 for durable log entries.

-- ============================================================================
-- §4 VERIFY: Check durable log for S6 enforcement rows
-- ============================================================================

-- 4a: All S6 rows (both shadow and enforcement)
SELECT
  interaction_id,
  routing_lane,
  decision_source,
  result_status,
  semantic_hint_metadata->>'s6_outcome' AS s6_outcome,
  semantic_hint_metadata->>'s6_action_type' AS s6_action_type,
  semantic_hint_metadata->>'s6_action_target_id' AS s6_target,
  semantic_hint_metadata->>'s6_escalation_reason' AS s6_escalation,
  created_at
FROM chat_routing_durable_log
WHERE interaction_id LIKE '%:s6'
ORDER BY created_at DESC
LIMIT 10;

-- 4b: Success criteria — look for this exact signature:
--   routing_lane = 'D'
--   decision_source = 'llm'
--   result_status = 'executed'
--   s6_outcome = 'action_executed'
--   s6_action_type = 'open_panel'
SELECT
  interaction_id,
  routing_lane,
  decision_source,
  result_status,
  semantic_hint_metadata->>'s6_outcome' AS s6_outcome,
  semantic_hint_metadata->>'s6_action_type' AS s6_action_type,
  semantic_hint_metadata->>'s6_action_target_id' AS s6_target
FROM chat_routing_durable_log
WHERE interaction_id LIKE '%:s6'
  AND routing_lane = 'D'
  AND decision_source = 'llm'
  AND result_status = 'executed'
ORDER BY created_at DESC
LIMIT 5;

-- ============================================================================
-- §5 ROLLBACK: Restore all panels to visible
-- ============================================================================

UPDATE workspace_panels
SET is_visible = true, updated_at = NOW()
WHERE deleted_at IS NULL AND is_visible = false;

-- Verify rollback
SELECT COUNT(*) AS visible_count
FROM workspace_panels
WHERE deleted_at IS NULL AND is_visible = true;

-- ============================================================================
-- §6 CLEANUP: Remove dev fixture flag from .env.local
-- ============================================================================
-- After successful validation, remove or set to false:
--   NEXT_PUBLIC_STAGE4_FORCE_ABSTAIN=false
-- Then restart dev server.
