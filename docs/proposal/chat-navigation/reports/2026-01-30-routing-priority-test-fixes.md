# Implementation Report: Routing Priority — Test-Driven Fixes

**Date:** 2026-01-30
**Follows:** `2026-01-30-routing-order-priority-plan-implementation.md`
**Plans referenced:**
- `routing-order-priority-plan.md` — Tier structure and guards
- `clarification-response-fit-plan.md` — "Selection-Like Typos (NEW)" subsection

---

## Summary

After completing the base routing-order-priority-plan implementation, manual testing revealed three categories of failure. This report covers the fixes for all three, plus the addition of the agreed constrained-LLM fallback flow for unresolved selection typos.

### Issues Found During Testing

| # | Category | Example Input | Observed Behavior | Expected Behavior |
|---|----------|---------------|-------------------|-------------------|
| 1 | Ordinal typo tolerance | "ffirst option", "sedond", "secondoption" | Not recognized → leaked to docs/Tier 5 | Resolve deterministically or via LLM |
| 2 | Question intent override | "what is links panel?" | Caught by Tier 2c panel disambiguation | Route to Tier 5 (docs) |
| 3 | Unknown noun with active list | "panel layoout" (typo, list active) | Tier 4 fuzzy match bound incorrectly | Fall through to LLM with list context |

---

## Fix #1 — Ordinal Typo Tolerance (Deterministic Normalization)

### Problem
Inputs like "ffirst", "sedond", "secondoption" were not matched by the selection guard because `isSelectionOnly()` had no normalization step. These fell through all tiers and hit the general LLM or docs routing.

### Solution
Added `normalizeOrdinalTypos()` — a deterministic normalization pipeline that runs before pattern matching.

### Changes

**`routing-dispatcher.ts:208–234`** — New `normalizeOrdinalTypos()` function:
```typescript
function normalizeOrdinalTypos(input: string): string {
  let n = input.toLowerCase().trim()
  // 1. Strip polite suffixes ("pls", "please", "thx")
  n = n.replace(/\s*(pls|plz|please|thx|thanks|ty)\.?$/i, '').trim()
  // 2. Deduplicate repeated letters: "ffirst" → "first"
  n = n.replace(/(.)\1+/g, '$1')
  // 3. Split concatenated ordinal+option: "secondoption" → "second option"
  n = n.replace(/^(first|second|third|fourth|fifth|last)(option|one)$/i, '$1 $2')
  // 4. Common misspelling map
  const typoMap = {
    'sedond': 'second', 'secod': 'second', 'secnd': 'second',
    'secon': 'second', 'scond': 'second', 'sceond': 'second',
    'frist': 'first', 'fisrt': 'first', 'frst': 'first',
    'thrid': 'third', 'tird': 'third',
    'foruth': 'fourth', 'fouth': 'fourth',
    'fith': 'fifth', 'fifht': 'fifth',
  }
  if (typoMap[n]) n = typoMap[n]
  return n
}
```

- `routing-dispatcher.ts:287` — `isSelectionOnly()` now calls `normalizeOrdinalTypos()` as first step
- `routing-dispatcher.ts:291` — Expanded selection regex to include `first option`, `second option`, etc.

**`chat-routing.ts:1146–1172`** — Same normalization applied to the `isSelectionOnly()` copy in the clarification intercept:
- Line 1147: dedup `(.)\1+` → `$1`
- Line 1149: concat split `secondoption` → `second option`
- Lines 1168–1172: Added typo entries to `ordinalMap` (sedond, sceond, thrid, tird, etc.)

---

## Fix #2 — Question Intent Override

### Problem
"what is links panel?" was caught by Tier 2c (`handlePanelDisambiguation`) because `matchVisiblePanelCommand` uses subset token matching — `{"links", "panel"} ⊆ {"what", "is", "links", "panel"}` succeeds. Tier 4's `isFullQuestionAboutNoun()` would have correctly routed to docs, but it never ran.

### Solution
Added `hasQuestionIntent()` guard at three points to skip matching tiers when the input is a question.

### Changes

**`routing-dispatcher.ts:61`** — Added `hasQuestionIntent` to query-patterns import.

**`routing-dispatcher.ts:554–564`** — Tier 2c question intent guard (before panel disambiguation):
```typescript
if (hasQuestionIntent(ctx.trimmedInput)) {
  // Skip Tier 2c — fall through to Tier 4 isFullQuestionAboutNoun or Tier 5 docs
} else {
  const panelDisambiguationResult = handlePanelDisambiguation({ ... })
  // ...
}
```

**`routing-dispatcher.ts:789`** — Tier 3a selection guard condition updated:
```typescript
// Was: if (ctx.pendingOptions.length > 0 && ctx.activeOptionSetId !== null)
// Now: if (ctx.pendingOptions.length > 0 && ctx.activeOptionSetId !== null && !hasQuestionIntent(ctx.trimmedInput))
```

