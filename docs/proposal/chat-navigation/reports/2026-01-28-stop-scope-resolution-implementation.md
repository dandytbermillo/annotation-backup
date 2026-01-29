# Stop / Cancel Scope Resolution — Implementation Report

**Date:** 2026-01-28
**Feature:** Stop Scope Resolution (clarification-stop-scope-plan.md)
**Status:** Implemented and Verified
**Commits:** `002fd3de`, `6133c0e3`

---

## Overview

Implemented scope-aware stop/cancel handling to prevent "stop/cancel" loops where exit phrases outside an active clarification would fall through to doc/panel routing and re-trigger old clarifications. Stop is now treated as a **control utterance** resolved to the closest active scope, not a navigation destination.

### Related Documents

- Plan: `docs/proposal/chat-navigation/plan/panels/chat/meta/clarification-stop-scope-plan.md`
- Parent plan: `docs/proposal/chat-navigation/plan/panels/chat/meta/clarification-response-fit-plan.md`
- Related: `docs/proposal/chat-navigation/plan/panels/chat/meta/clarification-interrupt-resume-plan.md`
- Related: `docs/proposal/chat-navigation/plan/panels/chat/meta/clarification-offmenu-handling-plan.md`

---

## Problem Statement

When a user said "stop" or "cancel" outside an active clarification context (e.g., after selecting an option or after an interrupt), the exit phrase was not caught by the clarification exit handler (which requires `hasClarificationContext` to be true). Instead, it fell through to normal routing — triggering a doc search or panel disambiguation on the word "cancel"/"stop", which could re-trigger the exact clarification the user was trying to exit.

### User-Visible Symptom

1. User triggers clarification ("links panel" → pills shown)
2. User selects an option (clarification cleared, snapshot saved)
3. User says "cancel" → system re-triggers Links Panel clarification instead of acknowledging the cancel

---

## Solution

### Scope Priority Model

Stop/cancel resolves to the **closest active scope** in priority order:

| Priority | Scope | Status | Response |
|----------|-------|--------|----------|
| 1 | Active execution | **Deferred** — fire-and-forget actions have no cancellation mechanism | "Okay — stopped." |
| 2 | Active clarification UI | **Implemented** (existing + wording update) | "Okay — we'll drop that. What would you like to do instead?" |
| 3 | No active scope | **Implemented** (new) | "No problem — what would you like to do instead?" |

---

## Changes

### 1. `lib/chat/chat-navigation-context.tsx`

**New state: `stopSuppressionCount`**

```typescript
export const STOP_SUPPRESSION_TURN_LIMIT = 2

// In ChatNavigationContextValue interface:
stopSuppressionCount: number
setStopSuppressionCount: (count: number) => void
decrementStopSuppression: () => void

// In provider:
const [stopSuppressionCount, setStopSuppressionCountInternal] = useState<number>(0)
```

Provides a turn-based counter for repeated stop suppression. Set to `STOP_SUPPRESSION_TURN_LIMIT` (2) after any confirmed stop. Reset to 0 on any non-exit input.

### 2. `lib/chat/chat-routing.ts`

**A. Stop suppression reset (top of handler, before any early-return)**

```typescript
// Line ~1391: Runs unconditionally on every non-exit input
if (stopSuppressionCount > 0 && !isExitPhrase(trimmedInput)) {
  setStopSuppressionCount(0)
}
```

Prevents suppression from leaking across unrelated commands (e.g., "cancel this" → "open recent" → "stop" should NOT suppress the second stop).

**B. Priority 3: Stop scope guard (between ordinal window and incrementSnapshotTurn)**

```typescript
// Line ~1710: Catches exit phrases when !lastClarification
if (!lastClarification && isExitPhrase(trimmedInput)) {
  // Repeated suppression check
  if (stopSuppressionCount > 0) {
    addMessage("All set — what would you like to do?")
    return handled
  }
  // Clear snapshot, set suppression, respond
  clearClarificationSnapshot()
  setStopSuppressionCount(STOP_SUPPRESSION_TURN_LIMIT)
  addMessage("No problem — what would you like to do instead?")
  return handled
}
```

**C. Bare ordinal detection (after stop scope guard)**

```typescript
// Line ~1770: Catches ordinals when no context exists
if (!lastClarification && !clarificationSnapshot) {
  const bareOrdinalCheck = isSelectionOnly(trimmedInput, 10, [])
  if (bareOrdinalCheck.isSelection) {
    addMessage("Which options are you referring to?")
    return handled
  }
}
```

Prevents ordinals from silently falling through to doc routing after a stop clears all context.

