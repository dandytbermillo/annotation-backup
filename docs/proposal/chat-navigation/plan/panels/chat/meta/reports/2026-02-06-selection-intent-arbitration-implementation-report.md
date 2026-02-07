# Selection Intent Arbitration (Focus Latch Model) — Implementation Report

**Date**: 2026-02-06
**Feature slug**: `selection-intent-arbitration`
**Plan**: `docs/proposal/chat-navigation/plan/panels/chat/meta/selection-intent-arbitration-incubation-plan.md`
**Commit**: `123ed653` (`still fixing the issue`)
**Feature flag**: `NEXT_PUBLIC_SELECTION_INTENT_ARBITRATION_V1=true`

---

## Summary

Implemented the focus-latch model from the incubation plan to resolve ambiguous selection input (ordinals, labels) when both chat clarifier options and widget lists are visible. The core problem: after opening a panel from a chat clarifier, follow-up ordinals ("open second one") resolved against the stale chat options instead of the now-visible widget items.

The implementation spans 8 phases covering: widget ID mapping integrity (Phase 0), focus latch state management (Phase 1), early snapshot building (Phase 2), latch-aware clarification intercept (Phase 3), grounding-set latch-aware resolution (Phase 4), latch-on signals (Phase 5), latch-off signals (Phase 6), and feature flag + observability (Phase 7).

---

## Root Cause Analysis

### Problem
After selecting a panel from a chat clarifier (e.g., "links panel" → [Links Panels, Links Panel D, Links Panel E] → "open second one" → Opens Links Panel D), subsequent ordinal inputs kept resolving against the stale clarification snapshot instead of the newly-visible widget items.

### Root Causes Identified (iterative debugging)

1. **Panel-drawer selections never set focus latch**: The `trySetWidgetLatch` helper was only called on `widget_option` resolution paths, not on `panel_drawer` selections. After opening a panel from a clarifier, `focusLatch` remained null.

2. **Stale `clarificationSnapshot` persisted as competing context**: When `handleSelectOption` processes a clarifier selection, it calls `saveClarificationSnapshot()` before clearing `lastClarification`. This snapshot persisted and its post-action ordinal window caught subsequent ordinals before they could reach Tier 4.5.

3. **Tier 2b cross-corpus caught selection-like ordinals**: Even when the post-action ordinal window correctly deferred (via `isLatchOrPreLatch` guard), the input fell through to Tier 2b cross-corpus retrieval which interpreted "second one" as a new search intent, returning "I found results in both documentation and your notes."

4. **`totalListSegmentCount === 1` too strict for dashboards**: The strict Rule 12 check never fires on dashboards with multiple widget panels (commonly `totalListSegmentCount: 4`). Required relaxation using `activeSnapshotWidgetId` (Phase 0 resolved focus signal).

5. **React state update timing**: `setFocusLatch()` in the intercept is a React state setter — the latch doesn't propagate to `ctx.focusLatch` in the dispatcher during the same execution cycle. Required using `turnSnapshot.activeSnapshotWidgetId` as a synchronous signal for the Tier 2b skip.

### Fix Strategy (User's fix targets)

1. **Set focus latch when pre-latch defers in post-action ordinal window** — promotes pre-latch → latch so subsequent ordinals bypass the intercept entirely via the latch bypass block
2. **Clear `clarificationSnapshot` when deferring** — demotes competing chat disambiguation context so the snapshot doesn't catch future ordinals
3. **Add `skipCrossCorpusForFocusLatch` to Tier 2b** — prevents cross-corpus retrieval from intercepting selection-like ordinals when a widget has focus

---

## Files Modified (14 files, +892 / -180 lines)

### Runtime Code