**`routing-dispatcher.ts:1013`** — Tier 3a fallback selection guard — same `!hasQuestionIntent` condition added.

### Effect
- "what is links panel?" → skips Tier 2c, skips Tier 3a → hits Tier 4 `isFullQuestionAboutNoun()` → returns `true` → skips to Tier 5 (docs)
- "links panel" (no question) → still handled by Tier 2c as before (no regression)

---

## Fix #3 — Unknown Noun Override When List Active

### Problem
When an active option set exists and the user types something that doesn't match any option (e.g., "panel layoout"), Tier 4's fuzzy matching (`findNounNearMatch`, Levenshtein ≤ 2) could incorrectly bind the typo to a known noun, taking the user away from the active list.

### Solution
Added `hasActiveOptionSet` flag to `KnownNounRoutingContext`. When true, Tier 4 skips Steps 4–5 (fuzzy match + unknown noun fallback), returning `{ handled: false }` so the LLM can handle it contextually.

### Changes

**`known-noun-routing.ts:273`** — Added field:
```typescript
/** When true, an active option set is displayed — skip fuzzy/unknown-noun fallbacks (Steps 4–5) */
hasActiveOptionSet?: boolean
```

**`known-noun-routing.ts:490–501`** — Guard before Step 4:
```typescript
if (ctx.hasActiveOptionSet) {
  // Fall through to Tier 5 (LLM can handle contextually with the active list)
  return { handled: false }
}
```

**`routing-dispatcher.ts:1233`** — Passes flag from dispatcher:
```typescript
hasActiveOptionSet: ctx.pendingOptions.length > 0 && ctx.activeOptionSetId !== null,
```

### Effect
- Exact known-noun matches (Step 3) still execute when list is active (strong signal of navigation intent)
- Question signals (Steps 1–2) still correctly skip to docs
- Fuzzy matches and unknown-noun fallbacks (Steps 4–5) are blocked, preventing mis-binding

---

## Constrained LLM Fallback (Steps 2–3 of Agreed Flow)

### Background
The agreed flow for ordinal typo handling is:
1. Try deterministic normalization first → **Fix #1** above
2. If still not matched and input looks selection-like → call Gemini Flash constrained to current options
3. If LLM fails/abstains → `ask_clarify` (NOT route to docs)

Per `clarification-response-fit-plan.md` "Selection-Like Typos (NEW)" subsection.

### Implementation

**`routing-dispatcher.ts:63`** — New import:
```typescript
import { callClarificationLLMClient, isLLMFallbackEnabledClient } from '@/lib/chat/clarification-llm-fallback'
```

**`routing-dispatcher.ts:251–272`** — New `looksSelectionLike()` heuristic:
```typescript
function looksSelectionLike(input: string): boolean {
  // Short input (≤4 words), not a question or command
  // Contains ordinal-like fragments, digit, single letter, or "option"/"choice" keyword
}
```

Signals detected:
- Ordinal-like substrings even if misspelled (fir, sec, thi, etc.)
- Pure digits (1–9) or single letters (a–e)
- Keywords: "option", "choice", "number", "pick", "select"
- Excludes: questions (`hasQuestionIntent`), command verbs (open/show/go/etc.)

**`routing-dispatcher.ts:894–1008`** — Constrained LLM fallback flow at Tier 3a passthrough:

```
isSelectionOnly() fails (deterministic) AND findExactOptionMatch() fails
  │
  ├── looksSelectionLike() = true AND LLM enabled
  │     │
  │     └── callClarificationLLMClient({ options: current list, context: 'selection_typo_fallback' })
  │           │
  │           ├── decision = 'select' + valid choiceId → execute option (tierLabel: selection_typo_llm_select)
  │           ├── decision = 'ask_clarify' | 'none' → safe prompt (tierLabel: selection_typo_llm_ask_clarify)
  │           │     "I couldn't tell which option you meant. Could you try again or say 'back to options'?"
  │           ├── decision = 'reroute' | 'reject_list' → fall through to Tier 4/5
  │           └── LLM error → fall through (graceful degradation)
  │
  └── looksSelectionLike() = false → fall through to Tier 4/5 as before
```

Uses existing infrastructure:
- `callClarificationLLMClient()` from `clarification-llm-fallback.ts`
- Feature-flagged via `NEXT_PUBLIC_CLARIFICATION_LLM_FALLBACK`
- 800ms timeout, confidence thresholds (≥0.6 select, 0.4–0.6 ask_clarify, <0.4 none)

---

## Files Modified

