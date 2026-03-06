# B2 Attempt Telemetry + Lookup Status Fix

**Date**: 2026-03-05
**Phase**: Phase 3 — Semantic Memory (Lane B2)
**Scope**: B2 observability gap closure + embedding failure disambiguation

---

## Summary

This session implemented two related changes:

1. **B2 Attempt Telemetry**: Added structured telemetry to `semantic_hint_metadata` so every B2 outcome is observable in the durable log — previously `semantic_hint_metadata` was always NULL.
2. **Lookup Status Fix**: Added `lookup_status` to the semantic lookup API response to distinguish genuine "no candidates" from "embedding computation failed" — previously both returned `{ candidates: [] }` and were indistinguishable.

---

## Problem Statement

### Telemetry Gap

B2 semantic lookup was confirmed working server-side (embedding computation, vector search, candidate ranking verified via direct API test), but `semantic_hint_metadata` was always NULL in `chat_routing_durable_log`. Root causes:

1. Queries matching B2 also match Tier 4/5 → `result.handled=true` → candidates discarded at `routing-dispatcher.ts:1278`
2. Telemetry only fired when `_semanticCandidates` existed on the result (`chat-navigation-panel.tsx:2178`), which required `!result.handled`
3. No observability for B2 attempts that returned null, timed out, found zero candidates, or got discarded

### Ambiguous Empty Response

`lookupSemanticMemory()` returned `null` for both "empty candidates" (API returned `{ candidates: [] }`) and "timeout/error". The server-side semantic lookup route also returned `{ candidates: [] }` for both "embedding failed" and "no matching entries above 0.92 threshold". This made `no_candidates` vs `timeout_or_error` indistinguishable.

---

## Changes

### 1. Structured Semantic Lookup Result

**File**: `lib/chat/routing-log/memory-semantic-reader.ts`

Changed return type from `SemanticCandidate[] | null` to structured `SemanticLookupResult`:

```typescript
export interface SemanticLookupResult {
  status: 'ok' | 'empty' | 'timeout' | 'error' | 'disabled'
  candidates: SemanticCandidate[]
  latencyMs: number
}
```

Each outcome now maps to a distinct status:
- Flag disabled → `disabled`
- API returns candidates → `ok`
- API returns empty (genuine) → `empty`
- Client timeout (Promise.race) → `timeout`
- Fetch error / server-reported failure → `error`

Uses a `TIMEOUT_SENTINEL` symbol to distinguish timeout from fetch success in Promise.race.

### 2. B2 Telemetry Fields in Payload

**File**: `lib/chat/routing-log/payload.ts`

Added fields to `RoutingLogPayload`:

```typescript
b2_status?: 'skipped' | 'no_candidates' | 'timeout_or_error' | 'candidates_found' | 'discarded_handled'
b2_raw_count?: number        // candidates from API (before Gate 3 validation)
b2_validated_count?: number   // candidates after Gate 3 validation
b2_latency_ms?: number        // B2 lookup wall-clock time
```

Status values are mutually exclusive (one per turn):
- `skipped` — semantic read flag off while memory read enabled
- `no_candidates` — embedding succeeded, SQL returned 0 rows above 0.92
- `timeout_or_error` — embedding failed, client timeout, or server error
- `candidates_found` — raw candidates returned (use `b2_validated_count` for usable count)
- `discarded_handled` — validated candidates existed but tier chain handled first

### 3. Dispatcher B2 Telemetry Capture

**File**: `lib/chat/routing-dispatcher.ts`

- Added `b2Telemetry` holder before B2 block
- Sets `skipped` explicitly when `memoryReadEnabled && !semanticReadEnabled` (outside B2 block)
- When `memoryReadEnabled=false`, no `b2_status` emitted (B2 not eligible)
- Single-finalize pattern: status set once in B2 block, single override at log-write time (`candidates_found` → `discarded_handled` when `validatedCount > 0 && result.handled`)
- Enriches `logPayload` with B2 fields before `recordRoutingLog`

### 4. Route Handler Serialization

**File**: `app/api/chat/routing-log/route.ts`

Extended `semanticHintMeta` JSON builder:

```typescript
const semanticHintMeta = (payload.semantic_hint_count != null || payload.b2_status != null)
  ? JSON.stringify({
      count: payload.semantic_hint_count,
      top_score: payload.semantic_top_score,
      hint_used: payload.semantic_hint_used,
      b2_status: payload.b2_status,
      b2_raw_count: payload.b2_raw_count,
      b2_validated_count: payload.b2_validated_count,
      b2_latency_ms: payload.b2_latency_ms,
    })
  : null
```

No migration needed — `semantic_hint_metadata` is `JSONB NULL` (schema-less).

### 5. Lookup Status Fix (Embedding Failure Disambiguation)

**File**: `app/api/chat/routing-memory/semantic-lookup/route.ts`

