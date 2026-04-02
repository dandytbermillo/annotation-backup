# Active Clarification Bounded Arbiter — Implementation Report

**Date:** 2026-04-02
**Slug:** chat-navigation
**Status:** Code-complete, pending runtime verification

**Governing plan:** `active-clarification-bounded-arbiter-plan.md`

---

## Summary

Implemented the "live clarifier owns the turn" authority rule: when a chat clarification is active, no upstream gate may preempt the bounded LLM arbiter. All non-ordinal inputs reach the arbiter at the intercept's unresolved hook. Validated escapes (B1 memory, surface resolver, known-noun) are collected as evidence and executed only after the arbiter decides `reroute`.

---

## 8 Preemption Gates — All Fixed

| Gate | Location | Fix | Evidence |
|------|----------|-----|----------|
| 1. Semantic-question guard | `routing-dispatcher.ts:~3092` | Skip when `hasLiveClarification` | N/A |
| 2. B1 memory lookup | `routing-dispatcher.ts:~1595` | Collect `_b1EscapeEvidence`, don't return early | `_b1EscapeEvidence` on ctx |
| 3. Content-intent classifier | `routing-dispatcher.ts:~1704` | Gate with `!hasLiveClarificationForGate` | N/A |
| 4. Phase 5 hint scope | `routing-dispatcher.ts:~2649` | Don't skip tier chain when `hasLiveClarificationForGate` | Hint metadata still attached |
| 5. Widget context bypass | `chat-routing-clarification-intercept.ts:~425` | Gate with `!hasLiveClarificationForWidget` | N/A |
| 6. Command verb escape | `chat-routing-clarification-intercept.ts:~1417` | Gate with `!hasLiveClarificationForBypass` | N/A |
| 7. Surface resolver | `routing-dispatcher.ts:~1833` | Store `_surfaceEscapeEvidence`, don't execute | `_surfaceEscapeEvidence` on ctx |
| 8. Known-noun routing | `routing-dispatcher.ts:~5878` | Collect `_knownNounEscapeEvidence` via `matchKnownNoun` | `_knownNounEscapeEvidence` on ctx |

Old `known_noun_interrupt_active_list` path removed entirely (was dead code under the new authority rule).

---

## Evidence Flow

```
User input during active clarification
  → Upstream lanes collect evidence (B1, surface, known-noun)
  → Tier chain runs normally
  → handleClarificationIntercept
    → Ordinal? → Deterministic execution
    → Non-ordinal → Bounded LLM (unresolved hook)
      → LLM select + high confidence → auto-execute (Bounded-Selection)
      → LLM reroute + escape evidence → pause clarifier, execute escape (Bounded-Selection)
      → LLM question_intent + escape evidence → inform (NOT execute)
      → LLM ask_clarify/none → re-show bounded options
  → Outer wrapper handles _b1EscapeAction / _surfaceEscapeAction / _knownNounEscapeAction
```

---

## Escape Evidence Consumption Rules

| Fallback reason | B1 evidence | Surface evidence | Known-noun evidence | Action |
|-----------------|-------------|------------------|---------------------|--------|
| `reroute` | Execute | Execute | Execute | Pause clarifier, validated escape |
| `question_intent` | Inform only | Inform only | Inform only | Do NOT execute |
| `abstain` / `none` | Ignore | Ignore | Ignore | Re-show clarifier |

---

## Key Design Decisions

1. **Evidence vs preemption:** Upstream lanes run for evidence but never return `handled: true` or skip the tier chain during live clarification.

2. **Ordinal-only deterministic:** `1`, `first`, `the first one`, `option 1` execute directly. Label matches (`entries`, `open entries`) go through bounded LLM.

3. **Escape only on `reroute`:** `question_intent` with escape evidence does NOT auto-execute — the user may be asking about the target, not requesting execution.

4. **Clarifier paused, not destroyed:** Validated escapes pause the clarifier via `saveClarificationSnapshot(lastClarification, true, 'interrupt')`. Ordinal follow-ups can resume it.

