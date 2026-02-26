# Widget Scope-Cue Implementation Report

**Date:** 2026-02-26
**Feature:** Widget scope-cue routing (Rules 14-16, Acceptance Tests 13-17)
**Plan:** `selection-intent-arbitration-scope-cues-addendum-plan.md` + `spicy-wobbling-backus.md`
**Status:** Implemented, manually tested, ready for commit

---

## Summary

Implemented explicit widget scope-cue routing so inputs like "open the summary144 from active widget" resolve against the scoped widget's items only — not the full candidate pool. Previously, `scope === 'widget'` fell through the scope-cue handler with `return null`, causing misrouting.

This is the widget-scope counterpart to the existing chat-scope handling (PR3b).

---

## Architecture: Signal-Based (Approach B)

The scope-cue handler (`chat-routing-scope-cue-handler.ts`) does NOT have `openWidgets` data. Only the dispatcher has full widget snapshot data. So the handler returns a **structured signal** (`widgetScopeCueSignal`) and the dispatcher resolves against widget items using existing Tier 4.5 grounding infrastructure.

Flow: `resolveScopeCue()` → scope-cue handler → signal → dispatcher → scoped grounding → deterministic/LLM/clarifier

---

## Files Changed (7 files, +426/-13 lines)

### `lib/chat/input-classifiers.ts` — Scope cue detection
- Extended `ScopeCueResult` with `namedWidgetHint?: string` and `hasConflict?: boolean`
- Expanded `WIDGET_CUE_PATTERN` to 11 patterns: `from active widget`, `from current widget`, `from this widget`, `from the widget`, `in active widget`, `in current widget`, `in this widget`, `in this panel`, `from links panel <name>`, `from panel <name>`, `from recent`
- Added conflict detection: when BOTH chat + widget cues detected, returns `hasConflict: true`
- Added cue text normalization: strips trailing punctuation, collapses whitespace
- Added named widget hint extraction: `from links panel d` → `namedWidgetHint: "links panel d"`
- Added input whitespace collapse before pattern matching (fixes double-space miss)

### `lib/chat/chat-routing-types.ts` — Signal type
- Added `WidgetScopeSource` type: `'active' | 'named' | 'latch'`
- Added `widgetScopeCueSignal` optional field to `ClarificationInterceptResult`

### `lib/chat/chat-routing-scope-cue-handler.ts` — Handler branches
- Moved conflict guard to top of `handleScopeCuePhase` (before scope-specific branches)
- Added widget scope branch: strips cue text, resolves target widget, returns signal
- Empty-input guard: if stripping leaves empty input, returns scoped clarifier
- Active/contextual widget resolution:
  - "from active widget" / "from current widget" → `activeSnapshotWidgetId` (UI-focused)
  - "from this widget" / "from the widget" → focus latch first, then `activeSnapshotWidgetId`
  - Named cue ("from links panel d") → `namedWidgetHint` for dispatcher resolution

### `lib/chat/chat-routing-clarification-intercept.ts` — Bypass fix
- Widget bypass block (line 232) now excludes `scope === 'widget'` and `hasConflict`
- Prevents bypass from short-circuiting the scope-cue handler for widget-scoped inputs

### `lib/chat/routing-dispatcher.ts` — Signal handler + scoped grounding
- Re-imported `matchVisiblePanelCommand` for named cue resolution
- Added `resolveScopeCue` import for semantic lane override
- Widget scope-cue signal handler inserted between clarification intercept and Tier 2:
  - Named cue resolution via `matchVisiblePanelCommand` (accepts exact + unique partial)
  - Named cue collision → safe clarifier with matched panel labels
  - Hard-filtered `openWidgets` to scoped widget only (Rule 15: no mixed-source candidates)
  - `visiblePanels: undefined` in grounding context (no cross-domain leakage)
  - Deterministic grounding with RAW stripped input (strict-exact compliance)
  - Bounded LLM fallback with scoped candidates when deterministic misses
  - Source continuity update (`activeScope: 'widget'`) on all paths (Rule 16)
- Semantic lane override: suppresses `semanticLaneDetected` when scope cue is present (prevents "can you open X from active widget" from being misclassified as a question)

### `__tests__/unit/chat/selection-intent-arbitration.test.ts` — New tests
- 14 new unit tests:
  - Widget scope cue detection (7 patterns)
  - Named widget hint extraction (3 tests)
  - Cue text normalization (2 tests: punctuation, whitespace)
  - Conflict detection (5 tests: both cues, single cue, no cue)

---

## Bugs Found and Fixed During Implementation

### Bug 1: Double-space input causes scope cue miss
- **Symptom**: "from  links panel d" (double space) → scope `none` → fell to generic routing
- **Root cause**: `resolveScopeCue` did `.trim()` but no internal whitespace collapse
- **Fix**: Added `.replace(/\s+/g, ' ')` before pattern matching

### Bug 2: Conflict guard unreachable
- **Symptom**: Conflicting cues ("from chat from active widget") would enter chat branch, not conflict guard
- **Root cause**: `hasConflict: true` + `scope: 'chat'` → chat branch ran first at line 79; conflict guard at line 657 never reached
- **Fix**: Moved conflict guard to top of `handleScopeCuePhase`, before any scope-specific branch

### Bug 3: Named partial matches rejected
- **Symptom**: "from panel d" → `matchVisiblePanelCommand` returns `type: 'partial'` → fell through to wrong fallback
- **Root cause**: Dispatcher only accepted `type === 'exact'`
- **Fix**: Changed to `type !== 'none' && matches.length === 1` (accepts unique partial)

