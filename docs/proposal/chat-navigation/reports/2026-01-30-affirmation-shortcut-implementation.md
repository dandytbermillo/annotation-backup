# Affirmation Shortcut & Suggestion Routing Unification — Implementation Report

**Date:** 2026-01-30
**Plans:**
- `clarification-response-fit-plan.md` (Step 1 affirmation shortcut)
- `suggestion-routing-unification-plan.md` (Tier S)

**Status:** Code-complete, type-check passing, partially tested

---

## Summary

Two related fixes implemented in this session:

1. **Suggestion Routing Unification (Tier S):** Moved inline suggestion rejection/affirmation checks from `sendMessage()` into the unified routing dispatcher as Tier S, completing the single-spine routing chain.

2. **Affirmation Shortcut in `classifyResponseFit()`:** Added early detection of affirmation phrases ("yes", "yeah", "sure") in option-picking clarification contexts, fixing a bug where "yes" after "Did you mean X?" or panel disambiguation was misclassified as `short_hint_no_overlap`.

---

## Problem

### Problem 1: Suggestion routing bypassed the dispatcher
Two inline blocks in `sendMessage()` (rejection detection and affirmation handling) short-circuited the dispatcher, meaning routing was not fully unified through the Tier 0–5 chain.

### Problem 2: "yes" misclassified in clarification contexts
When a user said "yes" after:
- **"Did you mean Widget Manager?"** (single option, Tier 4 near-match)
- **"Multiple Links Panel panels found"** (3 options, panel disambiguation)

The `classifyResponseFit()` function treated "yes" as a short hint with no token overlap (`short_hint_no_overlap`, confidence 0.2), triggering the generic escalation message "I didn't catch that. Reply first or second..." instead of:
- Auto-selecting the single option, or
- Showing a targeted "Which one? Reply first, second, third..." prompt

**Root cause:** `classifyResponseFit()` checked for token overlap between input and option labels. "yes" has zero overlap with any option label (e.g., "Widget Manager"), so it fell into the `short_hint_no_overlap` branch. There was no early-exit for affirmation phrases.

---

## Changes

### 1. `lib/chat/routing-dispatcher.ts` (+156 lines)

**Tier S — Suggestion Reject/Affirm** (between Tier 2g and Tier 3):

- **Context additions:** `lastSuggestion`, `setLastSuggestion`, `addRejectedSuggestions`, `clearRejectedSuggestions` added to `RoutingDispatcherContext`
- **Result addition:** `suggestionAction` discriminated union on `RoutingDispatcherResult` with variants: `affirm_single`, `affirm_multiple`, `reject`
- **Rejection branch:** Detects `isRejectionPhrase()`, clears suggestion state, sends alternatives message, returns `{ handled: true, suggestionAction: { type: 'reject' } }`
- **Affirmation single-candidate:** Returns `{ handled: true, suggestionAction: { type: 'affirm_single', candidate } }` — API call executed by `sendMessage()`
- **Affirmation multi-candidate:** Sends "Which one?" message with candidate list
- **Stale cleanup:** Clears `lastSuggestion` when clarification intercept handles input (Tiers 0/1/interrupt)

### 2. `components/chat/chat-navigation-panel.tsx` (-193 / +133 lines net)

- **Removed:** ~190 lines of inline rejection/affirmation handling that bypassed the dispatcher
- **Added:** Suggestion context fields passed to `dispatchRouting()` call
- **Added:** Post-dispatch `affirm_single` handler (~100 lines) that executes `/api/chat/navigate` API call
- **Added:** Stale suggestion cleanup when any non-suggestion tier handles input

### 3. `lib/chat/clarification-offmenu.ts` (+24 lines)

**Affirmation shortcut** in `classifyResponseFit()`, before the short-hint check:

```typescript
const isOptionPickingContext = clarificationType === 'option_selection'
  || clarificationType === 'panel_disambiguation'

if (isOptionPickingContext && isAffirmationPhrase(input)) {
  if (options.length === 1) {
    return { intent: 'select', choiceId: options[0].id, confidence: 0.9,
             reason: 'affirmation_single_option', matchedOption: options[0] }
  }
  return { intent: 'ask_clarify', confidence: 0.7,
           reason: 'affirmation_multiple_options' }
}
```

- **Scoped to:** `option_selection` (Tier 4 near-match) and `panel_disambiguation` (Tier 2c)
- **1 option:** Returns `intent: 'select'` with confidence 0.9 (clears the 0.75 execute threshold)
- **>1 options:** Returns `intent: 'ask_clarify'` with `reason: 'affirmation_multiple_options'`

### 4. `lib/chat/chat-routing.ts` (+17 lines)

**Targeted prompt** for `affirmation_multiple_options` in the escalation handler:

```typescript
const isAffirmationMultiple = responseFit.reason === 'affirmation_multiple_options'
// Generates: "Which one? Reply first, second, third, or say "none of these"."
```

Replaces the generic "I didn't catch that" escalation with ordinal-specific prompt.

### 5. `docs/proposal/chat-navigation/plan/panels/chat/meta/clarification-response-fit-plan.md` (+8 lines)

Added the affirmation shortcut rule under Step 1 in the plan document.