**D. Priority 2 wording alignment (3 existing hard-exit paths)**

Updated all three hard-exit paths inside `hasClarificationContext` block:
- Affirmation after confirm prompt (line ~2139)
- Explicit exit OR repeated ambiguous exit (line ~2207)
- Ambiguous exit without visible options (line ~2272)

Each path now:
- Uses response: `"Okay — we'll drop that. What would you like to do instead?"` (was `"No problem — ..."`)
- Sets `setStopSuppressionCount(STOP_SUPPRESSION_TURN_LIMIT)` after hard exit

**E. Import update**

```typescript
import { REPAIR_MEMORY_TURN_LIMIT, STOP_SUPPRESSION_TURN_LIMIT } from '@/lib/chat/chat-navigation-context'
```

**F. Interface update**

```typescript
export interface ClarificationInterceptContext {
  // ... existing fields ...
  stopSuppressionCount: number
  setStopSuppressionCount: (count: number) => void
  decrementStopSuppression: () => void
}
```

### 3. `components/chat/chat-navigation-panel.tsx`

Wired the three new state fields from context into the `handleClarificationIntercept` call:

```typescript
const {
  // ... existing destructuring ...
  stopSuppressionCount,
  setStopSuppressionCount,
  decrementStopSuppression,
} = useChatNavigationContext()

// Passed to handleClarificationIntercept({ ... })
```

---

## Decision Order in `handleClarificationIntercept`

The full routing order with stop-scope and repair-guard additions:

1. **Stop suppression reset** — non-exit input resets counter to 0
2. **Early repair memory handler** — "the other one" after clarification cleared
3. **Post-action repair window** — "not that" with active snapshot (`!paused`)
4. **Return signal handler** — "back to the panels" for paused snapshots
5. **Paused-snapshot repair guard** — "not that" with paused snapshot (no return cue)
6. **Post-action ordinal window** — selection persistence for active AND paused snapshots
7. **Stop scope guard (Priority 3)** — exit phrases with no active clarification
8. **Bare ordinal detection** — ordinals with no context at all
9. **incrementSnapshotTurn()** — turn counter (no expiry for active or paused)
10. **hasClarificationContext block** — all Priority 2 handling (exit, hesitation, selection, etc.)
11. **Normal routing** — doc search, panel disambiguation, LLM fallback

---

## Bug Fix: Paused-Snapshot Repair Routing Leak

**Problem:** After an interrupt (paused snapshot), saying "not that" fell through to normal routing — triggering cross-corpus doc/notes disambiguation instead of being absorbed as a control utterance.

**Root cause:** The post-action repair window (step 3) only handled active snapshots (`!clarificationSnapshot.paused`). Repair phrases with a paused snapshot had no guard, so they passed through the return signal handler (no return cue detected) and the ordinal window (`paused` excluded), landing in normal routing where "not that" was interpreted as navigation input.

**Fix:** Added a **paused-snapshot repair guard** (step 5) between the return signal handler and the post-action ordinal window. When `isRepairPhrase(trimmedInput)` and the snapshot is paused, the guard absorbs the input with a neutral prompt.

```typescript
// After return signal handler, before post-action ordinal window
if (!lastClarification &&
    clarificationSnapshot &&
    clarificationSnapshot.paused &&
    clarificationSnapshot.options.length > 0 &&
    isRepairPhrase(trimmedInput)) {
  addMessage({ content: 'Okay — what would you like to do instead?' })
  return { handled: true, clarificationCleared: false, isNewQuestionOrCommandDetected }
}
```

**Design decisions:**
- Placed *after* the return signal handler so compound inputs ("not that — back to the panels") are handled by the existing return signal detection — no duplicate `detectReturnSignal` call needed.
- Does NOT clear the paused snapshot — preserves the ability for explicit return on a subsequent turn. Normal turn-based expiry via `incrementSnapshotTurn()` handles cleanup.
- Uses `clarificationCleared: false` since no clarification was actually cleared.

**Reference:** `clarification-interrupt-resume-plan.md` §80-85 (Acceptance Test 5: Repair after interrupt)

---

## Bug Fix: Paused-Snapshot Ordinal Routing Leak

**Problem:** After an interrupt (paused snapshot), ordinals like "second option" fell through to normal routing — triggering cross-corpus doc/notes disambiguation instead of being absorbed.

**Root cause:** The bare ordinal detection (step 9) required `!clarificationSnapshot` — after an interrupt the paused snapshot still exists, so the guard was skipped. The post-action ordinal window (step 7) required `!clarificationSnapshot.paused`, so paused snapshots were also excluded. Ordinals fell through to routing.