Added `lookup_status` field to API response:
- `'disabled'` — kill switch or server flag off
- `'embedding_failure'` — `computeEmbedding()` returned null
- `'empty_results'` — embedding succeeded, SQL returned 0 rows
- `'ok'` — embedding succeeded, SQL returned candidates
- `'server_error'` — catch block (DB error, etc.)

**File**: `lib/chat/routing-log/memory-semantic-reader.ts`

Client reader now parses `lookup_status` from server response:
- `embedding_failure` or `server_error` → `status: 'error'` (maps to `b2_status: 'timeout_or_error'`)
- Otherwise falls back to candidate-length inference

---

## Files Modified

| File | Change |
|------|--------|
| `lib/chat/routing-log/memory-semantic-reader.ts` | Structured `SemanticLookupResult` return type + `lookup_status` parsing |
| `lib/chat/routing-log/payload.ts` | Added `b2_status`, `b2_raw_count`, `b2_validated_count`, `b2_latency_ms` |
| `lib/chat/routing-dispatcher.ts` | Consume structured result, B2 telemetry capture, single-finalize pattern |
| `app/api/chat/routing-log/route.ts` | Extended `semanticHintMeta` JSON builder |
| `app/api/chat/routing-memory/semantic-lookup/route.ts` | Added `lookup_status` to response |

## Files Created

| File | Description |
|------|-------------|
| `__tests__/unit/routing-log/b2-attach-path.test.ts` | 5 unit test cases for B2 attach path |

## Files Updated

| File | Description |
|------|-------------|
| `__tests__/unit/routing-log/memory-semantic-reader.test.ts` | Updated for structured result + 800ms timeout |

---

## Test Results

### Type-Check
```
npm run type-check → clean (only pre-existing use-panel-close-handler.test.tsx:87 syntax error)
```

### Unit Tests
```
17 suites, 195 tests — all passing

Key suites:
- b2-attach-path.test.ts: 5/5 passed
  - Test 1: candidates_found when tier chain unhandled
  - Test 2: discarded_handled when tier chain handles
  - Test 3: timeout_or_error on B2 timeout
  - Test 4: no_candidates on B2 empty result
  - Test 5: skipped when semantic flag off (lookupSemanticMemory not called)

- memory-semantic-reader.test.ts: 7/7 passed
  - disabled, ok, empty, error (fetch), error (HTTP), timeout (800ms), constant check

- semantic-lookup-route.test.ts: 7/7 passed
```

---

## Soak Validation

### Initial Soak (Before Lookup Status Fix)

First restart produced rows with `semantic_hint_metadata` — confirmed non-null for the first time:

```
b2_status: timeout_or_error, b2_latency_ms: 801  (2 rows, "open the links panel b")
```

Second soak run showed 12 `no_candidates` rows with latency ~616-643ms. This pattern aligned suspiciously with `EMBEDDING_TIMEOUT_MS = 600`, suggesting embedding failures were being misreported as `no_candidates`.

### Post Lookup Status Fix Soak

After deploying the `lookup_status` fix, the telemetry became truthful:

```
b2_status       | count | avg_ms | min_ms | max_ms
----------------|-------|--------|--------|-------
no_candidates   |    16 |    568 |    390 |    643
timeout_or_error|    11 |    705 |    618 |    802
```

Per-query breakdown from the final soak run (2026-03-05 05:12-05:14 UTC):

| Query | b2_status | b2_ms | Analysis |
|-------|-----------|-------|----------|
| open the links panel b (1st) | timeout_or_error | 802 | Client timeout (cold-start) |
| open the links panel b (2nd) | no_candidates | 390 | Embedding succeeded, no similar entries |
| open budget100 please | timeout_or_error | 619 | Embedding timeout (600ms server ceiling) |
| navigate to budget100 | timeout_or_error | 635 | Embedding timeout |
| show me budget100 | timeout_or_error | 618 | Embedding timeout |
| what panels are open | no_candidates | 400 | Embedding succeeded, no action_intent matches |

The ~620ms latencies correlate with `EMBEDDING_TIMEOUT_MS = 600` (server-side embedding abort) + HTTP overhead. The ~390-400ms latencies are genuine `no_candidates` where embedding succeeded and SQL returned zero rows above the 0.92 cosine threshold.

---

## Remaining Status Coverage

| b2_status | Observed in Soak | Notes |
|-----------|-----------------|-------|
| `no_candidates` | Yes | Embedding succeeded, no similar entries above 0.92 |
| `timeout_or_error` | Yes | Embedding timeout at server ceiling |
| `discarded_handled` | Yes | "could you open budget100" (score 0.933), "can you show budget100" (score 0.924) |
| `candidates_found` | Unit test only | Requires tier chain unhandled + B2 candidates (rare in practice) |
| `skipped` | Unit test only | Requires `semanticReadEnabled=false` with `memoryReadEnabled=true` |

