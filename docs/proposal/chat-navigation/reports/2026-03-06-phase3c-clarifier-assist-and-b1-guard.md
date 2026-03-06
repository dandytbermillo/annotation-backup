# Phase 3c: Clarifier Assist (Shadow Mode) + B1 Selection Context Guard

**Date**: 2026-03-06
**Phase**: Phase 3c — Semantic Memory Clarifier Assist
**Parent plan**: `docs/proposal/chat-navigation/plan/panels/chat/meta/multi_layer/semantic-memory-clarifier-assist-plan.md`
**Predecessor**: Phase 3a (B2 telemetry, validated), Phase 3b (Lane D hint injection, frozen)

---

## Summary

This session implemented three changes:

1. **Phase 3c Clarifier Assist (shadow mode)**: B2 semantic candidates reorder clarifier disambiguation options. Shadow mode computes + logs what WOULD change without affecting user-visible order.
2. **Selection Correlation Wrapper**: Centralized `wrappedHandleSelectOption` inside `dispatchRoutingInner` to capture `clarifier_origin_message_id` + `selected_option_id` for correlating clarifier-shown turns with user selections.
3. **B1 Selection Context Guard**: Skip B1 exact memory when any selection context is active (`lastClarification` OR `widgetSelectionContext`), so ordinal inputs ("1", "2") flow to the deterministic clarification intercept instead of memory replay.

Additionally:
4. **Fuzzy match false positive fix**: "budget" was fuzzy-matching to "widget" (Levenshtein distance 2, different first char). Added a first-character guard for distance-2 matches.

---

## Problem Statements

### Phase 3c Coverage Gap

Phase 3b (Lane D hint injection) was structurally unreachable — B2 and grounding tiers operate on the same object set, making `!result.handled` nearly impossible when Gate 3 passes. Phase 3c uses B2 at a different decision point: **clarifier option ranking**. When Tier 4.5 grounding produces ambiguity, B2 tells us WHICH option the user likely wants.

### B1 Stealing Ordinal Selections

When a grounding clarifier showed options (budget100, budget200) and the user typed "2", B1 exact memory intercepted the query before the clarification intercept (Tier 1d) could handle it. Result: badge showed "Memory-Exact" instead of "Deterministic", clarifier state was not cleared, and selection correlation was bypassed.

Root cause chain:
- B1 runs at `dispatchRouting()` level (line 1187), before `dispatchRoutingInner()` (line 1312)
- Widget-context grounding clarifiers clear `lastClarification` and use `widgetSelectionContext` instead (line 918)
- The initial B1 guard (`!ctx.lastClarification`) missed the widget path because `lastClarification` was null
- B1 found a stored memory entry for "2" with matching context fingerprint and returned early

### Fuzzy Match False Positive

"show budget" was matching "Widget Manager" because `findFuzzyPanelMatch` with `MAX_FUZZY_DISTANCE=2` matched "budget" to "widget" (b->w, u->i = distance 2). This caused "show budget" to normalize to `{show, widget}` instead of falling through to the navigate API.

---

## Changes

### 1. Clarifier Reorder Function (Pure, Testable)

**File**: `lib/chat/routing-log/clarifier-reorder.ts`

- `reorderClarifierCandidates()`: Takes grounding candidates + B2 semantic candidates, returns reordered candidates with B2-matched items promoted to front. Match condition: `groundingCandidate.id === b2.slots_json.itemId || groundingCandidate.id === b2.slots_json.candidateId`.
- `computeClarifierReorderTelemetry()`: Pure function that classifies reorder outcomes into telemetry statuses. Takes grounding candidates, semantic candidates, clarifier message ID, and B2 lookup status. Returns status + metrics without side effects.

Status taxonomy (7 values):
- `not_applicable` — B2 not attempted (undefined/disabled lookup status)
- `no_b2_empty` — B2 succeeded but no usable candidates
- `no_b2_timeout` — B2 timed out
- `no_b2_error` — B2 errored
- `no_match` — B2 candidates exist but none match grounding IDs
- `matched_no_reorder` — Top B2 match already at position 1
- `shadow_reordered` — B2 would have changed visible order

### 2. Dispatcher Wiring (Shadow Mode)

**File**: `lib/chat/routing-dispatcher.ts`

- Added `b2LookupStatus` capture from B2 block, passed to `dispatchRoutingInner`
- Added `_b2ClarifierTelemetry`, `_clarifierOriginMessageId`, `_selectedOptionId` to `RoutingDispatcherResult`
- Thin wrapper `attachClarifierReorderTelemetry` delegates to extracted pure function — wired at 4 clarifier construction sites (lines ~2289, 4676, 4724, 4784)
- Serialized telemetry into log payload (lines ~1341-1357)

### 3. Selection Correlation Wrapper

**File**: `lib/chat/routing-dispatcher.ts`