**Initial fix (v1):** Added a separate paused-snapshot ordinal guard that blocked all ordinals against paused snapshots with "Which options are you referring to?" Prevented routing leaks but frustrated users who clearly wanted to select from the list they just saw.

**Refined fix (v2 — one-turn grace):** Allowed ordinals on the very next turn after interrupt (grace turn), blocked after that with a hint message. Still frustrating — users expected repeated ordinal selection to keep working.

**Final fix (v3 — unified ordinal window):** Per updated `clarification-interrupt-resume-plan.md` §46-51 ("No Automatic Expiry on Unrelated Commands"): removed the separate paused-snapshot ordinal guard entirely and removed `!clarificationSnapshot.paused` from the post-action ordinal window. Both active and paused snapshots are now handled identically by the ordinal window.

Additionally removed paused snapshot turn-based expiry from `incrementSnapshotTurn` — paused snapshots now persist until:
- explicit exit (stop/cancel confirmed)
- a new list replaces it

```typescript
// Post-action ordinal window now handles both active and paused:
if (!lastClarification &&
    clarificationSnapshot &&
    clarificationSnapshot.options.length > 0) {
  // ... ordinal resolution (same for active and paused)
}
```

**Design decisions:**
- Unified ordinal window eliminates the paused/active distinction for ordinal selection, matching user expectations.
- Paused snapshots persist indefinitely (no turn-based expiry), only cleared by explicit exit or list replacement.
- Repair phrases with paused snapshots still caught by the paused-snapshot repair guard (step 5).
- `PAUSED_SNAPSHOT_TURN_LIMIT` constant is now unused; can be removed in cleanup.

**Reference:** `clarification-interrupt-resume-plan.md` §46-51 (No Automatic Expiry)

---

## Bug Fix: Suppression Leak

**Initial implementation** used `decrementStopSuppression()` at line ~1797 (between ordinal window and incrementSnapshotTurn). This only ran if execution reached that point — early returns from repair, return signal, or ordinal handlers skipped it. Additionally, decrement (2→1→0) kept the counter positive across intervening commands.

**Fix:** Replaced with a global reset at the top of the handler. Any non-exit input sets the counter to 0 immediately, before any early-return path. This ensures:
- "cancel this" → counter=2 → "open recent" → counter=0 → "stop" → Priority 3 (correct)
- "stop" → counter=2 → "stop" → counter still 2 (exit phrase, no reset) → "All set" (correct)

---

## Test Results

### Manual Testing (4 screenshot sets)

**Round 1 (pre-fix):**

| Test | Input Sequence | Expected | Actual | Result |
|------|---------------|----------|--------|--------|
| Ambiguous stop | pills → "stop" → "yes" | "Okay — we'll drop that..." | Correct | ✅ |
| Explicit stop | pills → "cancel this" | Immediate exit | Correct | ✅ |
| Suppression leak | "cancel this" → "open recent" → "stop" | Priority 3 | "All set..." (leak) | ❌ |
| Interrupt-resume | interrupt → "back to panels — second" | Select from restored list | Correct | ✅ |

**Round 2 (post-fix):**

| Test | Input Sequence | Expected | Actual | Result |
|------|---------------|----------|--------|--------|
| Ambiguous stop | pills → "stop" → "yes" | "Okay — we'll drop that..." | Correct | ✅ |
| Suppression fixed | "cancel this" → "open recent" → "stop" | "No problem..." (P3) | Correct | ✅ |
| Fresh clarification | After stop → "links panel" | New clarification | Correct | ✅ |
| Repeated stop cycle | Multiple stop→confirm→yes cycles | Each works independently | Correct | ✅ |

**Round 3 (acceptance tests — stop-scope):**

| Test | Input Sequence | Expected | Actual | Result |
|------|---------------|----------|--------|--------|
| Bare ordinal after stop | pills → stop → yes → "second option" | "Which options are you referring to?" | Correct | ✅ |
| Repeated stop | pills → stop → yes → "stop" | "All set — what would you like to do?" | Correct | ✅ |
| Repair after interrupt | pills → "open recent" → "not that" | Cross-corpus disambiguation (leak) | Routing leak | ❌ |

**Round 4 (post repair-guard fix):**

| Test | Input Sequence | Expected | Actual | Result |
|------|---------------|----------|--------|--------|
| Stop scope re-verify | pills → "stop" → "yes" → "the first one" | P2 wording + bare ordinal | Correct | ✅ |
| Repair after interrupt | pills → "open recent widget" → "not that" | "Okay — what would you like to do instead?" | Correct | ✅ |

