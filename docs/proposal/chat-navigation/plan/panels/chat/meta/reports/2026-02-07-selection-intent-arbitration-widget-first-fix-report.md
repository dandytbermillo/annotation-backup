# Selection Intent Arbitration — Widget-First Latch Fix

**Date:** 2026-02-07
**Feature flag:** `NEXT_PUBLIC_SELECTION_INTENT_ARBITRATION_V1=true`
**Plan file:** `/Users/dandy/.claude/plans/wiggly-juggling-haven.md`

## Summary

Fixed the intermittent ordinal hijack bug where ordinals ("open second one") resolved against stale chat disambiguation lists instead of widget items after opening a panel. Root cause: stale `clarificationSnapshot` persisted after panel opens, and the focus latch guard depended on a timing race with `activeSnapshotWidgetId`.

## 6 Principles Applied

1. **Single owner** — selection arbitration happens once, before Tier 3a stale-chat paths
2. **Hard invariant** — if latch is resolved or pending, Tier 3a chat ordinal/message-derived selection is blocked
3. **State machine** — `none → pending(panelId) → resolved(widgetId) → suspended → cleared`
4. **Snapshot policy** — panel-drawer selection does not leave an ordinal-capturable stale snapshot
5. **Parser scope** — strict for stale-chat guards, embedded for looksLikeNewCommand
6. **Proof over tweaks** — 28 red/green tests pass

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

## Files Modified (8 files)

| File | Changes |
|------|---------|
| `lib/chat/input-classifiers.ts` | Unified `isSelectionOnly(mode)` + moved `normalizeOrdinalTypos`, `ORDINAL_TARGETS`, `extractOrdinalFromPhrase` |
| `lib/chat/chat-navigation-context.tsx` | Discriminated union `FocusLatchState` + `getLatchId()` + feature flag gating |
| `lib/chat/routing-dispatcher.ts` | Import unified parser, latch validity with pending resolution, Tier 4.5 pending scoping, "Still loading" message, trySetWidgetLatch union update |
| `lib/chat/chat-routing.ts` | Import unified parser, `latchBlocksStaleChat` invariant, interrupt-paused guard, console.log removal, union migration |
| `components/chat/chat-navigation-panel.tsx` | Absolute snapshot policy for panel_drawer, proactive latch, stale snapshot cleanup |
| `lib/chat/grounding-set.ts` | `panelId?: string` on `OpenWidgetState` |
| `lib/chat/ui-snapshot-builder.ts` | Propagate `panelId` to openWidgets |
| `__tests__/unit/chat/selection-intent-arbitration.test.ts` | NEW — 28 unit tests |

## Verification

```
$ npx tsc --noEmit
# Only pre-existing error: __tests__/unit/use-panel-close-handler.test.tsx(87,1): error TS1005

$ npx jest __tests__/unit/chat/ --no-coverage
# 4 suites, 172 tests, 0 failures
```

## Acceptance Checks

1. `isSelectionOnly('open second one', 10, [], 'embedded').isSelection === true` — looksLikeNewCommand stays in selection flow
2. Zero direct `focusLatch.widgetId` reads without `kind === 'resolved'` guard
3. Both `ResolvedFocusLatch` and `PendingFocusLatch` satisfy `latchBlocksStaleChat` (blocking all 4 stale-chat paths)
4. Feature flag `false` → all latch setters are no-ops, existing behavior unchanged