| File | Phase | Changes |
|------|-------|---------|
| `lib/widgets/ui-snapshot-registry.ts` | 0a | Added `panelId?: string` to `WidgetSnapshot` interface; validated in `validateSnapshot` |
| `components/dashboard/widgets/QuickLinksWidget.tsx` | 0b | Added `panelId: panel.id` to snapshot registration |
| `components/dashboard/widgets/RecentWidget.tsx` | 0b | Added `panelId: panel.id` to snapshot registration |
| `components/dashboard/panels/RecentPanel.tsx` | 0b | Added `panelId: panel.id` to snapshot registration |
| `lib/chat/ui-snapshot-builder.ts` | 0c, 2e | UUID→slug resolution for `activeSnapshotWidgetId`; `listSegmentCount` per widget |
| `lib/chat/chat-navigation-context.tsx` | 1 | `FocusLatchState` type + `FOCUS_LATCH_TTL`; state + handlers (`setFocusLatch`, `suspendFocusLatch`, `incrementFocusLatchTurn`, `clearFocusLatch`); wired into context provider |
| `lib/chat/input-classifiers.ts` | 3b | **New file** — extracted `isExplicitCommand()` from `routing-dispatcher.ts` to avoid circular dependency |
| `lib/chat/routing-dispatcher.ts` | 2, 4e, 5, 7 | Feature flag, early snapshot build, `isPreLatchDefault()` helper, `trySetWidgetLatch()` helper, latch-on at all widget resolution paths, `skipCrossCorpusForFocusLatch`, Tier 3a latch guards, Tier 4.5 `activeWidgetId` determination, try/finally TTL increment, observability logs |
| `lib/chat/chat-routing.ts` | 2f, 3, 6b | `ClarificationInterceptContext` expanded (latch fields + `activeSnapshotWidgetId`), `getRecoverableChatOptions()` helper, post-action ordinal guard with pre-latch promotion + snapshot clearing, bare ordinal guard update, chat re-anchor (Rule 3), selection-like bypass (Rules 2/4/6), stop latch-off (Phase 6b), diagnostic console.logs |
| `lib/chat/grounding-set.ts` | 4 | `listSegmentCount` on `OpenWidgetState`, `activeWidgetId` option on `handleGroundingSetFallback()`, multi-list ambiguity skip when `activeWidgetId` set, Step 2.5 scoped to active widget |
| `lib/chat/known-noun-routing.ts` | 6e | `clearFocusLatch` on `KnownNounRoutingContext`; called during context-clear on panel switch |
| `components/chat/chat-navigation-panel.tsx` | 1e | Wired latch fields (`focusLatch`, `setFocusLatch`, `suspendFocusLatch`, `incrementFocusLatchTurn`, `clearFocusLatch`) to dispatcher call |

### Documentation

| File | Changes |
|------|---------|
| `docs/proposal/chat-navigation/plan/panels/chat/meta/selection-intent-arbitration-incubation-plan.md` | Updated incubation plan with refined rules and acceptance tests |
| `docs/proposal/chat-navigation/plan/panels/chat/meta/known-vs-doc-routing-general-plan.md` | New plan document (general routing) |

---

## Phase-by-Phase Implementation Details

### Phase 0: Active Widget ID Mapping Integrity

**Goal**: Ensure `activeSnapshotWidgetId` resolves to a widget slug (e.g., `w_links_d`) instead of a dashboard panel UUID.

- **`ui-snapshot-registry.ts:74`**: Added `panelId?: string` to `WidgetSnapshot` interface
- **`ui-snapshot-registry.ts:212`**: Validated `panelId` in `validateSnapshot()`
- **3 widget components**: Pass `panelId: panel.id` during registration
- **`ui-snapshot-builder.ts:103+`**: Resolves `getActiveWidgetId()` (may return panel UUID) → widget slug via direct match then `panelId` fallback
- **`ui-snapshot-builder.ts:93`**: Count `listSegmentCount` per widget for Rule 12 segment-level counting

### Phase 1: FocusLatchState Type + Context

**`chat-navigation-context.tsx`**:
```typescript
export interface FocusLatchState {
  widgetId: string       // Widget slug from registry
  widgetLabel: string    // Human-readable label
  latchedAt: number      // Timestamp
  turnsSinceLatched: number
  suspended?: boolean    // True when scope switched to chat via re-anchor
}
export const FOCUS_LATCH_TTL = 5
```

State handlers: `setFocusLatch`, `suspendFocusLatch`, `incrementFocusLatchTurn`, `clearFocusLatch` — all follow `WidgetSelectionContext` pattern.

### Phase 2: Move `buildTurnSnapshot()` Early + Infrastructure

- **Moved** `buildTurnSnapshot()` from before Tier 4 to before the intercept call (~line 1020)
- **Latch validity check**: If latched widget no longer in `turnSnapshot.openWidgets`, auto-clear latch
- **TTL increment**: try/finally wrapper around all tier routing guarantees `incrementFocusLatchTurn()` runs on every return path
- **`listSegmentCount`** added to `OpenWidgetState` and `TurnSnapshotResult`
- **`ClarificationInterceptContext`** expanded with: `focusLatch`, `setFocusLatch`, `suspendFocusLatch`, `clearFocusLatch`, `hasVisibleWidgetItems`, `totalListSegmentCount`, `lastOptionsShown`, `isLatchEnabled`, `activeSnapshotWidgetId`