**Round 5 (QA checklist — tests 6, 7, 10):**

| Test | Input Sequence | Expected | Actual | Result |
|------|---------------|----------|--------|--------|
| QA #6: Interrupt | pills → "open widget manager" | "Opening Widget Manager..." | Correct | ✅ |
| QA #7: No auto-resume | interrupt → "second option" | "Which options are you referring to?" | Cross-corpus disambiguation (leak) | ❌ |
| QA #10: Selection persistence | pills → "second option" | "Opening Links Panel D..." | Correct | ✅ |
| Stop on new clarification | new pills → "stop" → "yes" | P2 wording | Correct | ✅ |

### Type-check

```bash
$ npm run type-check
# Passes with 0 errors (pre-existing idx warning only)
```

---

## Acceptance Test Coverage

Per `clarification-stop-scope-plan.md`:

| # | Test | Status | Notes |
|---|------|--------|-------|
| 1 | Stop during execution | Deferred | Priority 1 requires cancellation infrastructure |
| 2 | Stop during clarification (ambiguous + explicit) | ✅ Verified | Both paths tested |
| 3 | No auto-resume after stop | ✅ Verified | Bare ordinal → "Which options are you referring to?" |
| 4 | Explicit return after stop | ✅ Verified | Return signal handler (from interrupt-resume plan) |
| 5 | Repeated stop suppression | ✅ Verified | Counter-based, resets on non-exit input |

Per `clarification-interrupt-resume-plan.md`:

| # | Test | Status | Notes |
|---|------|--------|-------|
| 1 | Interrupt | ✅ Verified | "open recent" during pills → execute immediately, list paused |
| 2 | Ordinal after interrupt | Pending verification | Ordinals resolve against paused list (no turn limit) |
| 3 | Repeated ordinals | Pending verification | Multiple ordinals keep selecting from paused list |
| 4 | Explicit return | ✅ Verified | "back to the panels" restores paused list |
| 5 | Return + ordinal | ✅ Verified | "back to panels — second option" selects from restored list |
| 6 | Repair after interrupt | ✅ Verified | "not that" → neutral prompt, no routing leak |

---

## Response Wording Summary

| Scope | Response |
|-------|----------|
| Priority 2 (clarification stop) | "Okay — we'll drop that. What would you like to do instead?" |
| Priority 3 (general cancel) | "No problem — what would you like to do instead?" |
| Repeated stop suppression | "All set — what would you like to do?" |
| Bare ordinal (no context) | "Which options are you referring to?" |
| Repair after interrupt (paused snapshot) | "Okay — what would you like to do instead?" |
| Ordinal after interrupt (paused snapshot) | (no message — selects from paused list via unified ordinal window) |

---

## Known Limitations

1. **Priority 1 (active execution stop)** is deferred. `executeAction`/`selectOption` are fire-and-forget; adding "Okay — stopped." without actual cancellation would be misleading. Requires future `currentExecution` state + abort controller infrastructure.

2. **`decrementStopSuppression`** is still exposed on the context interface but unused in `chat-routing.ts` after the fix changed from decrement to full reset. Could be removed in a cleanup pass.

3. **`PAUSED_SNAPSHOT_TURN_LIMIT`** constant is still defined in `chat-navigation-context.tsx` but no longer used after removing paused snapshot turn-based expiry. Could be removed in a cleanup pass.

---

## Files Changed

| File | Lines | Change |
|------|-------|--------|
| `lib/chat/chat-navigation-context.tsx` | +23 | New constant, state, callbacks, provider value |
| `lib/chat/chat-routing.ts` | +130, -6 | Interface, handler logic, wording updates, repair guard, unified ordinal window |
| `lib/chat/chat-navigation-context.tsx` | +4, -4 | Removed paused snapshot turn-based expiry |
| `components/chat/chat-navigation-panel.tsx` | +8 | Wire new state to intercept call |
| `clarification-stop-scope-plan.md` | +5, -5 | Priority 1 deferred rationale |
| `clarification-interrupt-resume-plan.md` | +6, -2 | Test 5 updated: repair after interrupt spec |

---

## Next Steps

- Test unified ordinal window: interrupt → ordinal → repeated ordinal → should keep selecting (QA #2-3)
- Test ordinals survive unrelated commands: interrupt → command → ordinal → should still select
- Run remaining QA checklist tests: #11 (bare label), #12 (noise), #13 (hesitation)
- Cleanup: remove unused `decrementStopSuppression` and `PAUSED_SNAPSHOT_TURN_LIMIT`
- Priority 1 implementation when cancellable execution exists
