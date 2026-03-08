# Phase 3c: Clarifier Assist (Shadow → Active) + B1 Selection Context Guard

**Date**: 2026-03-06 (shadow), 2026-03-08 (active mode validated)
**Phase**: Phase 3c — Semantic Memory Clarifier Assist
**Status**: Validated in dev, behind flag (`NEXT_PUBLIC_CHAT_ROUTING_SEMANTIC_CLARIFIER_REORDER_ACTIVE=true`)
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
5. **Panel disambiguation telemetry wiring**: Extended `attachClarifierReorderTelemetry` to 2 new panel disambiguation call sites (scope-cue + main Tier 2c) so B2 shadow telemetry is captured for panel clarifiers.
6. **Badge letter "a" stopword fix**: Trailing single-char stopwords preserved as badge identifiers. Fixes "Links Panel A" losing its distinguishing token during normalization, which caused false single-match for "open links panel".
7. **Type boundary fix**: Widened `attachClarifierReorderTelemetry` parameter from `GroundingCandidate[]` to `ReorderableCandidate[]` so panel disambiguation candidates (which lack `source` field) are type-safe.
8. **Selection correlation propagation fix**: Clarification intercept return paths were creating new objects without `_clarifierOriginMessageId`/`_selectedOptionId` set by `wrappedHandleSelectOption` on `defaultResult`. Fixed by propagating these fields into the return objects at both intercept sites.
9. **Widget-context selection correlation**: Tier 3.5 universal resolver widget path (`universal_resolver_widget`, `universal_resolver_chat_widget_option`) executes selections via `groundingAction` without calling `wrappedHandleSelectOption`. Fixed by setting `defaultResult._clarifierOriginMessageId` from `widgetSelectionContext.optionSetId` at these sites.
10. **Grounding LLM first-time candidate fix**: `bindGroundingClarifierOptions` failed to build `pendingOptions` for first-time grounding LLM clarifiers because `findLastOptionsMessage` couldn't find candidates in message history (the clarifier message hadn't been added yet). Fixed by reconstructing execution data via `reconstructSnapshotData` as fallback.

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

**Note**: Widget-context clarifiers clear `lastClarification` (line 918), but `wrappedHandleSelectOption` (line 1444) falls back to `ctx.widgetSelectionContext?.optionSetId`, so widget selections correctly populate `clarifier_origin_message_id`.

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

### 5. B1 Selection Context Guard (Narrowed)

**File**: `lib/chat/routing-dispatcher.ts` (line 1192-1197)

Changed:
```typescript
// Before (too broad — blocked B1 for ALL queries during widgetSelectionContext TTL):
const hasActiveSelectionContext = !!ctx.lastClarification || !!ctx.widgetSelectionContext
if (memoryReadEnabled && !hasActiveSelectionContext) {

// After (narrowed — only blocks B1 for selection-like inputs, not commands):
const hasActiveSelectionContext = !!ctx.lastClarification || !!ctx.widgetSelectionContext
const inputIsSelectionLike = isSelectionLike(ctx.trimmedInput)
const b1InputLooksLikeNewCommand = ACTION_VERB_PATTERN.test(ctx.trimmedInput)
  && !isSelectionOnly(ctx.trimmedInput, 10, [], 'embedded').isSelection
const shouldSkipB1ForSelection = hasActiveSelectionContext && inputIsSelectionLike && !b1InputLooksLikeNewCommand
if (memoryReadEnabled && !shouldSkipB1ForSelection) {
```

Three-part condition: B1 is only skipped when (a) selection context is active, (b) input is selection-like (ordinal, short label), AND (c) input does NOT look like a new command (no action verb). This allows "open links panel b" through B1 for auto-execute while still blocking bare ordinals ("2", "first") from B1 during an active clarifier.

**Regression fixed**: The initial broad guard (`!!ctx.widgetSelectionContext`) blocked B1 for ALL queries during the 2-turn TTL window. "open links panel b" would skip B1, fall through to the tier chain, and produce a single-option clarifier instead of auto-executing. The narrowed guard uses the `looksLikeNewCommand` escape (same pattern as Tier 3.6 line 3828) to let commands through.

### 6. Panel Disambiguation Telemetry Wiring

**File**: `lib/chat/routing-dispatcher.ts`