`wrappedHandleSelectOption` (lines 1426-1430) captures `ctx.lastClarification?.messageId` and `option.id` on `defaultResult` before delegating to `ctx.handleSelectOption`. Replaces all 15+ `ctx.handleSelectOption` references in `dispatchRoutingInner`. Both `handleClarificationIntercept` call sites (lines 1608, 1723) receive the wrapper, which propagates to all 14 `handleSelectOption` calls in `chat-routing-clarification-intercept.ts` and 4 calls in `chat-routing-pre-clarification.ts`.

**Known gap**: Widget-context clarifiers clear `lastClarification` (line 918), so `ctx.lastClarification?.messageId` is null at selection time for widget options. Selection correlation for widget-context clarifiers requires a separate approach (deferred).

### 4. Telemetry Fields + Route Handler

**File**: `lib/chat/routing-log/payload.ts`

```typescript
b2_clarifier_status?: 'not_applicable' | 'no_b2_empty' | 'no_b2_timeout' | 'no_b2_error' | 'no_match' | 'matched_no_reorder' | 'reordered' | 'shadow_reordered'
b2_clarifier_match_count?: number
b2_clarifier_top_match_rank?: number
b2_clarifier_top_match_id?: string
b2_clarifier_top_score?: number
b2_clarifier_message_id?: string
b2_clarifier_option_ids?: string[]
clarifier_origin_message_id?: string
selected_option_id?: string
```

**File**: `app/api/chat/routing-log/route.ts`

Extended `semanticHintMeta` JSON builder condition to include `payload.b2_clarifier_status != null`. All `b2_clarifier_*` and selection correlation fields serialized into `semantic_hint_metadata` JSONB.

### 5. B1 Selection Context Guard

**File**: `lib/chat/routing-dispatcher.ts` (line 1190)

Changed:
```typescript
// Before:
if (memoryReadEnabled) {
// After:
const hasActiveSelectionContext = !!ctx.lastClarification || !!ctx.widgetSelectionContext
if (memoryReadEnabled && !hasActiveSelectionContext) {
```

When either `lastClarification` or `widgetSelectionContext` is active, B1 is skipped. The input flows to `dispatchRoutingInner()` where the clarification intercept (Tier 1d) or universal widget resolver (Tier 3.5) handles it deterministically.

### 6. Fuzzy Match First-Character Guard

**File**: `lib/chat/panel-command-matcher.ts` (line 103)

Added guard in `findFuzzyPanelMatch`: distance-2 matches must share the first character with the target term. Blocks "budget" -> "widget" (b != w) while preserving legitimate distance-2 typo corrections like "shwo" -> "show" (s = s).

### 7. Feature Flag

**File**: `.env.local`

```
NEXT_PUBLIC_CHAT_ROUTING_SEMANTIC_CLARIFIER_ASSIST_ENABLED=true
```

---

## Files Modified

| File | Change |
|------|--------|
| `lib/chat/routing-dispatcher.ts` | B2 status capture, dispatchRoutingInner params, clarifier telemetry wiring (4 sites), selection correlation wrapper (15+ replacements), B1 guard, log payload serialization |
| `lib/chat/routing-log/payload.ts` | Added `b2_clarifier_*` fields + selection correlation fields |
| `app/api/chat/routing-log/route.ts` | Extended `semanticHintMeta` JSON builder for Phase 3c fields |
| `lib/chat/panel-command-matcher.ts` | First-character guard for distance-2 fuzzy matches |
| `.env.local` | Added `NEXT_PUBLIC_CHAT_ROUTING_SEMANTIC_CLARIFIER_ASSIST_ENABLED=true` |

## Files Created

| File | Description |
|------|-------------|
| `lib/chat/routing-log/clarifier-reorder.ts` | Pure reorder function + `computeClarifierReorderTelemetry` |
| `__tests__/unit/routing-log/clarifier-telemetry.test.ts` | 12 unit tests for all 7 status values |

---

## Test Results

### Type-Check
```
npm run type-check -> clean
```

### Unit Tests
```
23 routing-related suites, 278 tests -- all passing

Key suites:
- clarifier-telemetry.test.ts: 12/12 passed
  - not_applicable (undefined + disabled): 2 tests
  - no_b2_empty (empty + ok-filtered): 2 tests
  - no_b2_timeout: 1 test
  - no_b2_error: 1 test
  - no_match: 1 test
  - matched_no_reorder: 1 test
  - shadow_reordered (single + multi): 2 tests
  - optionIds order: 1 test
  - messageId pass-through: 1 test

- panel-command-matcher.test.ts: 42/42 passed
  - Includes regression test: "show budget" does NOT match Widget Manager
```

---

## Soak Validation

### Clarifier Telemetry (Phase 3c)

"show budget" produced a grounding clarifier with budget100/budget200:

| Field | Value |
|-------|-------|
| `b2_clarifier_status` | `no_b2_empty` |
| `b2_clarifier_message_id` | `assistant-1772768306144` |
| `b2_clarifier_option_ids` | `["01ff55c1-...", "98cec0f2-..."]` |

Correctly classified: B2 had no candidates for this query, so clarifier order is unchanged.

### B1 Guard (Before vs After)

**Before fix** (B1 guard absent):

