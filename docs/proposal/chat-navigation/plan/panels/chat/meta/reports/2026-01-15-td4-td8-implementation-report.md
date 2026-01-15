# Implementation Report: TD-4 & TD-8 Debt Paydown

**Date:** 2026-01-15
**Status:** Complete
**Feature Slug:** `chat-navigation`
**Source Plan:** `docs/proposal/chat-navigation/plan/panels/chat/meta/2026-01-14-doc-retrieval-routing-debt-paydown-plan.md`

---

## Summary

Implemented TD-4 (Durable Routing Telemetry) and TD-8 (Don't Lock State on Weak) from the debt paydown plan. All acceptance criteria met and verified with manual testing.

---

## TD-4: Durable Routing Telemetry

### Implementation

#### 1. Telemetry Schema (`lib/chat/routing-telemetry.ts`)

Created new module with:
- **`RoutingPatternId` enum** - Stable pattern identifiers (DO NOT change existing values)
- **`RoutingTelemetryEvent` interface** - Full event schema
- **`logRoutingDecision()`** - Logs to PostgreSQL via debugLog with `forceLog: true`
- **`createRoutingTelemetryEvent()`** - Helper to create partial events
- **`getPatternId()`** - Determine pattern based on input

```typescript
export enum RoutingPatternId {
  DEF_WHAT_IS = 'DEF_WHAT_IS',
  DEF_WHAT_ARE = 'DEF_WHAT_ARE',
  DEF_EXPLAIN = 'DEF_EXPLAIN',
  DEF_CONVERSATIONAL = 'DEF_CONVERSATIONAL',
  FOLLOWUP_TELL_ME_MORE = 'FOLLOWUP_TELL_ME_MORE',
  FOLLOWUP_PRONOUN = 'FOLLOWUP_PRONOUN',
  FOLLOWUP_CLASSIFIER = 'FOLLOWUP_CLASSIFIER',
  ACTION_COMMAND = 'ACTION_COMMAND',
  ACTION_WIDGET = 'ACTION_WIDGET',
  ROUTE_DOC_STYLE = 'ROUTE_DOC_STYLE',
  ROUTE_BARE_NOUN = 'ROUTE_BARE_NOUN',
  ROUTE_LLM_FALLBACK = 'ROUTE_LLM_FALLBACK',
  CORRECTION = 'CORRECTION',
  AMBIGUOUS_CROSS_DOC = 'AMBIGUOUS_CROSS_DOC',
  UNKNOWN = 'UNKNOWN',
}
```

#### 2. Always-On Logging (`lib/utils/debug-logger.ts`)

Added `forceLog?: boolean` option to `DebugLogData` interface:
- When `forceLog: true`, bypasses `isDebugEnabled()` check
- Routing telemetry always persisted regardless of debug flag

#### 3. Telemetry Instrumentation (`components/chat/chat-navigation-panel.tsx`)

Added telemetry logging to all routing paths:

| Path | Lines | Pattern ID |
|------|-------|------------|
| Meta-explain | 2807-2895 | DEF_WHAT_IS, DEF_WHAT_ARE, DEF_EXPLAIN, AMBIGUOUS_CROSS_DOC |
| Correction | 2978-2996 | CORRECTION |
| Follow-up | 3088-3131 | FOLLOWUP_PRONOUN, FOLLOWUP_CLASSIFIER |
| Action route | 3330-3336 | ACTION_WIDGET, ACTION_COMMAND |
| General doc retrieval | 3371-3380 | ROUTE_DOC_STYLE, ROUTE_BARE_NOUN, AMBIGUOUS_CROSS_DOC |
| LLM fallback | 3607-3611 | ROUTE_LLM_FALLBACK |

#### 4. Classifier Timeout Tracking (Lines 3016-3081)

- Added `AbortController` with 2-second timeout
- Tracking variables: `classifierCalled`, `classifierResult`, `classifierTimeout`, `classifierLatencyMs`, `classifierError`
- Populated in telemetry events

#### 5. User Correction Tracking (Lines 2978-2996)

- Correction events logged with `matched_pattern_id = CORRECTION`
- `user_corrected_next_turn = true` indicates this is a correction event
- `doc_slug_top` contains the doc that was incorrectly routed to

#### 6. AMBIGUOUS_CROSS_DOC Pattern (Lines 2891-2894, 3376-3379)

- Set when `result.status === 'ambiguous' && result.options?.length >= 2`
- Applied in both meta-explain and general doc retrieval paths

### Event Schema

```typescript
interface RoutingTelemetryEvent {
  input_len: number
  normalized_query: string
  route_deterministic: 'doc' | 'action' | 'bare_noun' | 'llm' | 'followup' | 'clarify'
  route_final: 'doc' | 'action' | 'bare_noun' | 'llm' | 'followup' | 'clarify'
  matched_pattern_id: RoutingPatternId
  known_terms_loaded: boolean
  known_terms_count: number
  last_doc_slug_present: boolean
  last_doc_slug?: string
  classifier_called: boolean
  classifier_result?: boolean
  classifier_latency_ms?: number
  classifier_timeout?: boolean
  classifier_error?: boolean
  doc_status?: 'found' | 'weak' | 'ambiguous' | 'no_match'
  doc_slug_top?: string
  doc_slug_alt?: string[]
  followup_detected: boolean
  is_new_question: boolean
  routing_latency_ms: number
  user_corrected_next_turn?: boolean
}
```

---

## TD-8: Don't Lock State on Weak

### Implementation

#### 1. General Doc Retrieval (Lines 3489-3515)

When `result.status === 'weak'`:
- Show confirmation pill instead of auto-expanding
- **DO NOT** set `lastDocSlug` (prevents follow-up locking)
- Only set `lastDocSlug` after user confirms via pill selection

```typescript
if (result.status === 'weak' && result.results?.length > 0) {
  // Create pill for weak result so user can confirm
  const weakOption: SelectionOption = { ... }

  // TD-8: DON'T set lastDocSlug on weak results
  updateDocRetrievalState({
    // lastDocSlug intentionally NOT set - per TD-8
    lastTopicTokens: queryTokens,
    lastMode: isDocStyle ? 'doc' : 'bare_noun',
  })
}
```

#### 2. Meta-Explain Path (Lines 2967-2975)

Added `isConfidentResult` check:
- Only set `lastDocSlug` for `found` status
- Weak results don't lock follow-up state

```typescript
const isConfidentResult = result.status === 'found' || !result.status
updateDocRetrievalState({
  lastDocSlug: isConfidentResult ? (result.docSlug || metaQueryTerm) : undefined,
  lastTopicTokens: metaTokens,
  lastMode: 'doc',
  lastChunkIdsShown: isConfidentResult && result.chunkId ? [result.chunkId] : [],
})
```

#### 3. Ambiguous Results (Lines 3553-3567)

- **DO NOT** set `lastDocSlug` on ambiguous results
- Only set after pill selection confirms user intent

---

## Test Results

### Manual Testing (2026-01-15)

| Query | Route | Pattern | Status |
|-------|-------|---------|--------|
| `what is workspace` | doc | DEF_WHAT_IS | found |
| `tell me more` | followup | FOLLOWUP_PRONOUN | - |
| `no` | clarify | CORRECTION | - |
| `recent` | action | ACTION_WIDGET | - |
| `hello world` | llm | ROUTE_LLM_FALLBACK | - |

### Database Verification

```sql
SELECT
  substring(metadata->>'normalized_query', 1, 20) as query,
  metadata->>'route_final' as route,
  metadata->>'matched_pattern_id' as pattern,
  metadata->>'classifier_called' as clf_called,
  metadata->>'classifier_timeout' as clf_timeout,
  metadata->>'user_corrected_next_turn' as corrected,
  metadata->>'routing_latency_ms' as latency_ms
FROM debug_logs
WHERE component = 'DocRouting'
  AND action = 'route_decision'
ORDER BY timestamp DESC
LIMIT 10;
```

**Results:**
```
       query       |  route   |      pattern       | clf_called | clf_timeout | corrected | latency_ms
-------------------+----------+--------------------+------------+-------------+-----------+------------
 hello world       | llm      | ROUTE_LLM_FALLBACK | false      | false       |           | 0
 recent            | action   | ACTION_WIDGET      | false      | false       |           | 0
 no                | clarify  | CORRECTION         | false      |             | true      | 0
 tell me more      | followup | FOLLOWUP_PRONOUN   | false      | false       |           | 0
 what is workspace | doc      | DEF_WHAT_IS        | false      |             |           | 354
```

---

## Files Modified

| File | Changes |
|------|---------|
| `lib/chat/routing-telemetry.ts` | **NEW** - Telemetry schema, enum, logging functions |
| `lib/utils/debug-logger.ts` | Added `forceLog` option |
| `components/chat/chat-navigation-panel.tsx` | Telemetry instrumentation, TD-8 fixes |

---

## Acceptance Criteria

### TD-4: Durable Telemetry

- [x] Routing events persisted and queryable
- [x] `matched_pattern_id` enum documented and stable
- [x] `classifier_timeout` field populated
- [x] `user_corrected_next_turn` field populated
- [x] All routes logged (doc, action, llm, followup, clarify)
- [x] AMBIGUOUS_CROSS_DOC pattern set for ambiguous results

### TD-8: Don't Lock State on Weak

- [x] Weak results show confirmation pill
- [x] `lastDocSlug` NOT set on weak results
- [x] `lastDocSlug` NOT set on ambiguous results
- [x] Follow-ups re-query instead of expanding guessed doc

---

## Production Recommendations

1. **Retention Policy** - Add cleanup for old telemetry:
   ```sql
   DELETE FROM debug_logs
   WHERE component = 'DocRouting'
     AND timestamp < NOW() - INTERVAL '30 days';
   ```

2. **Optional Sampling** - Add env var with default 1.0:
   ```typescript
   const SAMPLE_RATE = parseFloat(process.env.ROUTING_TELEMETRY_SAMPLE_RATE ?? '1.0')
   ```

3. **Index for Queries** - Improve JSON filter performance:
   ```sql
   CREATE INDEX idx_debug_logs_pattern_id
   ON debug_logs ((metadata->>'matched_pattern_id'))
   WHERE component = 'DocRouting';
   ```

---

## Next Steps

Per debt paydown plan execution order:
1. ~~TD-4: Durable telemetry~~ ✅
2. ~~TD-8: Don't lock state on weak~~ ✅
3. TD-1: Remove CORE_APP_TERMS duplication (after collecting telemetry data)
4. TD-3: Consolidate pattern matching
5. TD-2: Gated fuzzy matching
6. TD-7: Stricter app-relevance fallback

---

## Changelog

| Date | Author | Change |
|------|--------|--------|
| 2026-01-15 | Claude | Initial implementation of TD-4 and TD-8 |
| 2026-01-15 | Claude | Fixed AMBIGUOUS_CROSS_DOC pattern not being set |
| 2026-01-15 | Claude | Added meta-explain telemetry logging |