Wired `attachClarifierReorderTelemetry` at 2 new panel disambiguation call sites so B2 shadow telemetry is captured when Tier 2c produces a multi-match clarifier:

- **Site 1** (scope-cue dashboard path, after line ~2396): When `handlePanelDisambiguation` is called from the scope-cue dashboard branch and produces a multi-match clarifier
- **Site 2** (main Tier 2c, after line ~2724): When `handlePanelDisambiguation` is called from the main panel disambiguation tier

Both sites check `panelResult.clarifierMessageId && panelResult.clarifierCandidates` before attaching telemetry.

**File**: `lib/chat/chat-routing-panel-disambiguation.ts` (lines 133-139)

Extended `PanelDisambiguationHandlerResult` return to include `clarifierMessageId` and `clarifierCandidates` for the multi-match path.

**File**: `lib/chat/chat-routing-types.ts` (lines 269-272)

Added to `PanelDisambiguationHandlerResult`:
```typescript
clarifierMessageId?: string
clarifierCandidates?: Array<{ id: string; label: string; type: string }>
```

### 7. Badge Letter "a" Stopword Fix

**File**: `lib/chat/panel-command-matcher.ts` (line 158)

**Root cause**: The `STOPWORDS` set includes `'a'` (English article). When normalizing "Links Panel A", the badge letter "a" was stripped, reducing the title's token set to `{links, panel}`. This caused asymmetric matching: Panel A lost its distinguishing token while Panels B–E kept theirs. For "open links panel", only Panel A matched (false single-match), producing a single-option clarifier instead of disambiguation.

**Fix**: Preserve single-character stopwords at the **last position** of the token array. A trailing "a" is a badge identifier, not the English article. Mid-position "a" (e.g., "open **a** links panel") is still correctly stripped.

```typescript
// Before:
.filter(t => !STOPWORDS.has(t))

// After:
.filter((t, idx, arr) => {
  if (t.length === 1 && idx === arr.length - 1) return true
  return !STOPWORDS.has(t)
})
```

**Behavior change**:
| Input | Before (bug) | After (fix) |
|---|---|---|
| `open links panel` (A/B/C visible) | Exact match for A only → single-option clarifier | `none` → falls to Tier 4/LLM → all 3 shown |
| `links panel` (A/B/C visible) | Partial for all 3 → disambiguation | Same |
| `links panel a` | Exact for A (worked by accident) | Exact for A (correct — badge preserved) |
| `open links panel a` | Exact for A (badge stripped, coincidental) | Exact for A (badge preserved in both) |

### 8. Fuzzy Match First-Character Guard

**File**: `lib/chat/panel-command-matcher.ts` (line 103)

Added guard in `findFuzzyPanelMatch`: distance-2 matches must share the first character with the target term. Blocks "budget" -> "widget" (b != w) while preserving legitimate distance-2 typo corrections like "shwo" -> "show" (s = s).

### 9. Type Boundary Fix

**File**: `lib/chat/routing-dispatcher.ts` (line 1426)

`attachClarifierReorderTelemetry` closure parameter widened from `GroundingCandidate[]` to `ReorderableCandidate[]` (imported from `clarifier-reorder.ts`). `ReorderableCandidate` requires only `{ id, label, type, actionHint? }` — the minimal shape needed by `computeClarifierReorderTelemetry`. Panel disambiguation candidates `{ id, label, type: string }` satisfy this interface. Existing grounding sites still work since `GroundingCandidate` is structurally compatible.

**Discovery**: The pre-existing syntax error in `__tests__/unit/use-panel-close-handler.test.tsx:87` caused `tsc` to skip the entire check phase (`Check time: 0.00s`, `Types: 89`). All type errors were masked. With the broken file excluded (`tsconfig.check.json`), the TS2345 errors at lines 2399 and 2727 were confirmed.

### 10. Selection Correlation Propagation Fix

**File**: `lib/chat/routing-dispatcher.ts` (lines 1679, 1785)

`wrappedHandleSelectOption` sets `_clarifierOriginMessageId` and `_selectedOptionId` on `defaultResult` (via closure). But both `handleClarificationIntercept` return paths (primary at line 1679, replay at line 1785) created new objects without these fields. The log serialization at line 1371 reads `result._clarifierOriginMessageId` — which was always undefined for selection turns.

