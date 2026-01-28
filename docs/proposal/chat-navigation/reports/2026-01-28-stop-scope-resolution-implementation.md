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

The full routing order with stop-scope additions:

1. **Stop suppression reset** — non-exit input resets counter to 0
2. **Early repair memory handler** — "the other one" after clarification cleared
3. **Post-action repair window** — "not that" with active snapshot
4. **Return signal handler** — "back to the panels" for paused snapshots
5. **Post-action ordinal window** — selection persistence for active snapshots
6. **Stop scope guard (Priority 3)** — exit phrases with no active clarification
7. **Bare ordinal detection** — ordinals with no context
8. **incrementSnapshotTurn()** — paused snapshot expiry
9. **hasClarificationContext block** — all Priority 2 handling (exit, hesitation, selection, etc.)
10. **Normal routing** — doc search, panel disambiguation, LLM fallback

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
| 3 | No auto-resume after stop | ✅ Implemented | Bare ordinal → "Which options are you referring to?" |
| 4 | Explicit return after stop | ✅ Implemented | Return signal handler (from interrupt-resume plan) |
| 5 | Repeated stop suppression | ✅ Implemented | Counter-based, resets on non-exit input |

---

## Response Wording Summary

| Scope | Response |
|-------|----------|
| Priority 2 (clarification stop) | "Okay — we'll drop that. What would you like to do instead?" |
| Priority 3 (general cancel) | "No problem — what would you like to do instead?" |
| Repeated stop suppression | "All set — what would you like to do?" |
| Bare ordinal (no context) | "Which options are you referring to?" |

---

## Known Limitations

1. **Priority 1 (active execution stop)** is deferred. `executeAction`/`selectOption` are fire-and-forget; adding "Okay — stopped." without actual cancellation would be misleading. Requires future `currentExecution` state + abort controller infrastructure.

2. **`decrementStopSuppression`** is still exposed on the context interface but unused in `chat-routing.ts` after the fix changed from decrement to full reset. It remains available for future use (e.g., if a turn-based decay is preferred over immediate reset). Could be removed in a cleanup pass.

---

## Files Changed

| File | Lines | Change |
|------|-------|--------|
| `lib/chat/chat-navigation-context.tsx` | +23 | New constant, state, callbacks, provider value |
| `lib/chat/chat-routing.ts` | +119, -6 | Interface, handler logic, wording updates |
| `components/chat/chat-navigation-panel.tsx` | +8 | Wire new state to intercept call |
| `clarification-stop-scope-plan.md` | +5, -5 | Priority 1 deferred rationale |

---

## Next Steps

- Test bare ordinal detection ("second option" with no context) in manual UI testing
- Test pure repeated stop (no intervening commands) in manual UI testing
- Consider removing unused `decrementStopSuppression` from context interface
- Priority 1 implementation when cancellable execution exists
