-- Routing Soak Monitor — Phase 2 Exact-Memory Assist
-- 12 result sets across 10 numbered sections (2b, 9a, 9b are sub-sections)
--
-- Usage:
--   psql -U postgres -d annotation_dev -f docs/proposal/chat-navigation/test_scripts/monitor-routing-soak.sql
--   Or: paste individual sections into pgAdmin query tool
--
-- Metric unit: per routing decision (one row in chat_routing_durable_log = one routing decision,
--   deduplicated by interaction_id).
--
-- Latency note: This script reports only DB-persisted timing (timestamp gaps, created_at ordering).
--   App-level p95 latency (dispatch-to-execution round-trip) is not captured in the current schema
--   and must come from app telemetry or browser devtools if needed.
--
-- Recommended monitoring cadence:
--   Day 1-3: run 2-3x daily, focus on Sections 1, 2, 9b (hit rate, drift)
--   Day 4-7: run daily, focus on Sections 1, 3, 8 (health, lane distribution, reuse histogram)
--   After 7 days: run weekly or on-demand
--
-- Go/no-go thresholds for Phase 3 gate decision (all must pass):
--
--   Gate                  | Section | Pass              | Fail                | Extend Soak
--   ----------------------+---------+-------------------+---------------------+--------------------
--   Memory effectiveness  | 2b      | Hit rate >= 50%   | < 20% after 3 days  | 20-50%
--   Commit rejection      | 5       | Reject rate < 5%  | > 20%               | 5-20%
--   Active drift          | 9b      | Zero ACTIVE DRIFT | Any ACTIVE DRIFT    | n/a (always fail)
--   Overall health        | 1       | Not DEGRADED 2+d  | DEGRADED 3+d        | 1 day DEGRADED
--   Reuse growth          | 8       | Any entry >= 3    | All at 1 after 3d   | Some 2s, no 3+
--
--   Decision: all 5 pass -> Phase 3. Any fail -> block. Any extend -> +2 days.

-- ============================================
-- THRESHOLD CONSTANTS (tunable)
-- ============================================
-- Centralized thresholds referenced by all sections below.
-- Adjust these values to calibrate sensitivity for your usage patterns.
DROP TABLE IF EXISTS pg_temp.soak_thresholds;
CREATE TEMP TABLE soak_thresholds AS SELECT
  20    AS min_decisions,         -- minimum routing decisions before judging health
  10    AS min_eligible,          -- minimum eligible decisions for 2b hit rate
  5     AS min_memory_attempts,   -- minimum memory_exact attempts for revalidation analysis
  30    AS min_lane_decisions,    -- minimum decisions for lane distribution flags
  10.0  AS degraded_failure_pct,  -- failure rate threshold for DEGRADED
  20.0  AS healthy_hit_pct,       -- memory hit rate threshold for HEALTHY
  10.0  AS warming_hit_pct,       -- memory hit rate threshold for WARMING UP
  5.0   AS healthy_reval_pct,     -- commit revalidation rejection threshold for HEALTHY
  20.0  AS high_staleness_pct,    -- commit revalidation rejection threshold for HIGH STALENESS
  5.0   AS healthy_max_failure_pct, -- max failure rate for HEALTHY status
  5.0   AS memory_underperforming_pct, -- B1 lane % below which memory is underperforming
  80.0  AS llm_heavy_pct;         -- D lane % above which LLM is too dominant