Fix: Both return objects now propagate the fields from `defaultResult`:
```typescript
_clarifierOriginMessageId: defaultResult._clarifierOriginMessageId,
_selectedOptionId: defaultResult._selectedOptionId,
```

### 11. Widget-Context Selection Correlation

**File**: `lib/chat/routing-dispatcher.ts` (Tier 3.5 universal resolver)

Root cause: grounding LLM clarifiers for widget items use `widgetSelectionContext` (not `lastClarification`). When the user selects via ordinal "2", the Tier 3.5 universal resolver widget path handles it via `groundingAction` — bypassing `wrappedHandleSelectOption` entirely. The selection correlation fields were never set.

Fix: Set `defaultResult._clarifierOriginMessageId = ctx.widgetSelectionContext?.optionSetId` and `defaultResult._selectedOptionId` at both widget resolution sites (`universal_resolver_widget` and `universal_resolver_chat_widget_option`) before the `...defaultResult` spread return.

### 12. Grounding LLM First-Time Candidate Fix

**File**: `lib/chat/routing-dispatcher.ts` (`bindGroundingClarifierOptions`)

Root cause: For `option`-type grounding LLM candidates (not widget), `findLastOptionsMessage(ctx.messages)` tried to find execution data from message history. But for first-time queries, the clarifier message hadn't been added yet (`ctx.addMessage` at line 4713 runs AFTER `bindGroundingClarifierOptions` at line 4698). Result: `pendingOptions.length === 0` → `lastClarification` cleared → intercept couldn't handle ordinals.

Fix: When message history lookup fails, reconstruct execution data from `{id, label, type}` using `reconstructSnapshotData` (imported from `chat-routing-clarification-utils.ts`). This ensures `pendingOptions` and `lastClarification` are always set for grounding LLM clarifiers.

