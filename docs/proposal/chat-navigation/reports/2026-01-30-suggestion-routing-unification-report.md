# Suggestion Routing Unification — Implementation Report

**Date:** 2026-01-30
**Plan:** `docs/proposal/chat-navigation/plan/panels/chat/meta/suggestion-routing-unification-plan.md`
**Status:** Code-complete, type-check passing, awaiting manual testing

---

## Summary

Moved suggestion rejection and affirmation routing from inline blocks in `sendMessage()` into the unified routing dispatcher as **Tier S**, placed between Tier 2g (Preview Shortcut) and Tier 3 (Clarification). This completes the routing unification — all user input now flows through `dispatchRouting()` in a single priority chain.

---

## Changes

### `lib/chat/routing-dispatcher.ts` (+156 lines)

1. **Context type additions** (lines 97–101):
   - `lastSuggestion: LastSuggestionState | null`
   - `setLastSuggestion`, `addRejectedSuggestions`, `clearRejectedSuggestions`

2. **Result type addition** (lines 172–185):
   - `suggestionAction?` field with three variants: `affirm_single`, `affirm_multiple`, `reject`

3. **Tier S implementation** (lines ~815–935):
   - **Rejection branch**: Detects `isRejectionPhrase()`, clears suggestion state, adds rejection labels, sends alternative-prompt message, returns `{ handled: true, suggestionAction: { type: 'reject' } }`
   - **Affirmation single-candidate**: Returns `{ handled: true, suggestionAction: { type: 'affirm_single', candidate } }` — API call executed by `sendMessage()`
   - **Affirmation multi-candidate**: Sends "Which one?" message with candidate list, returns `{ handled: true, suggestionAction: { type: 'affirm_multiple' } }`

4. **Stale suggestion cleanup** (line 515):
   - When clarification intercept handles input (Tiers 0/1/interrupt), clears `lastSuggestion` to prevent stale confirm/reject on next turn

### `components/chat/chat-navigation-panel.tsx` (-193 / +124 lines net reduction)

1. **Removed**: ~190 lines of inline rejection detection and affirmation handling that previously short-circuited the dispatcher
2. **Added**: `dispatchRouting()` call now passes suggestion context fields (`lastSuggestion`, `setLastSuggestion`, `addRejectedSuggestions`, `clearRejectedSuggestions`)
3. **Added**: Post-dispatch `affirm_single` handler (~100 lines) that executes the `/api/chat/navigate` API call when the dispatcher returns `suggestionAction.type === 'affirm_single'`
4. **Added**: Stale suggestion cleanup at generic `routingResult.handled` return — if a non-suggestion tier handled the input while `lastSuggestion` was active, clears it (line 1553)

---

## Design Decisions

| Decision | Rationale |
|----------|-----------|
| Dispatcher is routing-only | Avoids large context surface; `sendMessage()` still owns API calls and side-effects |
| Tier S placed after Tier 2g | Stop/cancel (T0), return (T1), and explicit commands (T2) must override suggestions per acceptance tests S3/S4 |
| `suggestionAction` on result | Typed discriminated union enables `sendMessage()` to handle each case without casting |
| Stale cleanup in two places | Defense in depth: dispatcher clears on intercept handled; `sendMessage()` clears on any non-suggestion handled result |

---

## Acceptance Test Coverage

| Test | Scenario | Coverage |
|------|----------|----------|
| S1 | Reject suggestion ("no" with lastSuggestion) | Tier S rejection branch clears state, sends alternatives |
| S2 | Affirm single candidate ("yes" with 1 candidate) | Tier S returns `affirm_single`; `sendMessage()` executes API call |
| S3 | Stop overrides suggestion ("stop" with lastSuggestion) | Tier 0 in intercept fires first; stale cleanup clears suggestion |
| S4 | Interrupt overrides suggestion ("open recent" with lastSuggestion) | Tier 2 fires first; stale cleanup clears suggestion |
| S5 | Affirm multi-candidate ("yes" with multiple candidates) | Tier S sends "Which one?" message with candidate list |

---

## Verification

### Type-check
```bash
$ npx tsc --noEmit
__tests__/unit/use-panel-close-handler.test.tsx(87,1): error TS1005: ')' expected.
```
Only pre-existing test file error. Zero errors in changed files.

### Git status
```
M components/chat/chat-navigation-panel.tsx  (+124 / -193)
M lib/chat/routing-dispatcher.ts             (+156)
```

---

## Risks / Limitations

1. **Manual testing not yet performed** — Rejection, affirmation (single + multi), and stop-with-suggestion flows need live verification
2. **`affirm_multiple` preserves suggestion state** — By design, but if the user then sends a command instead of selecting, the stale cleanup should handle it (covered by the generic handled check)
3. **`handledByTier: 2` for Tier S** — Tier S uses `handledByTier: 2` in the return (same numeric bucket as interrupt commands). If analytics needs to distinguish, a dedicated tier number (e.g., 2.5) could be added later.

---

## Next Steps

- [ ] Manual testing of all 5 acceptance scenarios (S1–S5)
- [ ] Verify telemetry events fire correctly for suggestion_reject, suggestion_affirm_single, suggestion_affirm_multiple
- [ ] Consider adding `handledByTier: 'S'` if analytics needs tier-level distinction