### Phase 3: Latch-Aware Clarification Intercept

**`chat-routing.ts`** — 5 new blocks in the intercept:

1. **Chat Re-Anchor (Rule 3)** — `CHAT_REANCHOR_PATTERN` detection while latched:
   - "back to options" / "from earlier options" → `suspendFocusLatch()` + restore chat options via `getRecoverableChatOptions()` helper
   - No recoverable options → "No earlier options available."

2. **Selection-Like Bypass (Rules 2, 4, 6)** — when latch active:
   - Classifies input: `isSelectionLike`, `isExplicitCommand`, `hasQuestionIntent`
   - Pure selection-like → returns `handled: false` (Tier 4.5 resolves)
   - Command → logs `focus_latch_bypassed_command`, falls through
   - Question → logs `focus_latch_bypassed_question_intent`, falls through

3. **Post-Action Ordinal Guard** — non-paused `clarificationSnapshot`:
   - `isLatchOrPreLatch` check: active latch OR `activeSnapshotWidgetId` set (pre-latch)
   - **Fix target #1**: Pre-latch promotion — `setFocusLatch()` on active widget
   - **Fix target #2**: `clearClarificationSnapshot()` — demotes competing context
   - Falls through to Tier 4.5

4. **Bare Ordinal Guard Update** — skip when `hasActiveLatch` or `isPreLatchSingleList`

5. **Stop Latch-Off (Phase 6b)** — `clearFocusLatch()` at 3 stop/cancel paths

### Phase 4: Grounding-Set Latch-Aware Resolution

**`grounding-set.ts`**:

- `handleGroundingSetFallback()` accepts `activeWidgetId?: string` option
- When `activeWidgetId` set: skip `checkMultiListAmbiguity()` (Rule 2 + Test 9)
- Step 2.5 scopes to active widget list instead of first-in-list default

**`routing-dispatcher.ts`** — Tier 4.5 `activeWidgetId` determination:
```typescript
if (focusLatch active) → activeWidgetId = focusLatch.widgetId          // Rules 2, 6
else if (isPreLatchDefault strict) → activeSnapshotWidgetId ?? first list widget  // Rule 12 strict
else if (activeSnapshotWidgetId + no chat + selection-like) → activeSnapshotWidgetId  // Relaxed pre-latch
// else: no activeWidgetId → multi-list ambiguity fires normally
```

### Phase 5: Latch-On Signals

**`trySetWidgetLatch()` helper** (defined at `routing-dispatcher.ts:1047`) — called at ALL widget resolution return paths:
- `routing-dispatcher.ts:1666` — Tier 3a selection-only widget_option
- `routing-dispatcher.ts:1746` — Tier 3a label-match widget_option
- `routing-dispatcher.ts:2207` — Tier 3.5 universal resolver widget execute
- `routing-dispatcher.ts:2245` — Tier 3.5 universal resolver chat widget_option
- `routing-dispatcher.ts:2487` — Tier 3.6 LLM chat widget_option
- `routing-dispatcher.ts:2756, 2788` — Tier 4.5 grounding deterministic select (2 paths)
- `routing-dispatcher.ts:2834` — Tier 4.5 grounding widget item execute
- `routing-dispatcher.ts:2930, 2962` — Tier 4.5 grounding LLM select (2 paths)
- `routing-dispatcher.ts:3048` — Tier 4.5 grounding LLM widget item execute
- **`chat-routing.ts:2223`** — Post-action ordinal pre-latch promotion (NEW in this session)

### Phase 6: Latch-Off Signals

| Signal | Location | Mechanism |
|--------|----------|-----------|
| Widget no longer visible | `routing-dispatcher.ts:1072` | Auto-clear on snapshot build |
| Stop/cancel (4 paths) | `chat-routing.ts:2319, 2845, 2920, 2992` | `clearFocusLatch()` |
| Chat re-anchor | `chat-routing.ts:2433` | `suspendFocusLatch()` (not clear) |
| TTL expiry | `routing-dispatcher.ts:3388` (finally block) | `incrementFocusLatchTurn()` → auto-null at TTL |
| Panel switch (known-noun) | `known-noun-routing.ts:512` | `clearFocusLatch?.()` |