**Status**: Implemented, not yet runtime-proven. The "show budget" soak exercised the all-widget branch (Fix #1), not this mixed/chat-option fallback. This fix targets a separate scenario: first-time grounding LLM clarifiers with non-widget `option`-type candidates not found in message history. Current environment does not provide a reliable repro — all items are folders visible in widget panels, so grounding candidates are always `widget_option` type. Requires intentionally creating a dataset with non-widget entries to exercise this path.

### 13. Feature Flags

**File**: `.env.local`

```
NEXT_PUBLIC_CHAT_ROUTING_SEMANTIC_CLARIFIER_ASSIST_ENABLED=true
NEXT_PUBLIC_CHAT_ROUTING_SEMANTIC_CLARIFIER_REORDER_ACTIVE=true
```

### 14. Active Reorder Implementation (2026-03-08)

**File**: `lib/chat/routing-dispatcher.ts`

Added `maybeActiveReorder()` helper gated by `NEXT_PUBLIC_CHAT_ROUTING_SEMANTIC_CLARIFIER_REORDER_ACTIVE`. When active + B2 candidates available, applies `reorderClarifierCandidates()` to the candidate list before both `bindGroundingClarifierOptions` and `buildGroundedClarifier`. Applied at 4 grounding clarifier paths:

- Scope-cue widget clarifier (`effectiveScopedCandidates`)
- LLM `need_more_info` clarifier (`effectiveCandidates`)
- LLM timeout clarifier (`effectiveCandidatesTimeout`)
- LLM disabled fallback clarifier (`effectiveCandidatesFallback`)

### 16. Telemetry Status Alignment (2026-03-08)

**File**: `lib/chat/routing-dispatcher.ts` (`attachClarifierReorderTelemetry`)

The pure function `computeClarifierReorderTelemetry` always emits `shadow_reordered` (it has no knowledge of the active flag). Per `semantic-memory-clarifier-assist-plan.md` §6a line 119, active-mode runs should emit `reordered`, not `shadow_reordered`. Fix: `attachClarifierReorderTelemetry` upgrades `shadow_reordered` → `reordered` when `clarifierReorderActive` is true.

Note: all prior active-mode telemetry (batches on 2026-03-08) was logged as `shadow_reordered`. This is a cosmetic telemetry label fix, not a behavioral change.

### 15. Embedding Timeout Increase (2026-03-08)

**File**: `lib/chat/routing-log/embedding-service.ts`

Changed `EMBEDDING_TIMEOUT_MS` from 1200 to 1500. Rationale: "show budget" and "bring up budget" intermittently hit `timeout_or_error` with latencies of 1217–1242ms — just over the 1200ms ceiling. The 1500ms threshold accommodates observed OpenAI API latency jitter while staying under the 2000ms client-side timeout (`MEMORY_SEMANTIC_READ_TIMEOUT_MS`). Validated: both queries cleared after the change.

---

## Files Modified

| File | Change |
|------|--------|
| `lib/chat/routing-dispatcher.ts` | B2 status capture, dispatchRoutingInner params, clarifier telemetry wiring (4+2 sites), selection correlation wrapper (15+ replacements), B1 guard, log payload serialization, type boundary fix (`ReorderableCandidate`), selection correlation propagation at 2 intercept return sites, widget-context correlation at 2 Tier 3.5 sites, `bindGroundingClarifierOptions` first-time candidate fallback via `reconstructSnapshotData` |
| `lib/chat/routing-log/payload.ts` | Added `b2_clarifier_*` fields + selection correlation fields |
| `app/api/chat/routing-log/route.ts` | Extended `semanticHintMeta` JSON builder for Phase 3c fields |
| `lib/chat/panel-command-matcher.ts` | First-character guard for distance-2 fuzzy matches; badge letter "a" stopword preservation |
| `lib/chat/chat-routing-panel-disambiguation.ts` | Return `clarifierMessageId` + `clarifierCandidates` from multi-match path |
| `lib/chat/chat-routing-types.ts` | Added `clarifierMessageId`, `clarifierCandidates` to `PanelDisambiguationHandlerResult` |
| `lib/chat/routing-log/embedding-service.ts` | `EMBEDDING_TIMEOUT_MS` 1200→1500 (B2 latency jitter fix) |
| `.env.local` | Added `NEXT_PUBLIC_CHAT_ROUTING_SEMANTIC_CLARIFIER_ASSIST_ENABLED=true`, `NEXT_PUBLIC_CHAT_ROUTING_SEMANTIC_CLARIFIER_REORDER_ACTIVE=true` |

## Files Created

| File | Description |
|------|-------------|
| `lib/chat/routing-log/clarifier-reorder.ts` | Pure reorder function + `computeClarifierReorderTelemetry` |
| `__tests__/unit/routing-log/clarifier-telemetry.test.ts` | 12 unit tests for all 7 status values |

---

## Test Results

### Type-Check
```
npm run type-check -> 1 error (pre-existing syntax error in use-panel-close-handler.test.tsx:87)

IMPORTANT: This syntax error causes tsc to skip the entire check phase (Check time: 0.00s).
Actual type checking requires excluding that file:
  npx tsc --noEmit -p tsconfig.check.json -> 0 routing-dispatcher errors
  (957 pre-existing errors in other files, unrelated to this work)
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

- panel-command-matcher.test.ts: 47/47 passed
  - Includes regression test: "show budget" does NOT match Widget Manager
  - Badge letter "a" preservation: 5 new tests (trailing "a" kept, mid-position "a" stripped)
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

### Badge Letter "a" Stopword Fix

**Before**: "open links panel" with Panels A/B/C → single-option clarifier for Links Panel A only (badge "a" stripped, false exact match)

**After**: Two correct behaviors observed:

| Input | Route | Badge | Options |
|-------|-------|-------|---------|
| `links panel` | Tier 2c `panel_disambiguation_pre_llm` | Safe Clarifier | A, B, C |
| `open links panel` | Tier 4 known-noun → Tier 4.5 grounding LLM | LLM-Influenced | A, B, C |

Debug log confirms:
- `panel_disambiguation_pre_llm`: matchType=partial, matchCount=3 for "links panel"
- `known_noun_command_execute`: "open links panel" → quick-links (generic) → falls to grounding LLM
- `grounding_llm_need_more_info`: LLM correctly identifies all 3 panels

### Panel Disambiguation Telemetry + Selection Correlation (End-to-End)

"links panel" → Safe Clarifier (A/B/C) → user types "2" → "Opening Links Panel B..." Deterministic.

**Clarifier row** ("links panel"):
| Field | Value |
|-------|-------|
| `b2_clarifier_status` | `no_b2_empty` |
| `b2_clarifier_message_id` | `assistant-1772841665476` |
| `b2_clarifier_option_ids` | `["9add1baf-...", "2567b058-...", "f0b39336-..."]` |

**Selection row** ("2"):
| Field | Value |
|-------|-------|
| `clarifier_origin_message_id` | `assistant-1772841665476` |
| `selected_option_id` | `2567b058-...` (Links Panel B) |

**Correlation confirmed**: `clarifier_origin_message_id` on selection row = `b2_clarifier_message_id` on clarifier row. `selected_option_id` is the 2nd element in `b2_clarifier_option_ids` — matches user selecting option 2.

### Fuzzy Match Fix

**Before**: "show budget" -> normalized to `{show, widget}` -> matched Widget Manager -> single-option clarifier "Which option did you mean? Widget Manager?"

**After**: "budget" no longer fuzzy-matches "widget" (different first char) -> falls through to navigate API -> finds budget100/budget200 -> multi-option clarifier

---

## Investigation Trail (B1 Guard)

The B1 guard required four iterations to get right:

1. **First attempt**: `!ctx.lastClarification` — failed because widget-context grounding clarifiers clear `lastClarification` (line 918) and use `widgetSelectionContext` instead
2. **Diagnosis**: DB showed `has_last_clarification: false` for all ordinal inputs. Debug log showed `clarification_bypass_widget_context` confirming the widget path
3. **Second fix**: `!!ctx.lastClarification || !!ctx.widgetSelectionContext` — covers both chat-origin and widget-context clarifiers, ordinals ("2") correctly route to Deterministic
4. **Regression**: Guard was too broad — `!!ctx.widgetSelectionContext` blocks B1 for ALL queries during the 2-turn TTL window. "open links panel b" skipped B1, fell through tier chain, produced single-option clarifier instead of auto-execute
5. **Final fix**: Narrowed guard to three-part condition: `hasActiveSelectionContext && inputIsSelectionLike && !b1InputLooksLikeNewCommand`. Uses `isSelectionLike()` to gate on ordinal-type inputs, and `ACTION_VERB_PATTERN + !isSelectionOnly` escape to let commands ("open links panel b") through to B1

Key evidence from debug logs:
- `grounding_clarifier_widget_context` at line 924: confirms clarifier built via widget path
- `universal_resolver_widget_selection` at tier 3.5: confirms ordinals resolved by widget resolver after B1 skipped
- `clarification_bypass_widget_context`: informational log, not blocking (fires after widget resolver handles)

---

## Known Gaps (Deferred)

### 1. ~~Selection Correlation for Widget-Context Clarifiers~~ (Resolved)

~~Widget-context clarifiers clear `lastClarification` (line 918), so `wrappedHandleSelectOption` reads `ctx.lastClarification?.messageId` as null.~~

**Fixed**: `wrappedHandleSelectOption` (line 1444) now falls back to `ctx.widgetSelectionContext?.optionSetId` when `ctx.lastClarification?.messageId` is null. Widget-context selections correctly populate `clarifier_origin_message_id`.

### 2. ~~Server-Side Clarifier Telemetry~~ (Resolved)

~~Navigate API responses that return selectable options do not go through `dispatchRoutingInner`.~~

**Fixed**: Server-side clarifier telemetry computed at the `stored_pending_options` path in `chat-navigation-panel.tsx`. Message ID contract unified to single `serverClarifierMsgId`. Widget-context selection correlation added at Tier 3.5 universal resolver sites (`universal_resolver_widget`, `universal_resolver_chat_widget_option`). First-time grounding LLM candidate fix ensures `pendingOptions`/`lastClarification` are populated via `reconstructSnapshotData` fallback.

**Soak validated** (2026-03-07):
| Row | Query | `cl_msg_id` | `origin_msg` | `sel_id` |
|-----|-------|-------------|-------------|----------|
| "show budget" | routing_attempt | `assistant-1772847952654` | — | — |
| "2" | routing_attempt | — | `assistant-1772847952654` | `98cec0f2-...9074` |
| "2" | execution_outcome | — | `assistant-1772847952654` | `98cec0f2-...9074` |

Correlation confirmed: `origin_msg` on selection rows = `cl_msg_id` on clarifier row.

### 3. B2 Clarifier Assist Coverage (Updated 2026-03-08)

Seed strategy: B1-safe via fake `context_fingerprint` (`active_panel_count: 99`), so B1 exact lookup misses but B2 cosine finds the entry at ~1.0. Seed script: `scripts/seed-shadow-reorder-fixture.ts` (supports `--batch shadow`, `--batch active`, `--batch all`).

#### Shadow-mode validation (2026-03-07)

12/12 shadow_reordered, 12/12 selection correlation (100%). Controlled soak with shadow batch queries (show, display, open, bring up, view, check, pull up, find, go to, look at, see, get budget). All had `b2_clarifier_top_match_rank: 2` (budget200 promoted from rank 2).

#### Active-mode validation (2026-03-08)

**Batch 1** (12 queries, `EMBEDDING_TIMEOUT_MS=1200`, before telemetry label fix):
- 11/12 reordered (logged as `shadow_reordered` — stale label, see item 16), 11/11 selection correlation on reordered turns
- 1 failure: "show budget" → `no_b2_error` (`b2_status: timeout_or_error`, latency 1218ms)
- "bring up budget" also hit `no_b2_error` in a prior run (latency 1217ms)

**Root cause investigation**: Both failures had latencies 17–29ms over the 1200ms `EMBEDDING_TIMEOUT_MS` ceiling. Not query-specific — an intermittent B2 embedding API latency issue. Fix: raised `EMBEDDING_TIMEOUT_MS` to 1500 in `embedding-service.ts`.

**Post-fix single test** ("show budget" only, before telemetry label fix):
- Reordered at 1242ms latency (logged as `shadow_reordered` — stale label) — would have failed under old 1200ms ceiling
- Selection confirmed budget200 via follow-up execution_outcome row

**Sanity batch** (5 queries, `EMBEDDING_TIMEOUT_MS=1500`, before telemetry label fix):

| # | Query | B2 Status (logged) | B2 Status (correct) | Rank | Latency | Selected |
|---|-------|---------------------|----------------------|------|---------|----------|
| 1 | show budget | shadow_reordered | reordered | 2→1 | 1319ms | budget200 |
| 2 | bring up budget | shadow_reordered | reordered | 2→1 | 476ms | budget200 |
| 3 | display budget | shadow_reordered | reordered | 2→1 | 995ms | budget200 |
| 4 | open budget | shadow_reordered | reordered | 2→1 | 267ms | budget200 |
| 5 | find budget | shadow_reordered | reordered | 2→1 | 364ms | budget200 |

5/5 reordered, 5/5 selection correlation. Both previously flaky queries (show budget, bring up budget) cleared.

**Note**: All active-mode rows above were logged before the telemetry label fix (item 16). They carry `shadow_reordered` in the DB. Post-fix runs should emit `reordered`. Pending one post-fix validation query.

#### Decision

Phase 3c active reorder validated in dev. Remains behind `NEXT_PUBLIC_CHAT_ROUTING_SEMANTIC_CLARIFIER_REORDER_ACTIVE` flag until broader rollout confidence.

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

1. ~~**Selection correlation for widget-context clarifiers**~~: Resolved (2026-03-06)
2. **Server-side clarifier telemetry**: Add Phase 3c telemetry at `stored_pending_options` path in `chat-navigation-panel.tsx`
3. ~~**Shadow soak for `shadow_reordered`**~~: Proven — 12/12 shadow_reordered, 12/12 selection correlation (2026-03-07)
4. ~~**Active-mode validation**~~: Validated — 11/12 batch + 5/5 sanity batch after timeout fix (2026-03-08)
5. ~~**Embedding timeout fix**~~: `EMBEDDING_TIMEOUT_MS` 1200→1500, both flaky queries cleared (2026-03-08)
6. **Seed cleanup**: Run `npx tsx scripts/seed-shadow-reorder-fixture.ts --cleanup --batch all` when no longer needed
7. **Stage 4 — Bounded LLM Optimize**: Next main-plan stage per `multi-layer-routing-reliability-plan-v3_5.md` §12 item 4. LLM selector over validator-approved candidates.