| Input | Routing Lane | Decision Source | Badge |
|-------|-------------|-----------------|-------|
| "1" | B1 | memory_exact | Memory-Exact |
| "2" | B1 | memory_exact | Memory-Exact |

Context snapshot showed `has_last_clarification: false`, `has_pending_options: false` — confirming widget-context clarifier clears both, and B1 was not guarded.

**After fix** (B1 guard with `widgetSelectionContext` check):

| Input | Routing Lane | Decision Source | Badge |
|-------|-------------|-----------------|-------|
| "1" | A | deterministic | Deterministic |
| "2" | A | deterministic | Deterministic |

Debug log confirmed: `universal_resolver_widget_selection` at tier 3.5 handled both ordinals correctly.

### Fuzzy Match Fix

**Before**: "show budget" -> normalized to `{show, widget}` -> matched Widget Manager -> single-option clarifier "Which option did you mean? Widget Manager?"

**After**: "budget" no longer fuzzy-matches "widget" (different first char) -> falls through to navigate API -> finds budget100/budget200 -> multi-option clarifier

---

## Investigation Trail (B1 Guard)

The B1 guard required three iterations to get right:

1. **First attempt**: `!ctx.lastClarification` — failed because widget-context grounding clarifiers clear `lastClarification` (line 918) and use `widgetSelectionContext` instead
2. **Diagnosis**: DB showed `has_last_clarification: false` for all ordinal inputs. Debug log showed `clarification_bypass_widget_context` confirming the widget path
3. **Final fix**: `!ctx.lastClarification || !ctx.widgetSelectionContext` — covers both chat-origin and widget-context clarifiers

Key evidence from debug logs:
- `grounding_clarifier_widget_context` at line 924: confirms clarifier built via widget path
- `universal_resolver_widget_selection` at tier 3.5: confirms ordinals resolved by widget resolver after B1 skipped
- `clarification_bypass_widget_context`: informational log, not blocking (fires after widget resolver handles)

---

## Known Gaps (Deferred)

### 1. Selection Correlation for Widget-Context Clarifiers

Widget-context clarifiers clear `lastClarification` (line 918), so `wrappedHandleSelectOption` reads `ctx.lastClarification?.messageId` as null. The `clarifier_origin_message_id` field is empty for widget selections. Fix requires either:
- Storing the widget clarifier message ID in a separate field on `widgetSelectionContext`
- OR reading it from `widgetSelectionContext` in the wrapper

### 2. Server-Side Clarifier Telemetry

Navigate API responses that return selectable options (`chat-navigation-panel.tsx:2608-2638`) do not go through `dispatchRoutingInner`, so Phase 3c telemetry is not attached. These clarifiers bypass the grounding tier entirely.

### 3. B2 Clarifier Assist Coverage

Current soak shows `b2_clarifier_status: no_b2_empty` — B2 has no candidates for "show budget" queries. The clarifier assist will only produce `shadow_reordered` when B2 has stored memory entries that match grounding candidates. This requires more diverse usage patterns to build up the memory index.

---

## Monitoring Queries

### Phase 3c clarifier telemetry
```sql
SELECT created_at, raw_query_text, routing_lane,
       semantic_hint_metadata->>'b2_clarifier_status' AS cl_status,
       semantic_hint_metadata->>'b2_clarifier_message_id' AS cl_msg_id,
       semantic_hint_metadata->'b2_clarifier_option_ids' AS cl_opts,
       semantic_hint_metadata->>'b2_clarifier_match_count' AS match_ct
FROM chat_routing_durable_log
WHERE semantic_hint_metadata->>'b2_clarifier_status' IS NOT NULL
ORDER BY created_at DESC
LIMIT 20;
```

### Selection correlation (when populated)
```sql
SELECT created_at, raw_query_text, routing_lane, decision_source,
       semantic_hint_metadata->>'clarifier_origin_message_id' AS origin_msg,
       semantic_hint_metadata->>'selected_option_id' AS sel_id
FROM chat_routing_durable_log
WHERE semantic_hint_metadata->>'clarifier_origin_message_id' IS NOT NULL
ORDER BY created_at DESC
LIMIT 20;
```

### B1 guard verification (should show no B1 rows for ordinals after clarifiers)
```sql
SELECT created_at, raw_query_text, routing_lane, decision_source,
       context_snapshot_json->>'has_last_clarification' AS has_clar
FROM chat_routing_durable_log
WHERE raw_query_text IN ('1', '2', '3', 'first', 'second', 'last')
  AND created_at > NOW() - INTERVAL '1 hour'
ORDER BY created_at DESC;
```

---

## Next Steps

1. **Selection correlation for widget-context clarifiers**: Store widget clarifier message ID so `wrappedHandleSelectOption` can read it
2. **Server-side clarifier telemetry**: Add Phase 3c telemetry at `stored_pending_options` path in `chat-navigation-panel.tsx`
3. **Shadow soak for `shadow_reordered`**: Build up B2 memory entries with diverse queries to produce B2-grounding overlap
4. **Evaluate promotion criteria**: When `shadow_reordered` turns show B2's top match = user's actual pick >= 60%, promote from shadow to active
