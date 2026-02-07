# Selection Intent Arbitration — Widget-First Latch Fix

**Date:** 2026-02-07
**Feature flag:** `NEXT_PUBLIC_SELECTION_INTENT_ARBITRATION_V1=true`
**Plan file:** `/Users/dandy/.claude/plans/wiggly-juggling-haven.md`

## Summary

Fixed the intermittent ordinal hijack bug where ordinals ("open second one") resolved against stale chat disambiguation lists instead of widget items after opening a panel. Root cause: stale `clarificationSnapshot` persisted after panel opens, and the focus latch guard depended on a timing race with `activeSnapshotWidgetId`.

Post-implementation review uncovered 5 additional issues (Fixes A–E): a missing discriminant field on prelatch promotion, a cooldown path that contradicted the no-ambiguity rule, a missing integration test file, an overly broad input-swallowing guard, and a gap in test coverage (helper-level only, no dispatcher-level). All fixed and verified with 196 passing tests across 6 suites.

## 6 Principles Applied

1. **Single owner** — selection arbitration happens once, before Tier 3a stale-chat paths
2. **Hard invariant** — if latch is resolved or pending, Tier 3a chat ordinal/message-derived selection is blocked
3. **State machine** — `none → pending(panelId) → resolved(widgetId) → suspended → cleared`
4. **Snapshot policy** — panel-drawer selection does not leave an ordinal-capturable stale snapshot
5. **Parser scope** — strict for stale-chat guards, embedded for looksLikeNewCommand
6. **Proof over tweaks** — 196 tests pass (28 unit + 144 existing + 20 integration race + 4 dispatcher-level)

## Changes

### Step 1: Unified ordinal parser with modes
**File:** `lib/chat/input-classifiers.ts`
- Moved `normalizeOrdinalTypos`, `ORDINAL_TARGETS` from `routing-dispatcher.ts`
- Moved `extractOrdinalFromPhrase` from `chat-routing.ts`
- Created unified `isSelectionOnly(input, count, labels, mode: 'strict' | 'embedded')`
- Deleted both local implementations from source files
- Updated 3 callsites in `routing-dispatcher.ts` (2x `'strict'`, 1x `'embedded'`)
- Updated 6 callsites in `chat-routing.ts` (all `'embedded'`)
- Removed `levenshteinDistance` imports from both files (now only used in input-classifiers.ts)

### Step 2: FocusLatchState discriminated union + proactive latch
**File:** `lib/chat/chat-navigation-context.tsx`
- Replaced flat `FocusLatchState` interface with discriminated union: `ResolvedFocusLatch | PendingFocusLatch`
- Added `getLatchId()` helper
- Gated all latch state setters behind `NEXT_PUBLIC_SELECTION_INTENT_ARBITRATION_V1` feature flag

**File:** `components/chat/chat-navigation-panel.tsx`
- Absolute snapshot policy for `panel_drawer`: never writes to `clarificationSnapshot`
- Saves to `lastOptionsShown` for re-anchor recovery
- Clears any stale `clarificationSnapshot` on latch-set
- Proactive latch: resolved if widget already registered, pending otherwise

**File:** `lib/chat/grounding-set.ts`
- Added `panelId?: string` to `OpenWidgetState`

**File:** `lib/chat/ui-snapshot-builder.ts`
- Propagates `panelId` from `WidgetSnapshot` to `OpenWidgetState`

### Step 3: Latch validity check + pending resolution
**File:** `lib/chat/routing-dispatcher.ts`
- `kind === 'resolved'`: verify widget still open, clear if gone
- `kind === 'pending'`: resolve via `panelId` match → upgrade to resolved; expire after 2 turns
- Tier 4.5 scoping: resolved uses `widgetId`, pending falls back to `activeSnapshotWidgetId`
- "Still loading" deterministic message on first turn with pending + no activeWidgetId, cooldown on subsequent turns
- Updated `trySetWidgetLatch` to use `kind: 'resolved'`

### Step 4: Hard invariant — single owner before Tier 3a
**File:** `lib/chat/routing-dispatcher.ts`
- Tier 3a primary (line 1544): already guarded by `!hasActiveFocusLatch`
- Tier 3a message-derived (line 1830): already guarded by `!hasActiveFocusLatch`

**File:** `lib/chat/chat-routing.ts`
- Added `latchBlocksStaleChat` constant
- Interrupt-paused path: added `|| latchBlocksStaleChat` guard
- Post-action ordinal window: existing `isLatchOrPreLatch` covers both kinds

