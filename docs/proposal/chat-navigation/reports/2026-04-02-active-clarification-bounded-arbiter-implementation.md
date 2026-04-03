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

### Post-escape resume — FIXED

All resume forms now work after escape:

| Input | After escape | Result | Badge |
|-------|-------------|--------|-------|
| `open first option from chat` | Paused clarifier | ✅ Resumes + selects Entries | 🎯 Bounded-Selection |
| `the first option from chat` | Paused clarifier | ✅ Resumes + selects Entries | 🎯 Bounded-Selection |
| `the second option from chat` | Paused clarifier | ✅ Resumes + selects Entry Navigator | 🎯 Bounded-Selection |
| `from chat` | Paused clarifier | ✅ Re-shows paused options as visible clarifier with pills | 🎯 Bounded-Selection |

**Fixes applied:**
- Arbiter gate includes `!!ctx.clarificationSnapshot` so paused snapshots prevent arbiter takeover
- Standalone "from chat" re-anchor emits visible assistant message with pills (was silent)

### Known limitations (pre-B2)

| Issue | Status |
|-------|--------|
| Typo in escape command ("opeen recent") → re-clarify instead of escape | LLM quality — surface resolver doesn't fuzzy-match typos |
| Multi-evidence fixed precedence (B1 > surface > known-noun) | Structural — untested in practice |
| Pre-LLM escape shortcut bypasses bounded arbiter for non-overlapping targets | Pragmatic — LLM unreliable for reroute decisions |

---

## Slice B2: Clean Implementation Pass (2026-04-02)

Unified escape architecture: all escape evidence flows through the bounded LLM arbiter as the sole decision point. No pre-LLM shortcuts.

### Changes (7 steps)

| Step | Change | File(s) |
|------|--------|---------|
| 1. Fix Gate 3 nesting | `!hasLiveClarificationForGate` moved inside STAGE6 block to gate only content-intent classifier, not surface resolver/arbiter | `routing-dispatcher.ts` |
| 2. Delete pre-LLM escape shortcut | Removed 30-line shortcut that bypassed arbiter for non-overlapping targets | `chat-routing-clarification-intercept.ts` |
| 3. Unify semantic source | Legacy B2 `lookupSemanticMemory` no longer stores escape evidence; Phase 5 `lookupSemanticHints` is sole semantic escape source | `routing-dispatcher.ts` |
| 4. Concrete escape payload | 4 boolean flags → `ConcreteEscapeAction` discriminated union with self-contained evidence | `chat-routing-types.ts`, `chat-routing-clarification-intercept.ts`, `routing-dispatcher.ts` |
| 5. Symmetric `__escape_*` handling | `runBoundedArbitrationLoop` preserves `choiceId` for reroute decisions; `buildConcreteEscapeAction` helper | `chat-routing-arbitration.ts`, `chat-routing-clarification-intercept.ts` |
| 6. Evidence-based provenance | `ExecutionSourceTag` type; 3 panel remap sites prefer `_executionSource` over ambient state | `chat-routing-types.ts`, `chat-navigation-panel.tsx` |
| 7. Tests | 17 unit tests for escape builder, precedence, self-containment, contract | `bounded-arbiter-escape.test.ts` |

### Additional fix: escape propagation

Escape action paths returned `handled: false`, preventing `_escapeAction` from reaching the outer wrapper (only `handled: true` results propagate). Changed all 4 escape paths to `handled: true`. Without this fix, the navigate API handled "open recent" via LLM fallthrough instead of the bounded arbiter escape.

### Slice B2 runtime verification

| Scenario | Result | Badge |
|----------|--------|-------|
| Active clarifier + "open recent" | ✅ Opens Recent, clarifier paused | 🎯 Bounded-Selection |
| Active clarifier + "openn recent" (typo) | ✅ Opens Recent, clarifier paused | 🎯 Bounded-Selection |
| After escape + "open that option 1 from chat" | ✅ Resumes + selects Entries | 🎯 Bounded-Selection |
| After escape + "open that option 2 from chat" | ✅ Resumes + selects Entry Navigator | 🎯 Bounded-Selection |
| Active clarifier + "pls open recent widget" | ✅ Opens Recent | 🎯 Bounded-Selection |
| After resume + "open entries" | ✅ Fresh clarifier | LLM-Clarifier |
| No active clarifier + "open recent" | ✅ Opens Recent | Deterministic-Surface |

### Known limitations (post-B2)

| Issue | Status | Severity |
|-------|--------|----------|
| Semantic escape branch (`routing-dispatcher.ts:~2825`) falls through generically instead of replaying the concrete semantic target | Open implementation gap — `escapeAction.semanticEvidence` carries intent_id, slots_json, target_ids but the outer wrapper sets `handled: false` instead of executing | Medium |
| Winning escape source for "openn recent" — **verified: surface** | Console log confirms: `{ source: 'surface', choiceId: '__escape_surface_recent' }`. Exact internal surface-resolver subpath (raw seed vs rewrite-assisted) not identified from this log alone. Semantic escape path was not the winning source for this input. | Resolved — semantic replay gap is untested (not disproven), non-blocking for surface-resolvable inputs |
| Reroute precedence (B1 > surface > knownNoun > semantic) in `buildConcreteEscapeAction` is fixed, not LLM-driven | Only applies when LLM returns `reroute` without a specific `__escape_*` choiceId | Low — LLM usually selects a specific candidate |

### Diagnostic: escape source for "openn recent" — VERIFIED

Console output (2026-04-02 21:58):
```
[dispatcher] ESCAPE ACTION EXECUTING: {input: 'openn recent', source: 'surface', choiceId: '__escape_surface_recent'}
```

**Result:** Surface resolver wins. The log confirms `source: 'surface'` but does not identify which internal surface-resolver subpath handled the typo (raw seeded retrieval, rewrite-assisted retrieval, or another recovery path). The semantic escape path (Phase 5 `lookupSemanticHints`) was not the winning source for this input.

**Implication:** The semantic escape branch's generic fallthrough (`routing-dispatcher.ts:~2825`) is a real open gap — untested, not disproven. It is not reachable for inputs that the surface resolver already handles. To trigger the semantic branch, an input would need to:
1. Not match any surface resolver seed (surface evidence absent)
2. Match a Phase 5 semantic hint (semantic evidence present)
3. Have the bounded LLM select the `__escape_semantic_*` candidate

No such test case has been demonstrated yet.

---

## Next Steps

- [ ] Verify winning escape source for "openn recent" from console logs
- [ ] Implement concrete semantic replay (semantic escape branch at `routing-dispatcher.ts:~2825`)
- [ ] Implement truncated bounded context (arbiter input enrichment)
- [ ] Implement repair mode (rejection/correction handling)