-- ============================================
-- 1. ROUTING HEALTH DASHBOARD
-- ============================================
-- Single-glance summary over last 24 hours
SELECT
    COUNT(*) as total_decisions,
    COUNT(*) FILTER (WHERE decision_source = 'memory_exact') as memory_exact,
    COUNT(*) FILTER (WHERE decision_source = 'deterministic') as deterministic,
    COUNT(*) FILTER (WHERE decision_source = 'llm') as llm,
    COUNT(*) FILTER (WHERE decision_source = 'clarifier') as clarifier,
    ROUND(100.0 * COUNT(*) FILTER (WHERE decision_source = 'memory_exact') / NULLIF(COUNT(*), 0), 1) as memory_hit_pct,
    ROUND(100.0 * COUNT(*) FILTER (WHERE result_status = 'failed') / NULLIF(COUNT(*), 0), 1) as failure_pct,
    ROUND(100.0 * COUNT(*) FILTER (WHERE commit_revalidation_result = 'rejected')
      / NULLIF(COUNT(*) FILTER (WHERE decision_source = 'memory_exact'), 0), 1) as reval_reject_pct,
    CASE
        WHEN COUNT(*) < (SELECT min_decisions FROM soak_thresholds)
            THEN '-- INSUFFICIENT DATA (< ' || (SELECT min_decisions FROM soak_thresholds) || ' decisions)'
        WHEN 100.0 * COUNT(*) FILTER (WHERE result_status = 'failed') / NULLIF(COUNT(*), 0) >= (SELECT degraded_failure_pct FROM soak_thresholds)
            THEN '❌ DEGRADED (failure >= ' || (SELECT degraded_failure_pct FROM soak_thresholds) || '%)'
        WHEN 100.0 * COUNT(*) FILTER (WHERE decision_source = 'memory_exact') / NULLIF(COUNT(*), 0) >= (SELECT healthy_hit_pct FROM soak_thresholds)
         AND 100.0 * COUNT(*) FILTER (WHERE result_status = 'failed') / NULLIF(COUNT(*), 0) < (SELECT healthy_max_failure_pct FROM soak_thresholds)
            THEN '✅ HEALTHY'
        WHEN 100.0 * COUNT(*) FILTER (WHERE decision_source = 'memory_exact') / NULLIF(COUNT(*), 0) >= (SELECT warming_hit_pct FROM soak_thresholds)
            THEN '⚠️  WARMING UP'
        ELSE '❌ LOW HIT RATE'
    END as health_status
FROM chat_routing_durable_log
WHERE tenant_id = 'default' AND user_id = 'local'
  AND created_at > now() - INTERVAL '24 hours';

-- ============================================
-- 2. MEMORY HIT RATE — TIME SERIES
-- ============================================
-- Hourly buckets showing memory absorption over time
WITH hourly AS (
    SELECT
        DATE_TRUNC('hour', created_at) as hour,
        COUNT(*) as total,
        COUNT(*) FILTER (WHERE decision_source = 'memory_exact') as memory_hits
    FROM chat_routing_durable_log
    WHERE tenant_id = 'default' AND user_id = 'local'
      AND created_at > now() - INTERVAL '7 days'
    GROUP BY DATE_TRUNC('hour', created_at)
)
SELECT
    TO_CHAR(hour, 'YYYY-MM-DD HH24:MI') as hour,
    total,
    memory_hits,
    CASE WHEN total >= 3
        THEN ROUND(100.0 * memory_hits / total, 1)
        ELSE NULL
    END as hit_pct,
    CASE WHEN total >= 3
        THEN REPEAT('█', LEAST((100 * memory_hits / total)::int / 2, 50))
        ELSE '(< 3 decisions)'
    END as bar
FROM hourly
ORDER BY hour DESC
LIMIT 168;

-- ============================================
-- 2b. MEMORY HIT RATE — ELIGIBLE SUBSET
-- ============================================
-- Hit rate measured against repeat commands that had a matching memory key
-- at the time of the routing decision (time-aware, full lookup key match)
WITH eligible AS (
    SELECT
        d.id,
        d.decision_source,
        d.result_status,
        CASE WHEN m.id IS NOT NULL THEN true ELSE false END as had_memory_key
    FROM chat_routing_durable_log d
    LEFT JOIN chat_routing_memory_index m
        ON  m.tenant_id = d.tenant_id
        AND m.user_id = d.user_id
        AND m.query_fingerprint = d.query_fingerprint
        AND m.context_fingerprint = d.context_fingerprint
        AND m.schema_version = 'v1'
        AND m.tool_version = 'v2'
        AND m.is_deleted = false
        AND (m.ttl_expires_at IS NULL OR m.ttl_expires_at > d.created_at)
        AND m.created_at < d.created_at
    WHERE d.tenant_id = 'default' AND d.user_id = 'local'
      AND d.created_at > now() - INTERVAL '24 hours'
      AND d.result_status IN ('executed', 'failed')
      AND d.decision_source IN ('memory_exact', 'llm')
),
counts AS (
    SELECT
        COUNT(*) FILTER (WHERE had_memory_key) as eligible_total,
        COUNT(*) FILTER (WHERE had_memory_key AND decision_source = 'memory_exact' AND result_status = 'executed') as effective_hits,
        COUNT(*) FILTER (WHERE had_memory_key AND decision_source = 'memory_exact' AND result_status = 'failed') as commit_rejected
    FROM eligible
)
SELECT
    eligible_total,
    effective_hits,
    commit_rejected,
    CASE WHEN eligible_total >= (SELECT min_eligible FROM soak_thresholds)
        THEN ROUND(100.0 * effective_hits / NULLIF(eligible_total, 0), 1)
        ELSE NULL
    END as effective_hit_pct,
    CASE WHEN eligible_total >= (SELECT min_eligible FROM soak_thresholds)
        THEN ROUND(100.0 * commit_rejected / NULLIF(eligible_total, 0), 1)
        ELSE NULL
    END as commit_reject_pct,
    CASE WHEN eligible_total < (SELECT min_eligible FROM soak_thresholds)
        THEN '-- INSUFFICIENT ELIGIBLE DECISIONS (< ' || (SELECT min_eligible FROM soak_thresholds) || ')'
        ELSE 'Effective: ' || ROUND(100.0 * effective_hits / NULLIF(eligible_total, 0), 1) || '% | Rejected: ' || ROUND(100.0 * commit_rejected / NULLIF(eligible_total, 0), 1) || '%'
    END as summary