| File | Lines Changed | Summary |
|------|--------------|---------|
| `lib/chat/routing-dispatcher.ts` | +170 | `normalizeOrdinalTypos()`, `looksSelectionLike()`, question intent guards (Tier 2c, 3a, 3a-fallback), constrained LLM fallback flow, `hasActiveOptionSet` pass-through |
| `lib/chat/known-noun-routing.ts` | +13 | `hasActiveOptionSet` context field, guard before Step 4 (fuzzy match) |
| `lib/chat/chat-routing.ts` | +8 | Dedup normalization, concat splitting, typo map entries in clarification-intercept `isSelectionOnly` |

---

## Decision Flow (Updated)

```
User input arrives at Tier 3a (active option set exists)
  │
  ├── hasQuestionIntent? → SKIP Tier 3a entirely (fall to Tier 4/5 → docs)
  │
  ├── normalizeOrdinalTypos() → isSelectionOnly() match?
  │     └── YES → execute option deterministically
  │
  ├── findExactOptionMatch() label match?
  │     └── YES → execute option deterministically
  │
  ├── looksSelectionLike() + LLM enabled?
  │     └── YES → callClarificationLLMClient (constrained to current options)
  │           ├── select → execute
  │           ├── ask_clarify/none → safe prompt (stays in list context)
  │           └── reroute/reject_list/error → fall through
  │
  └── Fall through to Tier 4
        ├── Exact known-noun match → execute (even with active list)
        ├── hasActiveOptionSet? → SKIP fuzzy + unknown noun (return unhandled)
        └── Fall through to Tier 5 (docs/LLM)
```

---

## Validation

### Type-Check

```bash
$ npx tsc --noEmit
# Only pre-existing error: __tests__/unit/use-panel-close-handler.test.tsx(87,1): error TS1005
# Zero errors in changed files:
#   - lib/chat/routing-dispatcher.ts ✅
#   - lib/chat/known-noun-routing.ts ✅
#   - lib/chat/chat-routing.ts ✅
```

### Test Matrix

| Input | Active List? | Expected Route | Fix Applied |
|-------|-------------|----------------|-------------|
| "ffirst option" | Yes | Deterministic → first option | Fix #1 (dedup) |
| "sedond" | Yes | Deterministic → second option | Fix #1 (typo map) |
| "secondoption" | Yes | Deterministic → second option | Fix #1 (concat split) |
| "secnod optin" | Yes | LLM fallback → select or ask_clarify | Steps 2–3 |
| "what is links panel?" | Any | Tier 5 (docs) | Fix #2 |
| "links panel" | Any | Tier 2c (disambiguation) | No change (no regression) |
| "what is recent?" | Any | Tier 4 → isFullQuestionAboutNoun → docs | Fix #2 (skips 2c) |
| "panel layoout" | Yes | Fall through to LLM (not fuzzy noun) | Fix #3 |
| "recent" | Yes | Tier 4 exact match → open panel | No change (exact still works) |
| "widget managr" | No | Tier 4 fuzzy → "Did you mean?" | No change (no active list) |

---

## Known Limitations

1. **`looksSelectionLike()` regex is heuristic**: The ordinal-fragment regex (`fir|sec|thi|...`) could match non-selection inputs. Kept conservative (≤4 words, no questions/commands) to minimize false positives.

2. **LLM fallback requires feature flag**: If `NEXT_PUBLIC_CLARIFICATION_LLM_FALLBACK` is not `'true'`, selection-like typos that fail deterministic normalization will fall through to Tier 4/5 instead of getting the constrained LLM treatment. This is by design (feature flag controls LLM cost).

3. **Two copies of `isSelectionOnly`**: One in `routing-dispatcher.ts` (Tier 3a) and one in `chat-routing.ts` (clarification intercept). Both were updated with the same normalization. Future refactoring could unify them.

4. **`hasActiveOptionSet` blocks all fuzzy in Tier 4**: When list is active, even legitimate known-noun fuzzy matches are blocked. This is conservative — the LLM can still handle these via Tier 5.

---

## Plan Compliance

| Plan Rule | Status | Evidence |
|-----------|--------|----------|
| clarification-response-fit-plan.md "Selection-Like Typos (NEW)": normalize → LLM → ask_clarify | ✅ | `routing-dispatcher.ts:894–1008` |
| routing-order-priority-plan.md: question intent should not be caught by Tier 2c/3a | ✅ | `routing-dispatcher.ts:554` (Tier 2c), `:789` (Tier 3a), `:1013` (Tier 3a fallback) |
| routing-order-priority-plan.md: Tier 4 exact match still works with active list | ✅ | `hasActiveOptionSet` guard is after Step 3 (exact match), before Step 4 (fuzzy) |
| clarification-response-fit-plan.md: confidence < 0.55 → ask_clarify, not docs | ✅ | `callClarificationLLMClient` applies thresholds server-side (≥0.6 select, 0.4–0.6 ask_clarify, <0.4 none) |
