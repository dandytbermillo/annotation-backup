-- ============================================================================
-- Stage 6: Eval Queries (Slice 6.6a)
--
-- Monitoring and evaluation SQL for the Stage 6 shadow loop.
-- All compute-on-read — no persisted agreement fields.
--
-- Prerequisites:
--   - chat_routing_durable_log table with semantic_hint_metadata JSONB
--   - S6 shadow rows identified by interaction_id ending in ':s6'
--   - Main routing rows identified by provenance containing 'need_more_info'
--     or 'stage4_timeout' (the Stage 4 paths that trigger the shadow loop)
--
-- Usage:
--   Run against annotation_dev (or production read-replica).
--   Adjust the time window (WHERE created_at > ...) as needed.
--
-- Design note: stage6-agent-tool-loop-design.md §7b
-- ============================================================================


-- ============================================================================
-- §1  Coverage / Row-Pair Join
--
-- Foundation query: join main routing rows with their :s6 shadow counterparts.
-- Coverage = matched pairs / eligible main rows.
-- Low coverage → shadow loops failing silently (network, timeout, flag off).
-- ============================================================================

-- §1a  Eligibility: main rows where Stage 4 abstained or timed out
--       (these SHOULD have a :s6 shadow pair)
--
-- Column sources:
--   provenance        → top-level column (NOT in semantic_hint_metadata)
--   result_status     → top-level column (NOT in semantic_hint_metadata)
--   llm_decision      → semantic_hint_metadata JSONB field
--   b2_status         → semantic_hint_metadata JSONB field

SELECT
  COUNT(*) AS eligible_main_rows,
  COUNT(CASE WHEN semantic_hint_metadata->>'llm_decision' = 'need_more_info' THEN 1 END) AS stage4_abstain,
  COUNT(CASE WHEN provenance ILIKE '%timeout%' THEN 1 END) AS stage4_timeout
FROM chat_routing_durable_log
WHERE log_phase = 'routing_attempt'
  AND (
    semantic_hint_metadata->>'llm_decision' = 'need_more_info'
    OR provenance ILIKE '%timeout%'
  )
  AND created_at > now() - interval '24 hours';


-- §1b  Coverage: how many eligible main rows have a matching :s6 row

WITH eligible AS (
  SELECT interaction_id, created_at
  FROM chat_routing_durable_log
  WHERE log_phase = 'routing_attempt'
    AND (
      semantic_hint_metadata->>'llm_decision' = 'need_more_info'
      OR provenance ILIKE '%timeout%'
    )
    AND created_at > now() - interval '24 hours'
),
shadow AS (
  SELECT REPLACE(interaction_id, ':s6', '') AS base_interaction_id
  FROM chat_routing_durable_log
  WHERE interaction_id LIKE '%:s6'
    AND created_at > now() - interval '24 hours'
)
SELECT
  COUNT(DISTINCT e.interaction_id) AS eligible,
  COUNT(DISTINCT s.base_interaction_id) AS matched_shadow,
  ROUND(
    COUNT(DISTINCT s.base_interaction_id)::numeric
    / NULLIF(COUNT(DISTINCT e.interaction_id), 0) * 100, 1
  ) AS coverage_pct
FROM eligible e
LEFT JOIN shadow s ON e.interaction_id = s.base_interaction_id;


-- §1c  Row-pair detail: main + shadow side-by-side

WITH main_rows AS (
  SELECT
    interaction_id,
    provenance AS main_provenance,
    semantic_hint_metadata->>'llm_decision' AS main_llm_decision,
    result_status AS main_result_status,
    semantic_hint_metadata->>'b2_status' AS main_b2_status,
    created_at AS main_created_at
  FROM chat_routing_durable_log
  WHERE log_phase = 'routing_attempt'
    AND (
      semantic_hint_metadata->>'llm_decision' = 'need_more_info'
      OR provenance ILIKE '%timeout%'
    )
    AND created_at > now() - interval '24 hours'
),
shadow_rows AS (
  SELECT
    REPLACE(interaction_id, ':s6', '') AS base_interaction_id,
    semantic_hint_metadata->>'s6_outcome' AS s6_outcome,
    semantic_hint_metadata->>'s6_action_type' AS s6_action_type,
    semantic_hint_metadata->>'s6_action_status' AS s6_action_status,
    semantic_hint_metadata->>'s6_action_rejection_reason' AS s6_rejection_reason,
    semantic_hint_metadata->>'s6_abort_reason' AS s6_abort_reason,
    (semantic_hint_metadata->>'s6_inspect_rounds')::int AS s6_inspect_rounds,
    (semantic_hint_metadata->>'s6_duration_ms')::int AS s6_duration_ms,
    semantic_hint_metadata->>'s6_tool_trace' AS s6_tool_trace,
    created_at AS s6_created_at
  FROM chat_routing_durable_log
  WHERE interaction_id LIKE '%:s6'
    AND created_at > now() - interval '24 hours'
)
SELECT
  m.interaction_id,
  m.main_provenance,
  m.main_llm_decision,
  m.main_result_status,
  s.s6_outcome,
  s.s6_action_type,
  s.s6_action_status,
  s.s6_rejection_reason,
  s.s6_abort_reason,
  s.s6_inspect_rounds,
  s.s6_duration_ms,
  s.s6_tool_trace,
  m.main_created_at,
  s.s6_created_at
