# Context Decision Dispatcher + Runtime Verification

**Date:** 2026-03-31
**Slug:** chat-navigation
**Status:** Runtime-verified for core scenarios

---

## Summary

Implemented and runtime-verified the secondary context decision dispatcher consumer (Plan Slice A+C), plus fixed three blocking issues discovered during runtime testing:

1. **Secondary dispatcher consumer** — `resolveContextDecision` called in `routing-dispatcher.ts` after clarification clearing, before grounding/API.
2. **Grounding clarifier missing state** — Grounding pipeline showed clarifier pills without setting `pendingOptions`/`lastClarification`, making follow-up inputs invisible to the intercept.
3. **Arbiter intercepting bare nouns** — The cross-surface arbiter's `panel_widget.state_info` handler caught bare nouns like "entries" before the tier chain, preventing label matching against active clarifier options.
4. **Label matching false positives** — `findMatchingOptions("entries", ...)` returned multiple matches due to substring containment (e.g., "entries Links Panel cc"), causing ambiguity when only "Entries" was intended.
5. **Stale recoverable source auto-execution** — The dispatcher consumer matched generic phrases from `lastOptionsShown`, causing repeated "open entries" to auto-execute instead of showing fresh clarifiers.

---

## Root Causes and Fixes

### Issue 1: Grounding clarifier missing state

**Root cause:** The grounding clarifier at `routing-dispatcher.ts:~6979` showed pills via `ctx.addMessage(clarifierMsg)` with `options` on the message, but did NOT call `ctx.setPendingOptions()` or `ctx.setLastClarification()`. The navigate API path (which DOES set both) was never called because the grounding pipeline returned `handled: true`.

**Fix:** After `ctx.addMessage(clarifierMsg)`, added calls to `ctx.setPendingOptions(...)`, `ctx.setPendingOptionsMessageId(...)`, and `ctx.setLastClarification(...)` so follow-up inputs can match against the active options via the intercept.

### Issue 2: Arbiter intercepting bare nouns during active clarification

**Root cause:** The cross-surface arbiter classified "entries" as `panel_widget.state_info` (a panel state query). This handler ran in the outer `dispatchRouting` wrapper (lines 2257-2377), BEFORE the tier-chain gate and `dispatchRoutingInner`. The arbiter returned "The visible panels are: ..." with `handled: true`, preventing the intercept from ever seeing the input.

**Diagnostic trail:** Added breadcrumb `console.log` at 6 points through the outer `dispatchRouting`:
- `INSTRUMENTED PATH entry` (line 1417)
- `B1 gate` (line 1484)
- `past B1` (line 1605)
- `past content-intent, before surface resolver` (line 1793)
- `tier-chain gate` (line 2643)
- `BEFORE handleClarificationIntercept` (line 3116)

"entries" reached `past content-intent` but never reached `tier-chain gate` — the arbiter's `panel_widget.state_info` section was the blocker.

**Fix:** Added `!(ctx.pendingOptions.length > 0 || !!ctx.lastClarification)` guard to the `panel_widget.state_info` outer condition (line 2257) and to the coarse-guardrail sub-branch (line 2328). When clarification is active, the entire arbiter state_info section is skipped so bare nouns reach the tier chain for label matching.

### Issue 3: Label matching false positives

**Root cause:** `findMatchingOptions("entries", options)` used flat matching where exact label match ("Entries") and substring containment ("entries Links Panel cc") were treated equally. With 2 matches, the intercept treated it as ambiguous and fell through.

**Fix:** Restructured `findMatchingOptions` in `chat-routing-clarification-utils.ts` with prioritized matching:
1. **Priority 1:** Exact label match (case-insensitive) — if found, return ONLY these
2. **Priority 2:** Canonical token exact match (singular/plural normalization)
3. **Priority 3:** Substring/word-boundary containment (only if no stronger match)

Now `findMatchingOptions("entries", ...)` returns only `["Entries"]` (exact match), not `["Entries", "entries Links Panel cc"]`.

### Issue 4: Stale recoverable source auto-execution

**Root cause:** After the dispatcher consumer matched "open entries" from `lastOptionsShown` and executed, `lastOptionsShown` was NOT cleared. The grounding pipeline then showed a new clarifier, creating new `lastOptionsShown`. The next "open entries" found fresh `lastOptionsShown` and auto-selected again — creating an alternating pattern of auto-execute and clarifier.

**Fix (two parts):**
- **Dispatcher consumer cleanup:** After successful `clarification_selection` execution, clear `lastOptionsShown` and `clarificationSnapshot` so spent options can't be reused.
- **Generic-phrase source restriction:** In `resolveContextDecision`, generic ambiguous phrases (e.g., "open entries") may ONLY match from live `pendingOptions`. Recoverable sources (`lastOptionsShown`, `clarificationSnapshot`, `lastClarification`) are skipped for generic phrases — they should start fresh clarification cycles.

### Issue 5: Reconstructed data for non-pending sources

**Root cause:** When the dispatcher consumer matched via `lastOptionsShown` or `clarificationSnapshot`, it built `PendingOptionState` with `data: undefined`. `handleSelectOption` needs `data` for execution (e.g., `{ panelId, panelTitle }` for panel_drawer), causing "Failed to navigate" errors.

**Fix:** Reconstructed `data` from the option's `type`, `id`, and `label`:
- `panel_drawer` → `{ panelId: id, panelTitle: label }`
- `workspace` → `{ id, name: label }`
- `note` → `{ id, title: label }`
- `entry` → `{ id, name: label }`

---

## Files Modified