### Step 5: Remove LATCH_DIAG console.logs
**File:** `lib/chat/chat-routing.ts`
- Replaced 3 `console.log('[LATCH_DIAG] ...')` with structured `debugLog`
- Migrated all `focusLatch.widgetId` reads to use `getLatchId(focusLatch)` (7 sites)

### Step 6: Deterministic tests
**File:** `__tests__/unit/chat/selection-intent-arbitration.test.ts` (NEW)
- 28 tests covering: strict vs embedded mode, discriminated union, getLatchId, normalizeOrdinalTypos, command escape, isExplicitCommand

## Post-Implementation Fixes (2026-02-07, passes 2–3)

Five issues found across two review cycles and addressed:

### Fix A: Missing `kind: 'resolved'` in prelatch promotion (HIGH)

**File:** `lib/chat/chat-routing.ts:2044`
**Bug:** The "post-action ordinal prelatch promotion" path called `setFocusLatch()` without the required `kind: 'resolved'` discriminant field. At runtime, `focusLatch.kind` would be `undefined`, causing both branches in the latch validity check (`routing-dispatcher.ts:956-983`) to miss — the latch survived but failed to scope Tier 4.5.
**Fix:** Added `kind: 'resolved'` to the object literal.
**Impact:** Edge case path (ordinal matches stale snapshot + active widget + no latch). Main happy paths (proactive latch from `chat-navigation-panel.tsx`, `trySetWidgetLatch`) were already correct.

### Fix B: Pending cooldown contradiction (MEDIUM)

**File:** `lib/chat/routing-dispatcher.ts:2627`
**Bug:** Cooldown path (pending latch, `turnsSinceLatched > 0`, no `activeWidgetId`) fell through to Tier 4.5 `handleGroundingSetFallback` without `activeWidgetId`, which could trigger multi-list ambiguity — contradicting the plan's "do NOT produce multi-list ambiguity clarifier" rule.
**Fix:** Changed cooldown path to return `{ handled: true }` silently (no message, no fall-through). Debug log action renamed from `pending_latch_cooldown_proceed` to `pending_latch_cooldown_silent`.
**Cooldown tracking:** Uses existing `turnsSinceLatched` counter on `PendingFocusLatch` (incremented by `incrementFocusLatchTurn()`). `=== 0` shows "Still loading..." message, `> 0` returns silently, `>= 2` expires the latch.

### Fix C: Missing integration race test file

**File:** `__tests__/integration/chat/selection-intent-arbitration-race.test.ts` (NEW)
**Bug:** Plan listed this file as a deliverable but it was never created during initial implementation. Only the unit test file existed.
**Fix:** Created with 20 tests in 4 groups:
- **Pending latch race** (7 tests): blocks stale chat, activeSnapshotWidgetId fallback, "Still loading" trigger, upgrade transition, 2-turn expiry, embedded ordinal detection, full race sequence
- **Command escape** (6 tests): embedded vs strict mode, explicit command bypass, label-only selection, latch persistence after command
- **Flag-off behavior** (4 tests): latchBlocksStaleChat false, no activeWidgetId, pure parsers unaffected, all 4 stale-chat paths pass through
- **Pending cooldown** (3 tests): first turn message, silent handled on subsequent turns, expiry at 2 turns

### Fix D: Pending null-flow isSelectionLike guard (MEDIUM)

**File:** `lib/chat/routing-dispatcher.ts:2612`
**Bug:** The pending latch cooldown block (from Fix B) swallowed ALL inputs when pending + no activeWidgetId, including non-selection inputs like commands and questions. This contradicts the plan's "non-selection input should fall through to downstream tiers normally."
**Fix:** Added `isSelectionLike()` guard to the pending null-flow check. Only selection-like inputs ("second one", "open the first") are swallowed; commands ("open recent") and questions fall through normally.

### Fix E: Dispatcher-level integration race tests

**File:** `__tests__/integration/chat/selection-intent-arbitration-dispatcher.test.ts` (NEW)
**Gap:** Existing integration race tests (20 tests in `selection-intent-arbitration-race.test.ts`) validate helper logic and state transitions in isolation but do NOT call the full routing chain. A reviewer noted these are "logic simulations, not dispatcher/UI runtime tests."
**Fix:** Created 4 dispatcher-level tests that call `dispatchRouting()` with real context objects:
- **Test 1**: Resolved latch + stale snapshot + ordinal → widget item (NOT stale chat)
- **Test 2**: Pending latch + stale snapshot + ordinal → pending upgrades to resolved, widget resolves
- **Test 3**: No latch + stale snapshot + ordinal → stale chat captures (baseline behavior)
- **Test 4**: Latch + explicit command → latch bypassed, known-noun routes