FROM counts;

-- ============================================
-- 3. LANE DISTRIBUTION
-- ============================================
-- Routing lane breakdown for last 24 hours
WITH lane_counts AS (
    SELECT
        routing_lane,
        COUNT(*) as cnt,
        SUM(COUNT(*)) OVER () as total
    FROM chat_routing_durable_log
    WHERE tenant_id = 'default' AND user_id = 'local'
      AND created_at > now() - INTERVAL '24 hours'
    GROUP BY routing_lane
)
SELECT
    routing_lane,
    cnt,
    ROUND(100.0 * cnt / NULLIF(total, 0), 1) as pct,
    REPEAT('█', LEAST((100 * cnt / NULLIF(total, 1))::int / 2, 50)) as bar,
    CASE
        WHEN total < (SELECT min_lane_decisions FROM soak_thresholds) THEN ''
        WHEN routing_lane = 'B1' AND 100.0 * cnt / total < (SELECT memory_underperforming_pct FROM soak_thresholds) THEN '⚠️  MEMORY UNDERPERFORMING'
        WHEN routing_lane = 'D' AND 100.0 * cnt / total > (SELECT llm_heavy_pct FROM soak_thresholds) THEN '⚠️  LLM HEAVY'
        ELSE ''
    END as flag
FROM lane_counts
ORDER BY CASE routing_lane
    WHEN 'A' THEN 1 WHEN 'B1' THEN 2 WHEN 'B2' THEN 3
    WHEN 'C' THEN 4 WHEN 'D' THEN 5 WHEN 'E' THEN 6
END;

-- ============================================
-- 4. RESULT STATUS BREAKDOWN
-- ============================================
-- Execution outcomes for last 24 hours
WITH status_counts AS (
    SELECT
        result_status,
        COUNT(*) as cnt,
        SUM(COUNT(*)) OVER () as total
    FROM chat_routing_durable_log
    WHERE tenant_id = 'default' AND user_id = 'local'
      AND created_at > now() - INTERVAL '24 hours'
    GROUP BY result_status
)
SELECT
    result_status,
    cnt,
    ROUND(100.0 * cnt / NULLIF(total, 0), 1) as pct,
    REPEAT('█', LEAST((100 * cnt / NULLIF(total, 1))::int / 2, 50)) as bar,
    CASE
        WHEN total < (SELECT min_decisions FROM soak_thresholds) THEN ''
        WHEN result_status = 'failed' AND 100.0 * cnt / total > (SELECT healthy_max_failure_pct FROM soak_thresholds) THEN '❌ HIGH FAILURE RATE'
        ELSE ''
    END as flag
FROM status_counts
ORDER BY CASE result_status
    WHEN 'executed' THEN 1 WHEN 'clarified' THEN 2
    WHEN 'blocked' THEN 3 WHEN 'failed' THEN 4
END;