---

## Timeout Tuning

### Problem
Initial values (`EMBEDDING_TIMEOUT_MS=600`, `MEMORY_SEMANTIC_READ_TIMEOUT_MS=800`) caused near-100% embedding timeouts in the current network environment. All B2 turns showed `timeout_or_error` or were misreported as `no_candidates` (before the `lookup_status` fix).

### Proof-Mode Soak (temporary 1500/2500)
Raised timeouts temporarily to prove B2 candidate path works end-to-end:
- **"could you open budget100"**: `discarded_handled`, raw=1, valid=1, top_score=0.933, latency=1131ms
- Confirmed B2 pipeline is functional when embedding completes

### 10-Turn Baseline Soak (1200/2000) — Accepted Phase 3a Baseline

Ran 10 B2-eligible turns (deduped by `interaction_id`), all with novel phrasings that miss B1. This is the **accepted Phase 3a baseline** for future comparisons.

**Status distribution (per-interaction):**

| b2_status | Count | % |
|-----------|-------|---|
| no_candidates | 8 | 80% |
| timeout_or_error | 1 | 10% |
| discarded_handled | 1 | 10% |

**Latency (per-interaction):**

| Metric | Value |
|--------|-------|
| p50 | 385ms |
| p95 | 1462ms |
| min | 222ms |
| max | 1661ms |

**Per-query detail:**

| Query | b2_status | b2_ms | top_score |
|-------|-----------|-------|-----------|
| go to budget100 | no_candidates | 397 | — |
| take me to budget100 | no_candidates | 744 | — |
| bring up budget100 | no_candidates | 264 | — |
| can you show budget100 | discarded_handled | 268 | 0.924 |
| display budget100 | no_candidates | 245 | — |
| access budget100 | no_candidates | 763 | — |
| load budget100 | timeout_or_error | 1218 | — |
| pull up budget100 | no_candidates | 222 | — |
| switch to budget100 | no_candidates | 373 | — |
| open links panel b | no_candidates | 1661 | — |

**Decision**: `timeout_or_error` = 10% (below 20% threshold). **Lock 1200/2000.**

### Final Locked Values

| Constant | File | Value | Previous |
|----------|------|-------|----------|
| `EMBEDDING_TIMEOUT_MS` | `lib/chat/routing-log/embedding-service.ts:21` | 1200ms | 600ms |
| `MEMORY_SEMANTIC_READ_TIMEOUT_MS` | `lib/chat/routing-log/memory-semantic-reader.ts:27` | 2000ms | 800ms |

**Escalation rule**: If future soak shows `timeout_or_error` > 20%, move `EMBEDDING_TIMEOUT_MS` to 1500ms.

---

## Monitoring Queries

### Per-interaction detail (deduped)
```sql
SELECT DISTINCT ON (interaction_id)
       created_at, raw_query_text, routing_lane,
       semantic_hint_metadata->>'b2_status' AS b2_status,
       semantic_hint_metadata->>'b2_raw_count' AS b2_raw,
       semantic_hint_metadata->>'b2_validated_count' AS b2_valid,
       semantic_hint_metadata->>'b2_latency_ms' AS b2_ms,
       semantic_hint_metadata->>'top_score' AS top_score
FROM chat_routing_durable_log
WHERE semantic_hint_metadata IS NOT NULL
ORDER BY interaction_id, created_at ASC;
```

### Status distribution (per-interaction)
```sql
SELECT b2_status, COUNT(*) AS turns,
       ROUND(AVG(b2_ms), 0) AS avg_ms,
       PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY b2_ms) AS p50_ms,
       PERCENTILE_CONT(0.95) WITHIN GROUP (ORDER BY b2_ms) AS p95_ms
FROM (
  SELECT DISTINCT ON (interaction_id)
         (semantic_hint_metadata->>'b2_status') AS b2_status,
         (semantic_hint_metadata->>'b2_latency_ms')::numeric AS b2_ms
  FROM chat_routing_durable_log
  WHERE semantic_hint_metadata IS NOT NULL
    AND semantic_hint_metadata->>'b2_status' IS NOT NULL
  ORDER BY interaction_id, created_at ASC
) sub
GROUP BY 1
ORDER BY turns DESC;
```

### Timeout rate check (decision rule: escalate if > 20%)
```sql
SELECT
  COUNT(*) FILTER (WHERE b2_status = 'timeout_or_error') AS timeout_turns,
  COUNT(*) AS total_turns,
  ROUND(100.0 * COUNT(*) FILTER (WHERE b2_status = 'timeout_or_error') / COUNT(*), 1) AS timeout_pct
FROM (
  SELECT DISTINCT ON (interaction_id)
         (semantic_hint_metadata->>'b2_status') AS b2_status
  FROM chat_routing_durable_log
  WHERE semantic_hint_metadata IS NOT NULL
    AND semantic_hint_metadata->>'b2_status' IS NOT NULL
  ORDER BY interaction_id, created_at ASC
) sub;
```