**Approach:** Mock heavy externals (LLM, doc retrieval, debug-logger, fetch), run core routing real (`dispatchRouting`, `handleClarificationIntercept`, `handleGroundingSetFallback`, parsers).

**Bug found during test run:** `handleKnownNounRouting` is synchronous (no `await`), but initial mock used `mockResolvedValue` (returns Promise). Fixed to `mockReturnValue`.

## Files Modified (10 files)

| File | Changes |
|------|---------|
| `lib/chat/input-classifiers.ts` | Unified `isSelectionOnly(mode)` + moved `normalizeOrdinalTypos`, `ORDINAL_TARGETS`, `extractOrdinalFromPhrase` |
| `lib/chat/chat-navigation-context.tsx` | Discriminated union `FocusLatchState` + `getLatchId()` + feature flag gating |
| `lib/chat/routing-dispatcher.ts` | Import unified parser, latch validity with pending resolution, Tier 4.5 pending scoping, "Still loading" message + silent cooldown, trySetWidgetLatch union update, **isSelectionLike guard on pending null-flow** |
| `lib/chat/chat-routing.ts` | Import unified parser, `latchBlocksStaleChat` invariant, interrupt-paused guard, console.log removal, union migration, **`kind: 'resolved'` fix at line 2044** |
| `components/chat/chat-navigation-panel.tsx` | Absolute snapshot policy for panel_drawer, proactive latch, stale snapshot cleanup |
| `lib/chat/grounding-set.ts` | `panelId?: string` on `OpenWidgetState` |
| `lib/chat/ui-snapshot-builder.ts` | Propagate `panelId` to openWidgets |
| `__tests__/unit/chat/selection-intent-arbitration.test.ts` | 28 unit tests (created in initial pass) |
| `__tests__/integration/chat/selection-intent-arbitration-race.test.ts` | **NEW — 20 integration race tests** (created in second pass) |
| `__tests__/integration/chat/selection-intent-arbitration-dispatcher.test.ts` | **NEW — 4 dispatcher-level race tests** (created in third pass) |

## Verification

```
$ npx tsc --noEmit
# Only pre-existing error: __tests__/unit/use-panel-close-handler.test.tsx(87,1): error TS1005
# No new errors introduced.

$ npx jest __tests__/unit/chat/ --no-coverage --runInBand
# 4 suites, 172 tests, 0 failures

$ npx jest __tests__/integration/chat/ --no-coverage --runInBand
# 2 suites, 24 tests, 0 failures (20 race + 4 dispatcher)

$ npx jest __tests__/unit/chat/ __tests__/integration/chat/ --no-coverage --runInBand
# 6 suites, 196 tests, 0 failures
```

**Note:** `npx tsc --noEmit` has a pre-existing parse error at `__tests__/unit/use-panel-close-handler.test.tsx:87` (`TS1005: ')' expected`). This is unrelated to this work and existed before any changes.

## Manual Test Results (Screenshots)

Tested 3 scenarios (screenshots captured 2026-02-07):

1. **Disambiguation → panel open → widget ordinal**:
   `"links panel"` → disambiguation → `"second one pls"` → Opens Links Panel D → `"open the second one pls"` → Opens entry "summary 155 D" (widget item #2) → repeated → same result ✅

2. **Cross-widget focus switch**:
   `"open recent widget"` → Opens Recent → `"open the second one pls"` → Opens entry "sample2" (Recent item #2) → `"open links panel d"` → Opens Links Panel D (new latch) → `"open the first one pls"` → Opens entry "summary144 D" (Links Panel D item #1) ✅

3. **Direct panel open → widget ordinal**:
   `"open links panel d"` → Opens Links Panel D → `"open the first one pls"` → Opens entry "summary144 D" ✅

## Acceptance Checks

1. `isSelectionOnly('open second one', 10, [], 'embedded').isSelection === true` — looksLikeNewCommand stays in selection flow ✅
2. Zero direct `focusLatch.widgetId` reads without `kind === 'resolved'` guard ✅ (Fix A addressed the last violation)
3. Both `ResolvedFocusLatch` and `PendingFocusLatch` satisfy `latchBlocksStaleChat` (blocking all 4 stale-chat paths) ✅
4. Feature flag `NEXT_PUBLIC_SELECTION_INTENT_ARBITRATION_V1=false` → all latch setters are no-ops, existing behavior unchanged ✅
5. Pending cooldown returns `handled: true` silently — no multi-list ambiguity on unresolved latch ✅
6. Pending cooldown only swallows selection-like inputs; commands/questions fall through normally ✅
7. Integration race tests pass (20/20) ✅
8. Dispatcher-level race tests pass (4/4) — calls `dispatchRouting()` with real context objects ✅