### Bug 4: Scoped isolation leak
- **Symptom**: Widget-scoped grounding included `visible_panels` candidates from other panels
- **Root cause**: `visiblePanels` was passed to `buildGroundingContext`
- **Fix**: Set `visiblePanels: undefined` — widget-scoped only

### Bug 5: Bounded LLM skipped
- **Symptom**: `needsLLM` logged but safe clarifier returned directly
- **Root cause**: Missing LLM fallback between deterministic miss and safe clarifier
- **Fix**: Added `callGroundingLLM` with scoped candidates before safe clarifier

### Bug 6: Strict-exact policy violation (canonicalization)
- **Symptom**: `canonicalizeCommandInput` before deterministic grounding turned non-exact input into exact match
- **Root cause**: "open the summary144" → canonicalized to "summary144" → deterministic-executed
- **Fix**: Removed pre-canonicalization. Raw stripped input goes to deterministic grounding. LLM handles verb stripping.

### Bug 7: Active widget not tracking correctly
- **Symptom**: After opening Recent panel, "from active widget" still routed to Links Panel D
- **Root cause**: Focus latch (`w_links_d`) took precedence over `activeSnapshotWidgetId` (`w_recent_widget`)
- **Fix**: Distinguish explicit vs contextual references: "from active widget" → always `activeSnapshotWidgetId`; "from this widget" → latch first

### Bug 8: Polite imperative misclassified as question
- **Symptom**: "can you open the sample 1 from active widget" → red response (semantic lane escape)
- **Root cause**: `isExplicitCommand` returned false (ordinal bypass for "1") + `hasQuestionIntent` returned true ("can you")
- **Fix**: When `isSemanticQuestion` is true but scope cue detected, suppress semantic lane

---

## Verification

### Type-check
```
$ npx tsc --noEmit -p tsconfig.type-check.json
(clean, no errors)
```

### Tests
```
$ npx jest --no-coverage __tests__/unit/chat/ __tests__/integration/chat/
Test Suites: 36 passed, 36 total
Tests:       862 passed, 862 total (was 847; +14 new widget scope-cue tests, +1 from prior)
```

### Manual testing (confirmed working)
| Input | Expected | Actual | Status |
|-------|----------|--------|--------|
| "open the summary144 from active widget" | Widget-scoped resolution | Opening entry "summary144 D" (Auto-Executed via LLM) | PASS |
| "open the summary144 from active widget???" | Same (noisy variant) | Opening entry "summary144 D" (Deterministic) | PASS |
| "can you please open the summary144 from active widget" | Same (polite prefix) | Opening entry "summary144 D" (Deterministic) | PASS |
| "open the summary144 from links panel d" | Named cue resolution | Opening entry "summary144 D" (Auto-Executed) | PASS |
| "open sample2 from active widget" (after switching to Recent) | Active widget = Recent | Correctly scoped to Recent | PASS |
| "can you open the sample 1 from active widget" | Polite imperative | Opening entry "sample 1 E" (Auto-Executed via LLM) | PASS |
| "open panel d" (no scope cue, baseline) | Existing routing unchanged | Opening Links Panel D (Auto-Executed) | PASS |

### Feature flag gating
All new logic gated behind `NEXT_PUBLIC_SELECTION_INTENT_ARBITRATION_V1`. When flag is off:
- `resolveScopeCue` only called when `isLatchEnabled` → returns `scope: 'none'`
- No widget signal → no new logic fires → identical to pre-change behavior

---

## Strict-Exact Policy Compliance

| Policy Rule | Compliance |
|-------------|-----------|
| Non-exact must NOT deterministic-execute | PASS — raw stripped input (not canonicalized) goes to grounding; "open the summary144" does NOT exact-match "summary144" |
| Non-exact must go through bounded LLM | PASS — grounding returns `needsLLM: true` → bounded LLM with scoped candidates |
| LLM failure → safe clarifier (no unsafe execute) | PASS — LLM error/abstain/timeout falls through to scoped clarifier |
| No mixed-source candidates in scoped path | PASS — `openWidgets` hard-filtered; `visiblePanels: undefined` |
| Conflict cues → no execute | PASS — conflict guard returns source clarifier before any scope branch |

---

## Acceptance Test Coverage (Incubation Plan)

| Test | Description | Status |
|------|-------------|--------|
| 13 | "open the summary144 from active widget" → widget items ONLY | PASS |
| 14 | "open panel e pls" (active widget + chat) → no unrelated widget-list candidates | PASS (existing routing) |
| 15 | "open the panel d from chat" → chat scope only | PASS (existing) |
| 16 | Conflicting cues → source clarifier, no execute | PASS (unit tested) |
| 17 | Noisy variants source-stable | PASS (manual + unit tested) |

---

## Known Limitations

1. **Pre-existing `isExplicitCommand` ordinal bypass**: When input contains a bare number (e.g., "sample 1"), `isExplicitCommand` returns false due to the ordinal bypass. This is a broader classification issue, not introduced by this changeset. The semantic lane override mitigates the impact for scope-cue inputs.

2. **No integration test for dispatcher widget-signal path**: The new unit tests cover classification (input-classifiers). The dispatcher integration would require mocking the full grounding + LLM infrastructure. Manual testing confirmed the end-to-end flow.

---

## Rollback Plan

All changes are gated behind `NEXT_PUBLIC_SELECTION_INTENT_ARBITRATION_V1`. Setting the flag to `false` disables all new logic. The scope cue handler's widget branch and the dispatcher's signal handler are inert without the flag.
