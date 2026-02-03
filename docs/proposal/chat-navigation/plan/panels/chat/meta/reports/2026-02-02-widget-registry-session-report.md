# 2026-02-02 Widget Registry Session Report

## Summary

This session verified the widget registry implementation (commit `e2bd3e3f`), identified gaps, and fixed two issues that prevented end-to-end widget item resolution via Tier 4.5.

## Context

The widget registry implementation plan (`widget-registry-implementation-plan.md`) was implemented in a prior session and committed as `e2bd3e3f` by the user. This session was asked to investigate whether that implementation was complete and working.

## Findings

### Verified as Working (from commit `e2bd3e3f`)
- **Layer 1** (`lib/widgets/ui-snapshot-registry.ts`): Types, validation, store API all correct
- **Layer 2** (`lib/chat/ui-snapshot-builder.ts`): `buildTurnSnapshot`, `getWidgetListItems`, freshness guard
- **Layer 3a** (`lib/chat/routing-dispatcher.ts`): `buildTurnSnapshot()` call, activeWidget reorder, `openWidgets` passed to `buildGroundingContext`, `execute_widget_item` action, `multiListAmbiguity` handling
- **Layer 3b**: `saveLastOptionsShown` wired at all 6 option-creation sites
- **Layer 3d**: Tier 2a does not clear `lastOptionsShown` (correct)
- **Reporters**: RecentPanel (`w_recent`), RecentWidget (`w_recent_widget`), DashboardView (`setActiveWidgetId`)
- **Browser verification**: Console confirms `Registered: w_recent_widget {segments: 2, items: 3}`

### Gaps Found and Fixed

#### Fix 1: Step 6 — `bare_ordinal_no_context` guards (missing from commit `e2bd3e3f`)

**File**: `lib/chat/chat-routing.ts` (~line 2208)

**Problem**: The `bare_ordinal_no_context` handler intercepted command-like inputs containing ordinals (e.g., "open the first option in the recent widget") before they could reach Tier 4.5 widget resolution.

**Fix**: Added two guards per the implementation plan Step 6:
- `!isNewQuestionOrCommandDetected` — skip if input contains a verb command
- `bareOrdinalWordCount <= 4` — only catch short bare ordinals, not full sentences

**Before**:
```typescript
if (!lastClarification && !clarificationSnapshot) {
```

**After**:
```typescript
const bareOrdinalWordCount = trimmedInput.split(/\s+/).length
if (!lastClarification && !clarificationSnapshot && !isNewQuestionOrCommandDetected && bareOrdinalWordCount <= 4) {
```

#### Fix 2: `resolveOrdinalIndex` embedded extraction (not in original plan)

**File**: `lib/chat/grounding-set.ts` (~line 774)

**Problem**: `resolveOrdinalIndex` only matched ordinals when they were the **entire input** string (e.g., "first", "the second one"). After `resolveWidgetSelection` stripped the widget name from "open the first option in the recent widget", the remaining string "open the first option the widget" didn't match any whole-string key in the ordinal map.

**Root cause**: The function was designed for short selection inputs after disambiguation, not for ordinals embedded in longer command sentences.

**Fix**: Added a second pass that extracts ordinals from within longer strings using word-boundary regex:
```typescript
const embeddedOrdinals: [RegExp, number][] = [
  [/\bfirst\b|(?<!\d)1st\b/, 0],
  [/\bsecond\b|(?<!\d)2nd\b/, 1],
  // ... through ninth and last
]
```
Also handles embedded `option N` / `item N` / `#N` patterns.

The existing whole-string matching (step 1) runs first, so existing short-input behavior is unchanged.

## Additions

### Debug tooling (temporary)

**File**: `lib/widgets/ui-snapshot-registry.ts`

- Added `console.log` on successful registration (line 224)
- Added `window.__snapshotRegistry` dev-only object for console inspection (line 284-292)

These should be removed before production.

### Unit tests

**File**: `__tests__/unit/widgets/ui-snapshot-registry.test.ts` (27 tests)
- Registration, validation, rejection, segment validation, retrieval, unregister, activeWidgetId, clear

**File**: `__tests__/unit/widgets/ui-snapshot-builder.test.ts` (19 tests)
- buildTurnSnapshot, freshness guard, activeSnapshotWidgetId, multi-segment, getWidgetListItems

**Results**: 46/46 passing (`npx jest __tests__/unit/widgets/ --no-coverage`)

## End-to-End Verification

**Test performed**: User typed "open the first option in the recent widget" in the chat with the Recent widget visible on the dashboard.

**Result**: `Opened workspace "Sprint 14"` — the first item in the Recent widget's list.

**Execution path verified**:
1. `bare_ordinal_no_context` skipped (Step 6 guard: `isNewQuestionOrCommandDetected` = true, word count = 8)
2. Dispatcher reached Tier 4.5 → `buildTurnSnapshot()` returned `w_recent_widget` with 3 items
3. `handleGroundingSetFallback` → widget label "recent" matched at `grounding-set.ts:613`
4. `resolveWidgetSelection` → stripped "recent"/"in" → `resolveUniqueDeterministic`
5. `resolveOrdinalIndex` → embedded extraction found "first" → index 0
6. Dispatcher returned `execute_widget_item` → `chat-navigation-panel.tsx:1644` handled it
7. Synthetic message sent to `/api/chat/navigate` → workspace opened

## Files Modified (this session only)

| File | Change |
|------|--------|
| `lib/chat/chat-routing.ts` | Added Step 6 guards to `bare_ordinal_no_context` |
| `lib/chat/grounding-set.ts` | Added embedded ordinal extraction to `resolveOrdinalIndex` |
| `lib/widgets/ui-snapshot-registry.ts` | Added debug logging + `window.__snapshotRegistry` |
| `__tests__/unit/widgets/ui-snapshot-registry.test.ts` | Created (27 tests) |
| `__tests__/unit/widgets/ui-snapshot-builder.test.ts` | Created (19 tests) |

## What Is NOT Done

The `widget-ui-snapshot-plan.md` is **not implemented**. Its status section (line 179) correctly says "NOT STARTED" for the full snapshot plan. The registry implementation plan provides the architecture layer, but the snapshot plan defines additional requirements:

- **Rule A (context-like routing)**: Using context segments to answer "what does this widget mean?" — not implemented
- **Context Answer Source Rule**: Item-level context lookups — not implemented
- **Acceptance tests from the snapshot plan**: The three test scenarios (mixed widget + context, multi-list ambiguity, non-list widget) have not been formally validated
- **Plan status section**: Needs updating to reflect what's now implemented vs what remains

## Next Steps

Implement `widget-ui-snapshot-plan.md` as a separate task.