---

## Phase 3b Structural Analysis — Hint Injection Coverage Gap

### Finding

Phase 3b semantic hint injection code exists and is fully implemented behind `CHAT_ROUTING_SEMANTIC_HINT_INJECTION_ENABLED`. The pipeline:

1. B2 candidates validated via Gate 3 (`memory-validator.ts`) against live UI snapshot
2. Attached to routing result when `!result.handled` (`routing-dispatcher.ts:1301`)
3. Sanitized to minimal payloads (`chat-navigation-panel.tsx:2090`)
4. Sent to navigate API as `semantic_hints` field
5. Server validates (max 5, length caps, action allowlist, score bounds) (`navigate/route.ts:625`)
6. Near-tie detection: top 2 scores within 0.03 → force clarify (`navigate/route.ts:647`)
7. Top hint composed into context string → injected into LLM prompt (`intent-prompt.ts:933`)
8. Post-LLM: `semantic_hint_used` checks if resolved target matches any hint candidate (`chat-navigation-panel.tsx:2178`)

### Structural Coverage Problem

For hint injection to fire, **both** conditions must be true simultaneously:

1. **Gate 3 passes** (`validatedCount > 0`) — requires target widget+item present in live UI snapshot
2. **Tier chain unhandled** (`!result.handled`) — requires all tiers (0-5) to miss

These conditions are **nearly mutually exclusive in practice**:

- **Widget removed from dashboard** → Gate 3 rejects all candidates (`target_widget_gone`, `memory-validator.ts:59`) → `validatedCount = 0` → no hints attached. Tier chain also misses, but there are no hints to inject.
- **Widget present on dashboard** → Gate 3 passes. But grounding tiers (Tier 4/4.5) also see the same widget items in the live snapshot and handle the query → `result.handled = true` → candidates become `discarded_handled`.

The only window: widget is present (Gate 3 passes) AND query phrasing is unusual enough that all grounding tiers miss. Since Tier 4.5 uses an LLM that sees the same widget items, this window is extremely narrow — the grounding LLM's semantic understanding covers the same space as B2's embedding similarity.

### Evidence

- **3a soak (10-turn baseline)**: `candidates_found` was **0%** — never observed in soak. Every B2 hit was `discarded_handled` (10%) because Tier 4/5 handled.
- **Memory index analysis**: All 30 B2 memory entries target widget items (`execute_widget_item` action type, `w_links_b`/`w_links_a`/`w_recent_widget` widgets). These are the same objects the grounding tiers reason over.

### Root Cause

Current B2 memory and grounding tiers reason over the **same object set** (widget items in the live snapshot). B2 stores entries from previously successful grounding actions. A semantically similar query against the same objects will be handled by the same grounding tiers that created the original memory entry — making the hint redundant.

### Decision: Freeze as Experimental

**Status**: `CHAT_ROUTING_SEMANTIC_HINT_INJECTION_ENABLED=false` (locked off).

The 3b injection code is functional, gated, and costs nothing to keep. But it should not be treated as a production feature or drive soak effort under the current architecture.

**Do not:**
- Relax Gate 3 to allow unvalidated candidates as hints (turns grounded memory into speculative prompt bias)
- Inject hints when `result.handled` (breaks tier authority model, adds interference to correct outcomes)
- Spend further soak effort trying to prove coverage under current architecture

**Revisit when any of these conditions change:**
1. **Broader memory sources** — Memory covers cross-session or cross-entry patterns not in the current live snapshot (e.g., user preferences, previously visited entries)
2. **Clarifier ranking** — Hints are used to rank disambiguation options rather than select actions (different code path, not constrained by the attach gate)
3. **Tier authority redesign** — Tier 4/4.5 scope changes in a way that reduces overlap with B2's semantic space

### Remaining Observability Log

A `[navigate-b2-hint]` console log was added at `navigate/route.ts:672` during this analysis. It fires only when injection is enabled and actionable hints exist. Retained for future debugging.

---

## Next Steps

1. **Monitor timeout rate**: Run the timeout rate check query periodically. If `timeout_or_error` > 20%, move `EMBEDDING_TIMEOUT_MS` to 1500ms.
2. **Phase 3b**: Frozen as experimental. Revisit only when memory sources broaden, hints target clarifier ranking, or tier authority is redesigned. See "Phase 3b Structural Analysis" above.
3. **Optional refinements** (deferred):
   - Add `b2_lookup_reason` field to propagate server-side `lookup_status` to durable log (only if ambiguity still hurts analysis)
   - Per-interaction dedup in monitoring dashboards