---

## Debug Log Evidence

### Before fix (short_hint_no_overlap):
```
id: 29350531 | action: clarification_response_fit
metadata: {"input": "yes", "intent": "ask_clarify", "reason": "short_hint_no_overlap", "confidence": 0.2}
```

### After fix (affirmation_multiple_options):
```
id: 29351826 | action: clarification_response_fit
metadata: {"input": "yes", "intent": "ask_clarify", "reason": "affirmation_multiple_options", "confidence": 0.7}
```

### Targeted prompt confirmed:
```
id: 29351825 | action: clarification_response_fit_escalate
metadata: {"input": "yes", "reason": "affirmation_multiple_options", "showExits": false, "attemptCount": 1}
```
Output: "Which one? Reply **first**, **second**, **third**, or say **"none of these"**."

---

## Test Results

### Tested (confirmed working):

| Test | Input | Expected | Actual | Status |
|------|-------|----------|--------|--------|
| "open widget manager" | Exact Tier 4 match | "Opening Widget Manager." | "Opening Widget Manager." | PASS |
| "links panel" → 3 pills → "yes" | Affirmation multiple | Targeted "Which one?" prompt | "Which one? Reply first, second, third..." | PASS |
| "links panel" → "yes" → "yes" | Repeated affirmation | Same prompt + exit pills | Same + "None of these" / "Start over" | PASS |
| "yews" (typo) | Not affirmation | Generic escalation | "I didn't catch that..." | PASS |

### Not yet tested:

| Test | Input | Expected | Notes |
|------|-------|----------|-------|
| "open widget managr" → "yes" | Affirmation single option | Auto-select Widget Manager | Needs single-typo input to trigger Tier 4 near-match |
| Suggestion reject ("no" with lastSuggestion) | Tier S rejection | Clear state, show alternatives | Requires suggestion state to be set |
| Suggestion affirm single (Tier S) | "yes" with 1 suggestion candidate | Execute candidate action | Requires suggestion state |
| "stop" with active suggestion | Tier 0 overrides Tier S | Stop fires, suggestion cleared | Stale cleanup verification |

---

## Verification

### Type-check
```bash
$ npx tsc --noEmit
__tests__/unit/use-panel-close-handler.test.tsx(87,1): error TS1005: ')' expected.
```
Only pre-existing test file error. Zero errors in changed files.

### Git diff
```
 components/chat/chat-navigation-panel.tsx          | 326 +++--
 .../chat/meta/clarification-response-fit-plan.md   |   8 +
 lib/chat/chat-routing.ts                           |  17 +-
 lib/chat/clarification-offmenu.ts                  |  24 ++
 lib/chat/routing-dispatcher.ts                     | 156 +++-
 5 files changed, 335 insertions(+), 196 deletions(-)
```

---

## Investigation Process

1. **Initial symptom:** "yes" after "Did you mean Widget Manager?" → "I didn't catch that. Reply first or second..."
2. **First hypothesis:** Tier 3b (affirmation without context) was handling "yes" incorrectly
3. **Debug log query:** Revealed `clarification_mode_intercept` caught "yes" BEFORE the dispatcher — the clarification intercept runs first
4. **Root cause identified:** `classifyResponseFit()` → `short_hint_no_overlap` (0.2 confidence) because "yes" has zero token overlap with option labels
5. **Fix implemented:** Affirmation shortcut in `classifyResponseFit()` before the short-hint check
6. **Second test round:** Affirmation shortcut didn't fire — `clarificationType` was `panel_disambiguation` but shortcut only checked `option_selection`
7. **Fix expanded:** Added `panel_disambiguation` to the scope
8. **Third test round:** Shortcut fired but used generic escalation message
9. **UX fix:** Added targeted "Which one? Reply first, second, third..." prompt for `affirmation_multiple_options`
10. **Fourth test round:** All multi-option tests pass with correct prompt

---

## Risks / Limitations

1. **Single-option auto-select not yet tested** — needs "open widget managr" (single typo) to trigger near-match pill, then "yes"
2. **Tier S suggestion flows not manually tested** — rejection, single-candidate affirm, multi-candidate affirm
3. **`panel_disambiguation` type not reached via mapping** — debug logs show `clarificationType: "option_selection"` even for panel disambiguation. The `panel_disambiguation` scope expansion is a safety net but may not be necessary. Needs investigation to confirm the `originalIntent` mapping in `chat-routing.ts:3303`.
4. **Affirmation shortcut doesn't reset attemptCount** — repeated "yes" still increments the counter. On attempt 2+ exit pills appear. This is acceptable behavior (user should pick an ordinal, not keep saying "yes").

---

## Next Steps

- [ ] Test single-option affirmation: "open widget managr" → "Did you mean Widget Manager?" → "yes" → auto-select
- [ ] Test Tier S suggestion flows (reject, affirm single, affirm multiple)
- [ ] Test stale suggestion cleanup: "stop" with active suggestion → suggestion cleared
- [ ] Investigate why `panel_disambiguation` maps to `option_selection` in the intercept (line 3303 mapping)
- [ ] Consider whether repeated "yes" should reset attemptCount instead of incrementing
