# Implementation Report: Tier 2 Noun-Only Interrupt & Post-Action Selection Gate

**Date:** 2026-01-31
**Scope:** Two amendments to `routing-order-priority-plan.md` — Tier 2 item 8 (noun-only interrupt) and Tier 1 post-action selection gate
**File modified:** `lib/chat/chat-routing.ts` (92 insertions, 2 deletions)

---

## Summary

Implemented two plan amendments from `routing-order-priority-plan.md`:

1. **Fix D — Tier 2 noun-only interrupt:** Allows known-noun commands (e.g., "widget manager") to escape an active clarification list when there is no label overlap and no question signal.
2. **Fix E — Post-action selection gate:** Prevents garbage input (e.g., "anel layot") from being mis-selected via the post-action ordinal window's fuzzy normalization.

---

## Changes

### Fix D — Noun-Only Interrupt (Tier 2 item 8)

**Problem:** When a clarification list is active (e.g., "Links Panels / Links Panel D / Links Panel E"), typing "widget manager" was trapped by the response-fit classifier as `ask_clarify` (short_hint_no_overlap, confidence 0.2), re-showing the list with "I didn't catch that..." instead of opening Widget Manager.

**Root cause (two layers):**

1. **Layer 1 — Noun-only interrupt block bypassed:** The block at line ~3330 had a guard `!isNewQuestionOrCommandDetected`, but for "widget manager" the flag was already `true` at line 1414 via `isBareNounNewIntent` (2 tokens, no action verbs, matches known terms). So the entire noun-only interrupt block was skipped.

2. **Layer 2 — Response-fit classifier consumed the input:** The classifier guard at line 3387 ran unconditionally (`lastClarification?.options && lastClarification.options.length > 0`), classified "widget manager" as `ask_clarify`, escalated, and returned `{ handled: true }`. The new-intent escape at line 4027 was never reached.

**Fix applied (two parts):**

- **Part 1 — Explicit noun-only interrupt block** (line ~3330, safety net): Added a block before the response-fit classifier that checks `matchKnownNoun()` + no label overlap + no question intent. If matched, it pauses the active list and returns `{ handled: false }` so the dispatcher routes to Tier 4. This block only fires when `isNewQuestionOrCommandDetected` is not already set (edge case where bare-noun detector doesn't catch a known noun).

- **Part 2 — Skip response-fit when new intent detected** (line 3387, primary fix): Added `&& !isNewQuestionOrCommandDetected` to the response-fit classifier guard. When the flag is already `true`, the classifier is skipped entirely. Control falls through to:
  - Line 3926: fuzzy-resemblance check (does input look like a pending option?) — "widget manager" doesn't resemble "Links Panel D" etc.
  - Line 4027: new-intent escape fires — pauses list, clears state
  - Returns `{ handled: false }` — dispatcher continues to Tier 4 → `handleKnownNounRouting()` → exact match → Widget Manager opens

**Imports added:**
- `hasQuestionIntent` from `@/lib/chat/query-patterns` (line 31)
- `matchKnownNoun` from `@/lib/chat/known-noun-routing` (line 68)

**Variable change:**
- `const isNewQuestionOrCommandDetected` → `let isNewQuestionOrCommandDetected` (line 1413) to allow Tier 2 block to set the flag

### Fix E — Post-Action Selection Gate (Tier 1)

**Problem:** After a clarification was resolved and a snapshot saved, typing garbage like "anel layot" triggered the post-action ordinal window. The per-token fuzzy normalizer (Levenshtein distance ≤ 2) converted "layot" → "last", then `extractOrdinalFromPhrase` matched `\blast\b` and selected the last option.

**Root cause:** The post-action selection window had no strictness gate — any input that fuzzy-normalized to an ordinal would trigger selection, even complete garbage.

**Fix applied** (line ~1951): Added a gate before post-action selection that requires input to be **strictly selection-like**:
- Contains a recognized ordinal keyword (`first`, `second`, `third`, `last`, `1st`, `2nd`, etc.)
- OR is a bare digit (`1`-`9`) or letter (`a`-`e`)
- OR matches `option N` pattern
- OR exactly matches an option label (case-insensitive)

If none of these match, the input is logged as `post_action_selection_gate_blocked` and falls through to downstream handlers (Tier 4 unknown-noun fallback).

---

## Debug Log Evidence (verified at runtime)

### Fix D — "widget manager" with active list
```
clarification_mode_intercept        | widget manager
clarification_exit_new_intent       | widget manager         ← new-intent escape fires
known_noun_command_execute          | widget manager | tier 4 | widget-manager
drawer_opened_from_chat                                      ← Widget Manager opens
```
No `clarification_response_fit` log — classifier was successfully skipped.

### Fix E — "anel layot" post-action
```
post_action_selection_gate_blocked  | anel layot | input_not_strictly_selection_like
unknown_noun_fallback_shown         | anel layot | tier 4
```
Gate blocked the garbage, fell through to Tier 4 unknown-noun fallback: "I'm not sure what 'anel layot' refers to."

### Other verified behaviors (no regressions)
| Input | Active list? | Result | Log action |
|---|---|---|---|
| "links panel" | no | Disambiguation (3 options) | `panel_disambiguation_pre_llm` |
| "links panel d" | yes (links) | Opens Links Panel D | selection |
| "links panel" | yes (Quick Links) | Re-shows options | `clarification_tier1b4_fuzzy_reshow` |
| "linkspanel" | no | "Did you mean Quick Links?" | `known_noun_near_match_prompt` |
| "cancel" | yes | Confirm prompt | `clarification_tier1a_exit_confirm` |
| "yes" (after cancel) | confirm active | List cleared | `clarification_tier1a_exit_confirmed` |
| "what is widget manager" | yes | Docs response | `skip_panel_disambiguation_question_intent` |

---

## Validation

```bash
$ npx tsc --noEmit
# Only pre-existing error in __tests__/unit/use-panel-close-handler.test.tsx(87,1)
# No errors in chat-routing.ts
```

---

## Plan Alignment

| Plan item | Status |
|---|---|
| Tier 2 item 8: noun-only interrupt (no overlap, no question) | Implemented + verified |
| Tier 1: post-action selection gate (anti-garbage guard) | Implemented + verified |
| Acceptance test 2b: "widget manager" while list active → executes + pauses | Passing |
| Anti-garbage: "anel layot" not mis-selected | Passing |

---

## Risks / Limitations

- **Response-fit skip scope:** Adding `!isNewQuestionOrCommandDetected` to the classifier guard means ANY input detected as new intent at line 1414 bypasses the classifier. This is correct per the plan (Tier 2 wins over Tier 3), but if the bare-noun detector (`isBareNounNewIntent`) or fuzzy-match detector (`isFuzzyMatchNewIntent`) ever produces false positives, those inputs would skip clarification. The fuzzy-resemblance check at line 3926 mitigates this by catching typo-like inputs that resemble pending options.

- **Noun-only interrupt block redundancy:** The explicit block at line 3330 is now a safety net — for "widget manager" it never fires because `isNewQuestionOrCommandDetected` is already `true`. It would fire for known nouns that aren't in the bare-noun known-terms list but are in the `KNOWN_NOUN_MAP`. If the two lists are kept in sync, the block is functionally dead code but harmless.

---

## Next Steps

- Full 11-case manual test pass (remaining cases from the implementation checklist)
- Consider whether the noun-only interrupt block (line 3330) should be removed or kept as a safety net
- Monitor for false positives from the bare-noun detector bypassing the classifier