Note: The post-action ordinal defer (`chat-routing.ts:2233`) calls `clearClarificationSnapshot()` which demotes competing chat context (Fix target #2) but is not itself a latch-off signal — the latch remains active/gets promoted.

### Phase 7: Feature Flag + Observability

- **Feature flag**: `NEXT_PUBLIC_SELECTION_INTENT_ARBITRATION_V1=true` — checked once at top of `dispatchRouting()`. When false, all latch fields are null/no-op.
- **Observability logs** per incubation plan §Observability:
  - `focus_latch_set`, `focus_latch_cleared`, `focus_latch_applied`
  - `focus_latch_bypassed_command`, `focus_latch_bypassed_question_intent`
  - `selection_input_classified`, `selection_context_candidates_built`
  - `selection_dual_source_llm_attempt`, `selection_dual_source_llm_result`
  - `selection_clarifier_llm_generated`, `selection_clarifier_llm_fallback_template`
  - `post_action_ordinal_deferred_to_widget`
  - `skip_cross_corpus_widget_context` (with `focus_latch_or_prelatch_active_and_selection_like` reason)

---

## Tier 2b Cross-Corpus Skip (Critical Fix)

**Problem**: After the post-action ordinal guard correctly deferred ordinal input, Tier 2b cross-corpus retrieval caught "second one" as a new search intent before Tier 4.5 could resolve it against widget items.

**Fix** (`routing-dispatcher.ts:1194-1214`):
```typescript
const skipCrossCorpusForFocusLatch = isLatchEnabled
  && isSelectionLike(ctx.trimmedInput)
  && !hasQuestionIntent(ctx.trimmedInput)
  && !isExplicitCommand(ctx.trimmedInput)
  && (
    (ctx.focusLatch && !ctx.focusLatch.suspended)          // Active latch
    || ((!ctx.focusLatch || ctx.focusLatch.suspended)      // Pre-latch
      && !!turnSnapshot.activeSnapshotWidgetId
      && !ctx.lastClarification?.options?.length)
  )
```

Uses `turnSnapshot.activeSnapshotWidgetId` (synchronous) instead of `ctx.focusLatch` (React state, may be stale when intercept just set it via `setFocusLatch`).

---

## Tier 3a Selection Guard (Two Branches)

Both Tier 3a branches now have latch/pre-latch guards:

**Primary** (`routing-dispatcher.ts:1635`):
```typescript
if (ctx.pendingOptions.length > 0 && ctx.activeOptionSetId !== null
    && !hasQuestionIntent(ctx.trimmedInput) && !ctx.widgetSelectionContext
    && !hasActiveFocusLatch && !isPreLatchWidgetScope) {
```

**Fallback** (`routing-dispatcher.ts:1921`):
```typescript
if (ctx.pendingOptions.length === 0 && ctx.activeOptionSetId !== null
    && !hasQuestionIntent(ctx.trimmedInput)
    && !hasActiveFocusLatch && !isPreLatchWidgetScope) {
```

Where `isPreLatchWidgetScope` uses `isPreLatchDefault()` OR `activeSnapshotWidgetId` (relaxed), gated by `isSelectionLike()`.

---

## Shared Utility Extraction

**`lib/chat/input-classifiers.ts`** (new file) — `isExplicitCommand()` extracted from `routing-dispatcher.ts` to avoid circular dependency when `chat-routing.ts` imports it for latch bypass guards. Re-exported from `routing-dispatcher.ts` for backward compatibility.

---

## Functions Reused

| Function | File:Line | Used For |
|----------|-----------|----------|
| `isSelectionLike()` | `grounding-set.ts:248` | Latch bypass gate, Tier 2b/3a skip |
| `isExplicitCommand()` | `input-classifiers.ts:21` | Command guard for latch bypass |
| `hasQuestionIntent()` | `query-patterns.ts:352` | Question guard for latch bypass |
| `isSelectionOnly()` | `chat-routing.ts:1190` | Post-action ordinal detection |
| `buildTurnSnapshot()` | `ui-snapshot-builder.ts:60` | Registry reader (moved early) |
| `checkMultiListAmbiguity()` | `grounding-set.ts:395` | Skipped when activeWidgetId set |
| `handleGroundingSetFallback()` | `grounding-set.ts:572` | Extended with activeWidgetId option |
| `getActiveWidgetId()` | `ui-snapshot-registry.ts` | Phase 0 raw focus signal |

---

## Expected Behavior After Fix

### Happy Path: Panel-drawer → Widget Ordinal

1. **"links panel"** → Clarifier: [Links Panels, Links Panel D, Links Panel E]
2. **"open second one"** → Intercept: Tier 1b.3a ordinal → selects Links Panel D → opens panel → `saveClarificationSnapshot()` → `setLastClarification(null)`
3. **"open second one"** (or **"open the second one"**) →
   - Intercept: post-action ordinal window → `isLatchOrPreLatch` = true (`activeSnapshotWidgetId` set)
   - **NEW**: `setFocusLatch({ widgetId: activeSnapshotWidgetId })` (pre-latch promotion)
   - **NEW**: `clearClarificationSnapshot()` (demote competing context)
   - Falls through → Dispatcher: `skipCrossCorpusForFocusLatch` = true → Tier 2b SKIPPED → Tier 4.5 resolves "second" against widget items → **"Opening entry 'summary 155 D'"**
4. **"open second one"** (subsequent) →
   - Intercept: `isLatchActive` = true → latch bypass → returns `handled: false` immediately
   - Dispatcher: `skipCrossCorpusForFocusLatch` = true → Tier 4.5 resolves

### "the" Is Irrelevant

Both "open second one" and "open the second one" follow identical paths because:
- `isSelectionLike()` returns true for both (ORDINAL_WORDS matches "second")
- `isExplicitCommand()` returns false for both (ordinal bypass)
- `isSelectionOnly()` returns `{ isSelection: true, index: 1 }` for both (via `extractOrdinalFromPhrase`)
- The fix operates on state/tier routing, not on input wording

---

## Diagnostic Console Logs (To Be Removed)

Three `[LATCH_DIAG]` traces remain for testing verification:
- `chat-routing.ts:1465` — `intercept_entry` (all state on every intercept call)
- `chat-routing.ts:2028` — `post_action_ordinal_window_entered`
- `chat-routing.ts:2196` — `post_action_ordinal_guard` (guard values)

**Action**: Remove after verifying the fix works in manual testing.

---

## Verification

### Type-Check
```bash
$ npx tsc --noEmit
# Only pre-existing test file error: __tests__/unit/use-panel-close-handler.test.tsx(87,1)
# Zero errors in runtime code
```

### Manual Test Plan (per incubation plan acceptance tests)

| Test | Description | Status |
|------|-------------|--------|
| 0 | Panel UUID → correct `activeSnapshotWidgetId` slug | Implemented |
| 1 | Open widget → "second one" → widget item (no clarifier) | Implemented |
| 2 | Engage widget → "summary155" → direct match | Implemented |
| 3 | While latched, "back to options" → chat list restored | Implemented |
| 3a | While latched, "back to options" no chat → "No earlier options" | Implemented |
| 4 | While latched, "open recent" → command executes | Implemented |
| 5 | While latched, "what does summary144 mean?" → answer | Implemented (question bypasses latch) |
| 6 | Widget miss → fallback ladder | Implemented |
| 9 | Latch active + multiple lists → latched widget wins | Implemented |

### Tested Scenarios (from debugging sessions)

- "open second one" after panel-drawer selection: **Works** (Image 1, step 3 → "Opening entry 'summary 155 D'")
- "open recent" after latch → "open second one": **Works** (Image 3, step 5 → "Opening entry 'sample2'")
- "open the second one" after panel-drawer selection: **Fix applied** (previously failed due to stale snapshot + Tier 2b interception)

---

## Known Issues / TODOs

1. **Diagnostic logs**: Three `console.log('[LATCH_DIAG]...')` traces need removal after fix verification
2. **Widget label on pre-latch promotion**: `widgetLabel` is set to the widget slug (e.g., "w_links_d") instead of the human-readable label. The dispatcher resolves the correct label on subsequent turns.
3. **Latch not set on initial panel-drawer open**: The latch is set on the FIRST ordinal after panel open (pre-latch promotion), not proactively when the panel opens. This is because `handleSelectOption` for `panel_drawer` type doesn't know whether the panel will have widget items until it renders. The pre-latch promotion approach handles this.

---

## Risks / Limitations

- **Feature flag dependency**: All behavior gated behind `NEXT_PUBLIC_SELECTION_INTENT_ARBITRATION_V1=true`. When flag is false, no behavioral change.
- **React state timing**: `setFocusLatch()` in the intercept doesn't propagate to the dispatcher in the same cycle. Mitigated by using `turnSnapshot.activeSnapshotWidgetId` as a synchronous signal.
- **TTL of 5 turns**: Focus latch expires after 5 turns without widget engagement. May need tuning based on user behavior.

---

## Next Steps

1. Remove diagnostic `[LATCH_DIAG]` console.logs after manual verification
2. Schedule feature flag removal once stable (`NEXT_PUBLIC_SELECTION_INTENT_ARBITRATION_V1`)
3. Consider proactive latch-on at panel-drawer open (currently reactive on first ordinal)
4. Monitor observability logs for unexpected `focus_latch_bypassed_*` patterns