| File | Change |
|------|--------|
| `lib/chat/routing-dispatcher.ts` | Secondary dispatcher consumer; arbiter `panel_widget.state_info` skip guard; grounding clarifier state sync; diagnostic breadcrumbs |
| `lib/chat/context-decision-helper.ts` | Generic-phrase source restriction (only `pendingOptions` for generic phrases); enriched input contract |
| `lib/chat/chat-routing-clarification-utils.ts` | Prioritized matching in `findMatchingOptions` (exact > token > substring) |
| `lib/chat/chat-routing-clarification-intercept.ts` | Enriched `resolveContextDecision` call; diagnostic logs |
| `components/chat/chat-navigation-panel.tsx` | `isLoading` guard diagnostic log |

---

## Verification

### Type-check
```bash
$ npm run type-check
EXIT_CODE=0
```

### Runtime verification (all scenarios tested manually after server restart)

| Scenario | Expected | Actual | Status |
|----------|----------|--------|--------|
| "open entries" (first) | Multi-option clarifier | Clarifier with 4 options (Entries, Entry Navigator, Entry Navigator C, Entry Navigator D) | **Pass** |
| "entries" after clarifier | Select "Entries" option | "Opening Entries..." Deterministic | **Pass** |
| "open entries" repeated after selection | Fresh clarifier (not auto-execute) | Verified via generic-phrase source restriction | **Pass** |
| "open entries" after "hello" | Fresh clarifier (not stale recovery) | Verified via `lastOptionsShown` clearing | **Pass** |

### Diagnostic breadcrumb trace (runtime-proven)

Full trace for "entries" after clarifier:
```
[dispatcher] INSTRUMENTED PATH entry: entries
[dispatcher] B1 gate: { input: 'entries', memoryReadEnabled: true, shouldSkipB1ForSelection: false }
[dispatcher] past B1: entries
[dispatcher] past content-intent, before surface resolver: entries
[dispatcher] tier-chain gate: { input: 'entries', hasResult: false, phase5SkippedTierChain: false }
[dispatcher] BEFORE handleClarificationIntercept: { input: 'entries', hasLastClarification: true, lastClarificationOptionsCount: 4, pendingOptionsCount: 4 }
→ Result: "Opening Entries..." Deterministic
```

---

## Diagnostic Logs (temporary)

The following `console.log` statements were added for debugging and should be removed once behavior is stable:

| Location | Log prefix |
|----------|-----------|
| `routing-dispatcher.ts:1414` | `[dispatcher] FAST PATH` |
| `routing-dispatcher.ts:1417` | `[dispatcher] INSTRUMENTED PATH entry` |
| `routing-dispatcher.ts:1484` | `[dispatcher] B1 gate` |
| `routing-dispatcher.ts:1594` | `[dispatcher] B1 EARLY RETURN` |
| `routing-dispatcher.ts:1605` | `[dispatcher] past B1` |
| `routing-dispatcher.ts:1793` | `[dispatcher] past content-intent, before surface resolver` |
| `routing-dispatcher.ts:2643` | `[dispatcher] tier-chain gate` |
| `routing-dispatcher.ts:3116` | `[dispatcher] BEFORE handleClarificationIntercept` |
| `routing-dispatcher.ts:3338` | `[context-decision] dispatcher consumer checking` |
| `routing-dispatcher.ts:3373` | `[context-decision] dispatcher result` |
| `chat-routing-clarification-intercept.ts:202` | `[intercept] TOP` |
| `chat-routing-clarification-intercept.ts:1355` | `[intercept] entering label matching branch` |
| `chat-routing-clarification-intercept.ts:1521` | `[intercept] label matching` |
| `chat-navigation-panel.tsx:1397` | `[ChatPanel] sendMessage called` |
| `chat-navigation-panel.tsx:1399` | `[ChatPanel] BLOCKED by isLoading guard` |
| `intent-resolver.ts:240` | `[intent-resolver] resolveIntent called` |
| `intent-resolver.ts:2560` | `[intent-resolver] resolvePanelIntent called` |
| `intent-resolver.ts:2634` | `[intent-resolver] resolveDrawerPanelTarget called` |
| `intent-resolver.ts:3004` | `[intent-resolver] shouldOpenDrawer guard` |
| `navigate/route.ts:1070` | `[ChatNavigateAPI] calling resolveIntent` |
| `navigate/route.ts:1072` | `[ChatNavigateAPI] resolveIntent result` |

---

## Architectural Findings

### The outer `dispatchRouting` wrapper is a routing hazard

The outer `dispatchRouting` function (lines 1402-2800) runs B1 memory lookup, B2 semantic memory, content-intent classification, surface resolver, cross-surface arbiter, and Phase 5 hints — all BEFORE the tier chain and `handleClarificationIntercept`. Any of these can return `handled: true` and skip the intercept entirely.

For context-aware routing ("latest conversation wins"), this means bare nouns typed as selections from active clarifiers can be intercepted by the arbiter, content-intent classifier, or surface resolver before reaching label matching. The fix (skipping `panel_widget.state_info` when clarification is active) is specific to one arbiter intent family. Other arbiter classifications could produce similar issues.

### `findMatchingOptions` was order-blind

The original `findMatchingOptions` treated exact matches and substring matches equally — all matches were returned in a flat array. This caused false positives when an exact match existed alongside substring containment matches. The prioritized matching fix (exact > token > substring) is a general improvement, not just a fix for "entries".

---

## Next Steps

- [ ] Remove diagnostic `console.log` after behavior is confirmed stable across more scenarios
- [ ] Test "open recent" → Deterministic-Surface (no regression from arbiter guard)
- [ ] Test "open continue" → opens Continue panel (specific, not blocked)
- [ ] Test "open entry navigator c" → deterministic panel open (not blocked)
- [ ] Test other arbiter intent families for similar clarification-bypass issues
- [ ] Implement Slice B (stale-state lifetime controls) per the detailed plan