-- ============================================
-- 5. COMMIT REVALIDATION ANALYSIS
-- ============================================
-- TOCTOU safety check outcomes for memory-served decisions
WITH memory_decisions AS (
    SELECT
        commit_revalidation_result,
        commit_revalidation_reason_code,
        COUNT(*) as cnt,
        SUM(COUNT(*)) OVER () as total
    FROM chat_routing_durable_log
    WHERE tenant_id = 'default' AND user_id = 'local'
      AND decision_source = 'memory_exact'
    GROUP BY commit_revalidation_result, commit_revalidation_reason_code
)
SELECT
    COALESCE(commit_revalidation_result, 'n/a') as reval_result,
    COALESCE(commit_revalidation_reason_code, 'n/a') as reason_code,
    cnt,
    ROUND(100.0 * cnt / NULLIF(total, 0), 1) as pct,
    CASE
        WHEN total < (SELECT min_memory_attempts FROM soak_thresholds)
            THEN '-- INSUFFICIENT MEMORY ATTEMPTS (< ' || (SELECT min_memory_attempts FROM soak_thresholds) || ')'
        WHEN commit_revalidation_result = 'rejected'
         AND 100.0 * cnt / total > (SELECT high_staleness_pct FROM soak_thresholds)
            THEN '❌ HIGH STALENESS'
        WHEN commit_revalidation_result = 'rejected'
         AND 100.0 * cnt / total > (SELECT healthy_reval_pct FROM soak_thresholds)
            THEN '⚠️  MODERATE'
        WHEN commit_revalidation_result = 'rejected'
            THEN '✅ HEALTHY (low rejection)'
        ELSE ''
    END as flag
FROM memory_decisions
ORDER BY cnt DESC;

-- ============================================
-- 6. MEMORY INDEX HEALTH
-- ============================================
-- Overview of chat_routing_memory_index (v2 = current version)
SELECT
    COUNT(*) FILTER (WHERE is_deleted = false AND tool_version = 'v2') as active_v2,
    COUNT(*) FILTER (WHERE is_deleted = true) as soft_deleted,
    COUNT(*) FILTER (WHERE is_deleted = false AND tool_version = 'v2'
        AND ttl_expires_at IS NOT NULL AND ttl_expires_at < now()) as expired_not_deleted,
    COUNT(*) FILTER (WHERE is_deleted = false AND tool_version = 'v2'
        AND ttl_expires_at IS NOT NULL AND ttl_expires_at BETWEEN now() AND now() + INTERVAL '7 days') as expiring_7d,
    ROUND(AVG(success_count) FILTER (WHERE is_deleted = false AND tool_version = 'v2'), 1) as avg_success_count,
    PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY success_count)
        FILTER (WHERE is_deleted = false AND tool_version = 'v2') as median_success_count,
    MAX(success_count) FILTER (WHERE is_deleted = false AND tool_version = 'v2') as max_success_count,
    COUNT(*) FILTER (WHERE is_deleted = false AND tool_version = 'v2' AND intent_class = 'action_intent') as action_intents,
    COUNT(*) FILTER (WHERE is_deleted = false AND tool_version = 'v2' AND intent_class = 'info_intent') as info_intents,
    CASE
        WHEN COUNT(*) FILTER (WHERE is_deleted = false AND tool_version = 'v2'
            AND ttl_expires_at IS NOT NULL AND ttl_expires_at < now()) > 10
            THEN '⚠️  CLEANUP NEEDED (' || COUNT(*) FILTER (WHERE is_deleted = false AND tool_version = 'v2'
                AND ttl_expires_at IS NOT NULL AND ttl_expires_at < now()) || ' expired rows)'
        ELSE '✅ OK'
    END as ttl_status
FROM chat_routing_memory_index
WHERE tenant_id = 'default' AND user_id = 'local';

-- ============================================
-- 7. TOP REUSED MEMORY ENTRIES
-- ============================================
-- Highest success_count entries (v2 only, active)
SELECT
    LEFT(normalized_query_text, 40) as query_preview,
    intent_id,
    success_count,
    risk_tier,
    TO_CHAR(last_success_at, 'YYYY-MM-DD HH24:MI') as last_success,
    TO_CHAR(created_at, 'YYYY-MM-DD HH24:MI') as created,
    ROUND(EXTRACT(EPOCH FROM (now() - created_at)) / 86400.0, 1) as days_old,
    ROUND(success_count::numeric / GREATEST(EXTRACT(EPOCH FROM (now() - created_at)) / 86400.0, 0.1), 1) as hits_per_day
FROM chat_routing_memory_index
WHERE tenant_id = 'default' AND user_id = 'local'
  AND tool_version = 'v2'
  AND is_deleted = false
ORDER BY success_count DESC
LIMIT 15;

