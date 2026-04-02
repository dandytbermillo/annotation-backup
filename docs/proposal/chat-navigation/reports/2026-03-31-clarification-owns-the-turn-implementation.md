# Clarification-Owns-The-Turn: Slices 1-2 + Provenance Unification

**Date:** 2026-03-31
**Slug:** chat-navigation
**Status:** Runtime-verified

---

## Summary

Implemented the "clarification owns the turn" policy from the governing plan (`clarification-vs-active-surface-priority-plan.md`). When a clarifier is active, no other routing lane may take over first. Ordinals are deterministic; label/name matches go through bounded LLM.

### Changes delivered

1. **Arbiter gate** (Slice 1) — skip entire cross-surface arbiter when clarification is active
2. **Ordinal-only deterministic** (Slice 2) — label matches like "entries" go to bounded LLM, not deterministic execution
3. **Bounded LLM auto-execute** — removed generic-phrase veto from the bounded clarification path
4. **Provenance unification** — new `bounded_clarification` provenance (🎯 Bounded-Selection badge) for both intercept and Tier 3.6 lanes
5. **Truthful provenance** — `llm_influenced` only when LLM actually attempted + suggested
6. **Clarification escape policy** — non-generic inputs stay in bounded option set when clarification is active

---

## Slice 1: Arbiter Gate

**Problem:** The cross-surface arbiter in the outer `dispatchRouting` wrapper ran BEFORE the tier chain. Bare nouns ("entries") and ordinals ("the first one") were classified by the LLM arbiter as ambiguous/state_info, producing "I'm not sure what you're referring to" or "The visible panels are:..." instead of reaching the intercept for selection matching.

**Root cause:** The arbiter's outer gate at `routing-dispatcher.ts:~1990` had no clarification-active guard. All inputs entered the arbiter regardless of whether a clarifier was showing.

**Fix:** Single guard at the outer gate: `&& !hasActiveClarification` where `hasActiveClarification = ctx.pendingOptions.length > 0 || !!ctx.lastClarification`. Per-branch guards (panel_widget.state_info, coarse-guardrail) reverted — outer gate covers all branches.

**Diagnostic trail:** Added breadcrumb `console.log` at 8 points through the outer wrapper to trace where "entries" and "the first one" got stuck. Discovered the arbiter intercepted them before the tier-chain gate.

---

## Slice 2: Ordinal-Only Deterministic

**Problem:** `findMatchingOptions("entries", options)` returned 1 match → deterministic execution via `evaluateDeterministicDecision`. Per the governing plan, label/name matches must NOT be deterministic — only ordinals are.

**Policy (from governing plan lines 201-207):**
- Deterministic: `1`, `2`, `first`, `second`, `the first one`, `option 1`
- NOT deterministic: `entries`, `entry`, `home`, `open entries`
- After deterministic miss → bounded LLM on same option set
- After bounded LLM miss → re-show same clarification with escape guidance

**Fix (two sites):**

1. **Intercept** (`chat-routing-clarification-intercept.ts:~1538`): Added `isOrdinalInput` check using `isSelectionOnly(trimmedInput, ..., 'embedded')`. Only auto-execute when `matchingOptions.length === 1 && isOrdinalInput`. Non-ordinal single matches set `preferredCandidateHint` (advisory) and fall through to the unresolved hook → bounded LLM.

2. **Context decision helper** (`context-decision-helper.ts:~216`): `clarification_selection` mode only returned for ordinals via `isOrdinalSelection()`. Non-ordinal label matches return `mode: 'none'` — fall through to intercept's bounded LLM.

---

## Bounded LLM Auto-Execute

**Problem:** After Slice 2, "entries" correctly reached the bounded LLM, but the auto-execute gate at `chat-routing-clarification-intercept.ts:~1846` had `&& !isGenericAmbiguousPanelPhrase(trimmedInput)` — vetoing execution for generic phrases like "entries".

**Fix:** Removed the generic-phrase veto from the bounded-clarification auto-execute path. During active clarification, the bounded LLM selects from the SAME option set the user sees — "entries" matching "Entries" is a valid bounded selection, not an unsafe auto-execute.

**Advisory hint:** When `findMatchingOptions` returns 1 non-ordinal match, the match is passed as `preferredCandidateHint` (source: `'label_match'`) to bias the bounded LLM. Added `'label_match'` to `PreferredCandidateHint` source type in `chat-routing-types.ts`.

---

## Provenance Unification

**Problem:** Bounded-clarification selections showed different badges depending on which lane executed:
- Intercept path → 🎯 Bounded-Selection (green) ✅
- Dispatcher Tier 3.6 path → 🧠 Auto-Executed (blue) ❌

**Root causes:**
1. Tier 3.6 constrained-LLM selection at `routing-dispatcher.ts:~5690` had no `_devProvenanceHint`
2. `chat-navigation-panel.tsx:~2695` unconditionally overwrote provenance to `llm_executed`
3. Re-show clarifier at `chat-routing-clarification-intercept.ts:~2032` returned `llm_influenced` even when only a local hint fired (no actual LLM attempt)

**Fixes:**
1. Tier 3.6: added `_devProvenanceHint: 'bounded_clarification'` to the return block
2. `chat-navigation-panel.tsx:~2695`: preserves `bounded_clarification` from `routingResult._devProvenanceHint` instead of overwriting
3. Re-show provenance: only `llm_influenced` when `llmResult.attempted && llmResult.suggestedId`; otherwise `safe_clarifier`

**New provenance value:** `bounded_clarification` added to:
- `ChatProvenance` type (`chat-navigation-context.tsx`)
- Badge styles (`ChatMessageList.tsx`): 🎯 Bounded-Selection, green
- Routing log mapping (`routing-log/mapping.ts`): `decision_source: 'llm'`, `result_status: 'executed'`