FROM main_rows m
LEFT JOIN shadow_rows s ON m.interaction_id = s.base_interaction_id
ORDER BY m.main_created_at DESC;


-- ============================================================================
-- §2  Outcome Distribution
--
-- Terminal outcome of S6 shadow loops.
-- ============================================================================

SELECT
  semantic_hint_metadata->>'s6_outcome' AS s6_outcome,
  COUNT(*) AS cnt,
  ROUND(COUNT(*)::numeric / NULLIF(SUM(COUNT(*)) OVER (), 0) * 100, 1) AS pct
FROM chat_routing_durable_log
WHERE interaction_id LIKE '%:s6'
  AND created_at > now() - interval '24 hours'
GROUP BY 1
ORDER BY cnt DESC;


-- ============================================================================
-- §3  Inspect-Round Distribution
--
-- How many inspect tool calls before the loop terminates.
-- Higher rounds = model needs more info or is looping inefficiently.
-- ============================================================================

SELECT
  (semantic_hint_metadata->>'s6_inspect_rounds')::int AS inspect_rounds,
  COUNT(*) AS cnt,
  ROUND(COUNT(*)::numeric / NULLIF(SUM(COUNT(*)) OVER (), 0) * 100, 1) AS pct
FROM chat_routing_durable_log
WHERE interaction_id LIKE '%:s6'
  AND semantic_hint_metadata->>'s6_inspect_rounds' IS NOT NULL
  AND created_at > now() - interval '24 hours'
GROUP BY 1
ORDER BY 1;


-- ============================================================================
-- §4  Abort Reason Breakdown
--
-- Separate from outcome distribution. Abort reasons explain WHY the loop
-- gave up. Important distinctions:
--   - max_rounds_exhausted: budget exhaustion (not timeout)
--   - timeout: wall-clock limit hit
--   - model-chosen abort: model decided it cannot resolve
--   - parse failure: unparseable LLM response
-- ============================================================================

SELECT
  semantic_hint_metadata->>'s6_outcome' AS s6_outcome,
  semantic_hint_metadata->>'s6_abort_reason' AS s6_abort_reason,
  COUNT(*) AS cnt
FROM chat_routing_durable_log
WHERE interaction_id LIKE '%:s6'
  AND semantic_hint_metadata->>'s6_outcome' IN ('abort', 'max_rounds_exhausted')
  AND created_at > now() - interval '24 hours'
GROUP BY 1, 2
ORDER BY cnt DESC;


-- ============================================================================
-- §5  Action Rejection Reason Breakdown
--
-- When the model emits an action but validation rejects it.
-- High rejection rates suggest model hallucination or stale snapshots.
-- ============================================================================

SELECT
  semantic_hint_metadata->>'s6_action_type' AS action_type,
  semantic_hint_metadata->>'s6_action_rejection_reason' AS rejection_reason,
  COUNT(*) AS cnt
FROM chat_routing_durable_log
WHERE interaction_id LIKE '%:s6'
  AND semantic_hint_metadata->>'s6_outcome' = 'action_rejected'
  AND created_at > now() - interval '24 hours'
GROUP BY 1, 2
ORDER BY cnt DESC;


-- ============================================================================
-- §6  Latency (p50 / p95)
--
-- Wall-clock time from loop entry to terminal outcome.
-- Target: p50 < 1s, p95 < 3s (design note §6a).
-- ============================================================================

SELECT
  COUNT(*) AS total,
  ROUND(PERCENTILE_CONT(0.50) WITHIN GROUP (ORDER BY (semantic_hint_metadata->>'s6_duration_ms')::numeric)) AS p50_ms,
  ROUND(PERCENTILE_CONT(0.95) WITHIN GROUP (ORDER BY (semantic_hint_metadata->>'s6_duration_ms')::numeric)) AS p95_ms,
  ROUND(AVG((semantic_hint_metadata->>'s6_duration_ms')::numeric)) AS avg_ms,
  MIN((semantic_hint_metadata->>'s6_duration_ms')::int) AS min_ms,
  MAX((semantic_hint_metadata->>'s6_duration_ms')::int) AS max_ms
FROM chat_routing_durable_log
WHERE interaction_id LIKE '%:s6'
  AND semantic_hint_metadata->>'s6_duration_ms' IS NOT NULL
  AND created_at > now() - interval '24 hours';