-- ============================================
-- 8. SUCCESS_COUNT HISTOGRAM
-- ============================================
-- Distribution of memory reuse (v2 only, active)
WITH buckets AS (
    SELECT
        CASE
            WHEN success_count = 1 THEN '1 (single use)'
            WHEN success_count BETWEEN 2 AND 3 THEN '2-3'
            WHEN success_count BETWEEN 4 AND 10 THEN '4-10'
            WHEN success_count BETWEEN 11 AND 50 THEN '11-50'
            ELSE '51+'
        END as bucket,
        CASE
            WHEN success_count = 1 THEN 1
            WHEN success_count BETWEEN 2 AND 3 THEN 2
            WHEN success_count BETWEEN 4 AND 10 THEN 3
            WHEN success_count BETWEEN 11 AND 50 THEN 4
            ELSE 5
        END as sort_order,
        COUNT(*) as cnt
    FROM chat_routing_memory_index
    WHERE tenant_id = 'default' AND user_id = 'local'
      AND tool_version = 'v2'
      AND is_deleted = false
    GROUP BY 1, 2
),
total AS (SELECT SUM(cnt) as total FROM buckets)
SELECT
    b.bucket,
    b.cnt,
    ROUND(100.0 * b.cnt / NULLIF(t.total, 0), 1) as pct,
    REPEAT('█', LEAST((100 * b.cnt / NULLIF(t.total, 1))::int / 2, 50)) as bar
FROM buckets b, total t
ORDER BY b.sort_order;

-- ============================================
-- 9a. FINGERPRINT DRIFT AUDIT (all versions)
-- ============================================
-- Historical audit: flags pre-fix v1 drift vs unexpected v2 drift
WITH drift AS (
    SELECT
        normalized_query_text,
        tool_version,
        COUNT(DISTINCT context_fingerprint) as fingerprint_count,
        SUM(success_count) as total_hits,
        MAX(success_count) as max_single_hit
    FROM chat_routing_memory_index
    WHERE tenant_id = 'default' AND user_id = 'local'
      AND is_deleted = false
    GROUP BY normalized_query_text, tool_version
    HAVING COUNT(DISTINCT context_fingerprint) >= 2
)
SELECT
    LEFT(normalized_query_text, 40) as query_preview,
    tool_version,
    fingerprint_count,
    total_hits,
    max_single_hit,
    CASE
        WHEN tool_version = 'v1' THEN '📋 KNOWN (pre-fix drift)'
        WHEN tool_version = 'v2' AND fingerprint_count >= 3 AND max_single_hit = 1
            THEN '❌ DRIFT DETECTED (v2 — investigate)'
        WHEN tool_version = 'v2'
            THEN '⚠️  MULTIPLE CONTEXTS (v2 — may be legitimate)'
        ELSE ''
    END as status
FROM drift
ORDER BY tool_version DESC, fingerprint_count DESC
LIMIT 20;

-- ============================================
-- 9b. FINGERPRINT DRIFT — CURRENT VERSION (v2)
-- ============================================
-- Active drift check: only v2 entries, flags volatile field leaks
WITH v2_drift AS (
    SELECT
        normalized_query_text,
        COUNT(DISTINCT context_fingerprint) as fingerprint_count,
        SUM(success_count) as total_hits,
        MAX(success_count) as max_single_hit,
        COUNT(*) as row_count
    FROM chat_routing_memory_index
    WHERE tenant_id = 'default' AND user_id = 'local'
      AND tool_version = 'v2'
      AND is_deleted = false
    GROUP BY normalized_query_text
)
SELECT
    LEFT(normalized_query_text, 40) as query_preview,
    fingerprint_count,
    row_count,
    total_hits,
    max_single_hit,
    CASE
        WHEN fingerprint_count = 1 THEN '✅ STABLE'
        WHEN fingerprint_count >= 3 AND max_single_hit = 1
            THEN '❌ ACTIVE DRIFT (volatile field leak?)'
        WHEN fingerprint_count >= 2 AND max_single_hit > 1
            THEN '✅ LEGITIMATE (context genuinely changed, reuse happening)'
        ELSE '⚠️  MONITOR (2 fingerprints, low reuse)'
    END as status
FROM v2_drift
ORDER BY fingerprint_count DESC, total_hits DESC
LIMIT 20;

-- ============================================
-- 10. RECENT ACTIVITY TAIL
-- ============================================
-- Last 20 routing decisions for live debugging
SELECT
    TO_CHAR(created_at, 'YYYY-MM-DD HH24:MI:SS') as time,
    routing_lane,
    decision_source,
    result_status,
    risk_tier,
    LEFT(raw_query_text, 40) as query_preview,
    COALESCE(commit_revalidation_result, '') as reval
FROM chat_routing_durable_log
WHERE tenant_id = 'default' AND user_id = 'local'
ORDER BY created_at DESC
LIMIT 20;

-- Cleanup
DROP TABLE IF EXISTS pg_temp.soak_thresholds;