**All provenance sites covered:**

| Lane | File | Status |
|------|------|--------|
| Intercept bounded LLM auto-execute | `chat-routing-clarification-intercept.ts:~1890` | `bounded_clarification` |
| Tier 3.6 constrained-LLM select | `routing-dispatcher.ts:~5705` | `bounded_clarification` |
| Selection typo LLM select | `routing-dispatcher.ts:~5072` | `bounded_clarification` |
| Grounding deterministic select | `routing-dispatcher.ts:~6182` | `bounded_clarification` |
| Grounding deterministic select (message fallback) | `routing-dispatcher.ts:~6221` | `bounded_clarification` |
| Grounding referent-execute | `routing-dispatcher.ts:~6698` | context-aware remap |
| Scope-cue ordinal select | `chat-routing-scope-cue-handler.ts:~275` | `bounded_clarification` |
| B1 replay (message + badge setter) | `chat-navigation-panel.tsx:~1893, ~1934` | context-aware remap |
| Navigate API fallthrough | `chat-navigation-panel.tsx:~3224` | context-aware remap |
| Select-option handler | `chat-navigation-panel.tsx:~2695` | preserves from routing result |

**No false positives observed:** "open recent" during active clarification correctly shows Deterministic-Surface.

---

## Clarification Escape Policy

**Problem:** `isGenericAmbiguousPanelPhrase("that entry navigatpr")` returned false (>1 content token), so the context decision helper let it escape to general routing — producing an unrelated entry list instead of staying in the bounded option set.

**Fix:** In `context-decision-helper.ts:~176`, the escape to `mode: 'none'` for non-generic inputs now only fires when NO clarification is active (`!hasClarificationContext`). When `pendingOptions` exist, all inputs stay in the bounded option set for the bounded LLM to handle.

---

## Other Fixes

- **Grounding clarifier state sync** (`routing-dispatcher.ts:~6979`): Grounding clarifier now sets `pendingOptions` + `lastClarification` alongside message pills. Previously only the navigate API path set these.
- **`findMatchingOptions` prioritization** (`chat-routing-clarification-utils.ts`): exact label > canonical token > substring. Prevents "entries" from matching both "Entries" and "entries Links Panel cc".
- **Duplicate key fix** (`SelectionPills.tsx:37`): `key={option.id-${index}}` prevents React warning for duplicate UUIDs.
- **`handleSelectOption` null guard** (`chat-navigation-panel.tsx:~922`): `(option.data ?? {})` prevents crash when `data` is undefined from `ClarificationOption` sources.

---

## Files Modified

| File | Changes |
|------|---------|
| `lib/chat/routing-dispatcher.ts` | Arbiter gate, Tier 3.6 provenance, grounding clarifier state sync, diagnostic breadcrumbs |
| `lib/chat/chat-routing-clarification-intercept.ts` | Ordinal-only deterministic, bounded LLM veto removal, label_match hint, truthful provenance |
| `lib/chat/context-decision-helper.ts` | `isOrdinalSelection()`, clarification escape policy, ordinal-only `clarification_selection` |
| `lib/chat/chat-routing-clarification-utils.ts` | Prioritized `findMatchingOptions` |
| `lib/chat/chat-routing-types.ts` | `'label_match'` in `PreferredCandidateHint` |
| `lib/chat/chat-navigation-context.tsx` | `'bounded_clarification'` in `ChatProvenance` |
| `components/chat/ChatMessageList.tsx` | 🎯 Bounded-Selection badge style |
| `components/chat/chat-navigation-panel.tsx` | Provenance preservation, null guard |
| `components/chat/SelectionPills.tsx` | Duplicate key fix |
| `lib/chat/routing-log/mapping.ts` | `bounded_clarification` routing log mapping |

---

## Verification

### Type-check
```
$ npm run type-check
EXIT_CODE=0
```

### Runtime verification

| Scenario | Expected | Actual | Badge |
|----------|----------|--------|-------|
| "open entries" (no clarifier) | Multi-option clarifier | ✅ Clarifier with 4-5 options | LLM-Clarifier |
| "the first one" after clarifier | Deterministic → option 1 | ✅ Opening Entries... | Deterministic |
| "entries" after clarifier | Bounded LLM → Entries | ✅ Opening Entries... | Bounded-Selection |
| "entry navigator" after clarifier | Bounded LLM → Entry Navigator | ✅ Opening Entry Navigator... | Bounded-Selection |
| "that entry navigator c please" | Bounded LLM → Entry Navigator C | ✅ Opening Entry Navigator C... | Bounded-Selection |
| "i wnat that entry navigator d" | Bounded LLM → Entry Navigator D (typo-tolerant) | ✅ Opening Entry Navigator D... | Bounded-Selection |
| "open links panel b" during clarifier | Specific-target escape (Memory-Exact) | ✅ Opening Links Panel B... | Memory-Exact |
| "open that budget100" during clarifier | Specific-target escape (Memory-Exact) | ✅ Opening entry "budget100 B"... | Memory-Exact |
| "open entries" repeated after selection | Fresh clarifier (not stale recovery) | ✅ New clarifier shown | LLM-Clarifier |

---

## Next Steps

- [ ] Implement Slice 4: stale-state lifetime controls (turn-based expiry for `clarificationSnapshot`)
- [ ] Implement Slice 5: active-surface wiring through shared helper
- [ ] Implement Slice 6: telemetry fields
- [ ] Remove diagnostic `console.log` statements after behavior is stable
- [ ] Clarification wording improvement (token-derived option sets)