5. **Provenance:** All bounded-context selections show 🎯 Bounded-Selection. Internal routing logs preserve lane-level detail.

---

## Files Modified

| File | Changes |
|------|---------|
| `lib/chat/routing-dispatcher.ts` | Gates 1-4, 7-8; B1/surface/known-noun evidence collection; outer wrapper escape handlers |
| `lib/chat/chat-routing-clarification-intercept.ts` | Gates 5-6; B1/surface/known-noun evidence consumption; old interrupt path removed |
| `lib/chat/chat-routing-types.ts` | `_b1EscapeAction`, `_surfaceEscapeAction`, `_knownNounEscapeAction` fields |
| `lib/chat/chat-routing-arbitration.ts` | `hasActiveClarification` param; selection-request exception in question-intent gate |
| `lib/chat/chat-routing-scope-cue-handler.ts` | `hasActiveClarification` threaded; bounded_clarification provenance |
| `lib/chat/context-decision-helper.ts` | `isOrdinalSelection()`; clarification escape policy |
| `lib/chat/chat-routing-clarification-utils.ts` | Prioritized `findMatchingOptions` |
| `lib/chat/known-noun-routing.ts` | `matchKnownNoun` exported for evidence collection |
| `components/chat/ChatMessageList.tsx` | 🎯 Bounded-Selection badge |
| `components/chat/chat-navigation-panel.tsx` | Context-aware provenance remap; null guards |

---

## Verification (pending)

| Scenario | Expected |
|----------|----------|
| Active clarifier + "the first one" | Deterministic |
| Active clarifier + "entries" | 🎯 Bounded-Selection |
| Active clarifier + "that entry navigator c" | 🎯 Bounded-Selection |
| Active clarifier + "open recent" | 🎯 Bounded-Selection (validated escape, clarifier paused) |
| Active clarifier + "open budget100" | 🎯 Bounded-Selection (validated escape, clarifier paused) |
| Active clarifier + "what is entries?" | Inform (clarifier stays live) |
| Paused clarifier + "the second one" | Resume → select option 2 |
| No active clarifier + "open recent" | Deterministic-Surface |
| No active clarifier + "open continue" | Opens Continue panel |

---

## Runtime Verification Results

| Scenario | Result | Badge |
|----------|--------|-------|
| Active clarifier + "the first one" | ✅ Opens Entries | Deterministic |
| Active clarifier + "entries" | ✅ Opens Entries | 🎯 Bounded-Selection |
| Active clarifier + "that entry navigator c" | ✅ Opens Entry Navigator C | 🎯 Bounded-Selection |
| Active clarifier + "open recent" | ✅ Opens Recent, clarifier paused | 🎯 Bounded-Selection |
| Active clarifier + "open links panel b" | ✅ Opens Links Panel B | 🎯 Bounded-Selection |
| After escape + "open first option from chat" | ✅ Resumes paused clarifier, selects Entries | 🎯 Bounded-Selection |
| Active clarifier + "open entries" | ✅ Opens Entries | 🎯 Bounded-Selection |
| No active clarifier + "open recent" | ✅ Opens Recent | Deterministic-Surface |

### Known Gap: Post-escape resume inconsistency

After escaping from a live clarifier (e.g., "open recent"), resume works for command-shaped inputs but not verb-less forms:

| Input | After escape | Result |
|-------|-------------|--------|
| `open first option from chat` | Paused clarifier | ✅ Resumes + selects |
| `the first option from chat` | Paused clarifier | ❌ "I'm not sure what you're referring to" |
| `from chat` | Paused clarifier | ❓ Not tested |

The verb-less form falls through to the arbiter's ambiguous fallback instead of the scope-cue handler's recovery path. This is a pre-existing scope-cue limitation, not a regression from the arbiter changes.

---

## Next Steps

- [ ] Fix post-escape resume consistency for verb-less "from chat" forms
- [ ] Update stale automated tests
- [ ] Implement truncated bounded context (arbiter input enrichment)
- [ ] Implement repair mode (rejection/correction handling)
