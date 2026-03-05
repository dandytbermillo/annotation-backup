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
| `no_candidates` | Yes | Embedding succeeded, no similar entries |
| `timeout_or_error` | Yes | Embedding timeout / client timeout |
| `skipped` | Unit test only | Requires `semanticReadEnabled=false` with `memoryReadEnabled=true` |
| `candidates_found` | Unit test only | Requires embedding success + entries above 0.92 + tier chain unhandled |
| `discarded_handled` | Unit test only | Requires `candidates_found` + tier chain handles |

`candidates_found` and `discarded_handled` require the embedding API to complete within 600ms AND memory entries with cosine similarity >= 0.92. The current slow-network environment prevents embedding completion within the timeout. On a faster connection, these statuses would appear for queries like "please open budget100" (which scored 0.963 similarity in earlier direct-API testing).

---

## Monitoring Queries

### Per-row detail
```sql
SELECT created_at, raw_query_text, routing_lane,
       semantic_hint_metadata->>'b2_status' AS b2_status,
       semantic_hint_metadata->>'b2_raw_count' AS b2_raw,
       semantic_hint_metadata->>'b2_validated_count' AS b2_valid,
       semantic_hint_metadata->>'b2_latency_ms' AS b2_ms,
       semantic_hint_metadata->>'top_score' AS top_score
FROM chat_routing_durable_log
WHERE semantic_hint_metadata IS NOT NULL
ORDER BY created_at DESC
LIMIT 10;
```

### Distribution
```sql
SELECT semantic_hint_metadata->>'b2_status' AS b2_status,
       COUNT(*) AS cnt,
       ROUND(AVG((semantic_hint_metadata->>'b2_latency_ms')::numeric), 0) AS avg_ms,
       ROUND(AVG((semantic_hint_metadata->>'b2_raw_count')::numeric), 1) AS avg_raw,
       ROUND(AVG((semantic_hint_metadata->>'b2_validated_count')::numeric), 1) AS avg_valid
FROM chat_routing_durable_log
WHERE semantic_hint_metadata IS NOT NULL
  AND semantic_hint_metadata->>'b2_status' IS NOT NULL
GROUP BY 1
ORDER BY cnt DESC;
```

---

## Next Steps

1. **Faster network test**: Re-run soak on a faster connection to observe `candidates_found` and `discarded_handled` statuses
2. **Embedding timeout tuning**: Consider increasing `EMBEDDING_TIMEOUT_MS` from 600ms if slow-network environments are common
3. **Phase 3b**: Once B2 telemetry is stable and `candidates_found` is observed, proceed to semantic hint injection (`CHAT_ROUTING_SEMANTIC_HINT_INJECTION_ENABLED`)