-- Latency by outcome (action vs clarify vs abort have different profiles)

SELECT
  semantic_hint_metadata->>'s6_outcome' AS s6_outcome,
  COUNT(*) AS cnt,
  ROUND(PERCENTILE_CONT(0.50) WITHIN GROUP (ORDER BY (semantic_hint_metadata->>'s6_duration_ms')::numeric)) AS p50_ms,
  ROUND(PERCENTILE_CONT(0.95) WITHIN GROUP (ORDER BY (semantic_hint_metadata->>'s6_duration_ms')::numeric)) AS p95_ms
FROM chat_routing_durable_log
WHERE interaction_id LIKE '%:s6'
  AND semantic_hint_metadata->>'s6_duration_ms' IS NOT NULL
  AND created_at > now() - interval '24 hours'
GROUP BY 1
ORDER BY cnt DESC;


-- ============================================================================
-- §7  Disagreement Categories
--
-- The core eval signal: compare what main routing did vs what S6 would have done.
--
-- Primary signal: disagree_s6_would_act
--   Main routing showed a clarifier, but S6 found a target and would have acted.
--   These are the interactions where Stage 6 adds value.
--
-- Categorization:
--   Main outcome derived from: result_status (top-level), b2_status (JSONB)
--   Main eligibility from: llm_decision (JSONB), provenance (top-level)
--   S6 outcome derived from: s6_outcome (JSONB)
--
--   | Main outcome       | S6 outcome              | Category                  |
--   |--------------------|-------------------------|---------------------------|
--   | clarified          | action_executed         | disagree_s6_would_act     |
--   | clarified          | clarification_accepted  | agree_clarify             |
--   | clarified          | abort                   | disagree_s6_abort         |
--   | clarified          | action_rejected         | disagree_s6_bad_action    |
--   | clarified          | max_rounds_exhausted    | disagree_s6_exhausted     |
--   | failed/no options  | action_executed         | disagree_s6_would_act     |
--   | failed/no options  | clarification_accepted  | disagree_s6_would_clarify |
--   | failed/no options  | abort                   | agree_fail                |
--   | failed/no options  | action_rejected         | disagree_s6_bad_action    |
-- ============================================================================

WITH main_rows AS (
  SELECT
    interaction_id,
    CASE
      WHEN result_status = 'executed' THEN 'executed'
      WHEN semantic_hint_metadata->>'b2_status' = 'no_candidates' THEN 'failed_no_candidates'
      ELSE 'clarified'
    END AS main_outcome
  FROM chat_routing_durable_log
  WHERE log_phase = 'routing_attempt'
    AND (
      semantic_hint_metadata->>'llm_decision' = 'need_more_info'
      OR provenance ILIKE '%timeout%'
    )
    AND created_at > now() - interval '24 hours'
),
shadow_rows AS (
  SELECT
    REPLACE(interaction_id, ':s6', '') AS base_interaction_id,
    semantic_hint_metadata->>'s6_outcome' AS s6_outcome
  FROM chat_routing_durable_log
  WHERE interaction_id LIKE '%:s6'
    AND created_at > now() - interval '24 hours'
)
SELECT
  CASE
    -- S6 would have acted successfully
    WHEN s.s6_outcome = 'action_executed'
      THEN 'disagree_s6_would_act'
    -- Both agree clarification is needed
    WHEN m.main_outcome = 'clarified' AND s.s6_outcome = 'clarification_accepted'
      THEN 'agree_clarify'
    -- Main gave up but S6 at least found candidates to clarify
    WHEN m.main_outcome = 'failed_no_candidates' AND s.s6_outcome = 'clarification_accepted'
      THEN 'disagree_s6_would_clarify'
    -- Both gave up
    WHEN m.main_outcome = 'failed_no_candidates' AND s.s6_outcome = 'abort'
      THEN 'agree_fail'
    -- S6 gave up, main at least offered options
    WHEN m.main_outcome = 'clarified' AND s.s6_outcome = 'abort'
      THEN 'disagree_s6_abort'
    -- S6 tried to act but picked wrong target
    WHEN s.s6_outcome = 'action_rejected'
      THEN 'disagree_s6_bad_action'
    -- S6 exhausted its budget
    WHEN s.s6_outcome = 'max_rounds_exhausted'
      THEN 'disagree_s6_exhausted'
    -- No shadow row found
    WHEN s.s6_outcome IS NULL
      THEN 'no_shadow_row'
    ELSE 'uncategorized'
  END AS disagreement_category,
  COUNT(*) AS cnt,
  ROUND(COUNT(*)::numeric / NULLIF(SUM(COUNT(*)) OVER (), 0) * 100, 1) AS pct
FROM main_rows m
LEFT JOIN shadow_rows s ON m.interaction_id = s.base_interaction_id
GROUP BY 1
ORDER BY cnt DESC;
