# Raw Strict Exact Policy Enforcement — Implementation Report

**Date**: 2026-02-24
**Feature slug**: `chat-navigation`
**Commits**: `f9a871d1`, `806bd142`, `40a326b7`, `0aa01c15` (on `main`)
**Base**: `90fa1766` (commandBypassesLabelMatching)

---

## Summary

Enforced the raw-strict-exact policy across the entire grounding-set fallback pipeline (Tier 4.5). The policy states:

1. **Exact** (`rawInput.toLowerCase().trim() === candidateLabel.toLowerCase().trim()`) **only** qualifies for deterministic execution (`handled: true`)
2. **Non-exact** inputs must route to bounded LLM → safe clarifier — never deterministic

Before this work, multiple paths violated the policy by performing deterministic execution after input transformations (verb stripping, fuzzy Levenshtein matching, token-subset matching, widget-label stripping). These violations caused wrong-domain candidates (e.g., summary144/155 widget items instead of panel candidates) for inputs like "open links panel pls", "hi you open the recent widget", etc.

---

## Policy Violations Found and Fixed

### Violation 1: `isExplicitCommand` used substring matching
**File**: `lib/chat/input-classifiers.ts:23-39`
**Problem**: `actionVerbs.some(verb => normalized.includes(verb))` matched verbs anywhere in the sentence — "what did you **open**?" and "should I **show** this?" were classified as commands, but "you open the recent" was NOT (missing prefix pattern).
**Fix**: Replaced with anchored regex `IMPERATIVE_VERB_INITIAL` that only matches verb-initial imperative forms. Added `you\s+(?:please\s+|pls\s+)?` prefix to recognize directed imperatives ("you open...").

### Violation 2: `matchVisiblePanelCommand` used verb-stripped input
**File**: `lib/chat/panel-command-matcher.ts:207`
**Problem**: `canonicalizeCommandInput(input)` stripped verb prefixes before panel token matching. "open links panel d" became "links panel d" — verb stripping was used for routing-authoritative decisions.
**Fix**: Changed to `normalizeToTokenSet(input)` (raw input). Verb tokens like "open" are preserved — they don't appear in panel titles, so they prevent false matches. `normalizeToTokenSet` still handles advisory normalization (repeated letters, fuzzy canonical, stopword filtering).

### Violation 3: `normalizeToTokenSet` stopword filter order bug
**File**: `lib/chat/panel-command-matcher.ts:130-152`
**Problem**: Stopword filter ran BEFORE normalization. "plsss" bypassed the filter, then normalized to "pls" and polluted the token set.
**Fix**: Reversed order — normalize first (dedup repeated letters, canonical tokens, fuzzy distance), then filter stopwords. Now "plsss" → "pls" → filtered.

### Violation 4: `stripVerbPrefix` used for routing decisions
**File**: `lib/chat/panel-command-matcher.ts:183-196`
**Problem**: Exported function used by Tier 2c and Tier 4 for candidate matching.
**Fix**: Deprecated. Marked with `@deprecated` JSDoc. `matchVisiblePanelCommand` no longer calls it.

### Violation 5: `STOPWORDS` not shared
**File**: `lib/chat/panel-command-matcher.ts:48`
**Problem**: `STOPWORDS` was private (`const`). Grounding-set needed the same set for stopword-filtered word counting.
**Fix**: Exported as `export const STOPWORDS`.

### Violation 6: Tier 2c question-intent gate blocked imperative commands
**File**: `lib/chat/routing-dispatcher.ts:1316-1330`
**Problem**: `hasQuestionIntent("open links panel plsss??")` returned true (trailing `??`), blocking the input from Tier 2c panel disambiguation.
**Fix**: Added `isExplicitCommand` bypass — verb-initial imperative forms skip the question-intent gate.

### Violation 7: Mode gate blocked `visible_panels` grounding set
**File**: `lib/chat/routing-dispatcher.ts:2825-2837`
**Problem**: `ctx.uiContext?.mode === 'dashboard'` gate prevented `visibleWidgets` from being passed to the grounding context. Step 2.6 (visible_panels LLM fallback) was dead code when mode wasn't exactly `'dashboard'`.
**Fix**: Removed mode guard. `dashboardVisibleWidgets = ctx.uiContext?.dashboard?.visibleWidgets` — presence of the data is the signal.

### Violation 8: Tier 4 near-match hijacked command-form inputs
**File**: `lib/chat/known-noun-routing.ts:568-580`
**Problem**: "open links panels" → near-match to "Quick Links" → Tier 4 returned `handled: true` before Tier 4.5 could check visible_panels.
**Fix**: Added `isExplicitCommand` guard — command-form inputs skip near-match, defer to Tier 4.5.

### Violation 9: Tier 4 hard-stopped when visible panel evidence existed
**File**: `lib/chat/known-noun-routing.ts:453-468`
**Problem**: When `realPanel` was null, Tier 4 only deferred for "ambiguous partial-match evidence" (multiple family members). Single panel evidence was hard-stopped.
**Fix**: Changed to `hasVisiblePanelEvidence` — any match evidence (partial or exact, any count) defers to Tier 4.5.

### Violation 10: Tier 1b.3 used verb-stripped matching for option targeting
**File**: `lib/chat/chat-routing.ts:4530-4538`
**Problem**: `inputTargetsActiveOption` used `canonicalizeCommandInput` + `findMatchingOptions` — verb stripping determined whether stale options were cleared.
**Fix**: Changed to `isStrictExactMatch(trimmedInput, opt.label)` — raw strict exact only.

### Violation 11: Tier 1b.3 polite-wrapper match executed deterministically
**File**: `lib/chat/chat-routing.ts:4779-4820`
**Problem**: `findPoliteWrapperExactMatch` → deterministic execute (legacy path). Polite wrappers strip "can you open..." — not raw exact.
**Fix**: Removed legacy execute path entirely. Polite-wrapper match is now advisory-only (`preferredCandidateHint`), always deferred to bounded LLM.

### Violation 12: Tier 1b.3 used verb-stripped union for option matching
**File**: `lib/chat/chat-routing.ts:4832-4845, 4891-4900`
**Problem**: `findMatchingOptions` ran on both raw and verb-stripped input, union of results. Verb-stripped matches influenced deterministic decisions.
**Fix**: Raw input only — `findMatchingOptions(normalizedInput, ...)` and `findExactNormalizedMatches(normalizedInput, ...)`. No verb-stripped union.

### Violation 13: `exact_canonical` match kind executed deterministically
**File**: `lib/chat/input-classifiers.ts:731-738`
**Problem**: `evaluateDeterministicDecision` returned `outcome: 'execute'` for `exact_canonical` matches in non-strict mode. Canonical token matching (singular/plural normalization) is not raw exact.
**Fix**: Always returns `outcome: 'llm'`, `confidence: 'medium'` — advisory only.

### Violation 14: Widget-reference path used `resolveUniqueDeterministic`
**File**: `lib/chat/grounding-set.ts:762-768` (removed)
**Problem**: `resolveWidgetSelection()` → `resolveUniqueDeterministic()` → deterministic execution. The resolver used verb stripping (line 368-369), token-subset matching (372-409), and fuzzy Levenshtein (383-398).
**Fix (iteration 1)**: Changed `resolveWidgetSelection` to use `resolveStrictRawDeterministic`. But this was still non-compliant because...

### Violation 15: Widget-reference path rewrote input before strict resolver
**File**: `lib/chat/grounding-set.ts:548-555`
**Problem**: `resolveWidgetSelection` strips the widget label and prepositions from input before matching. "recent summary 144" → "summary 144" → strict exact match → deterministic. The comparison was `strippedInput === candidateLabel`, not `rawInput === candidateLabel`.
**Fix (iteration 2)**: Removed the entire deterministic execution from the widget-reference branch. The branch now only logs diagnostic info and falls through. Widget-scoped inputs reach Step 2.5 (raw strict exact) or Step 2.7 (widget-list LLM fallback).

### Violation 16: Step 3 fallback used `resolveUniqueDeterministic`
**File**: `lib/chat/grounding-set.ts:944`
**Problem**: Same fuzzy resolver as Violation 14 — verb stripping, token-subset, Levenshtein.
**Fix**: Replaced with `resolveStrictRawDeterministic(trimmed, firstListSet.candidates, options)`.

### Violation 17: Step 2.6 substantive guard blocked panel evidence
**File**: `lib/chat/grounding-set.ts:884-938` (removed)
**Problem**: `inputWordCount` heuristic, `hasActiveOptions` gate, and `hasStrongMultiWordMatch` logic prevented panel evidence from reaching the bounded LLM. "hi you open the recent widget pls" → word count too high → evidence blocked.
**Fix**: Removed all gates. When `matchVisiblePanelCommand` finds token-subset evidence, matched candidates go directly to bounded LLM (`needsLLM: true`).

---

## Files Modified

| File | Lines changed | Changes |
|---|---|---|
| `lib/chat/grounding-set.ts` | -93/+41 (net) | Removed widget-reference deterministic path; replaced `resolveUniqueDeterministic` with `resolveStrictRawDeterministic` at Step 3; removed substantive guard/hasActiveOptions/hasStrongMultiWordMatch from Step 2.6; decoupled Step 2.6 from widgetListSets block; imported STOPWORDS and isExplicitCommand |
| `lib/chat/input-classifiers.ts` | -10/+15 | Rewrote `isExplicitCommand` to anchored verb-initial regex; added "you..." prefix; `exact_canonical` → always LLM; `findPoliteWrapperExactMatch` docstring → advisory only; `inputTargetsActiveOption` → `isStrictExactMatch` |
| `lib/chat/panel-command-matcher.ts` | -10/+16 | Exported `STOPWORDS`; deprecated `stripVerbPrefix`; `matchVisiblePanelCommand` uses raw input; fixed stopword filter order (normalize before filter) |
| `lib/chat/routing-dispatcher.ts` | -22/+21 | Removed mode gate on `dashboardVisibleWidgets`; passed `visiblePanels` to grounding context; added `isExplicitCommand` bypass in question-intent gate |
| `lib/chat/chat-routing.ts` | -73/+16 | Removed legacy polite-wrapper execute path; removed verb-stripped union matching; `inputTargetsActiveOption` uses `isStrictExactMatch` |
| `lib/chat/known-noun-routing.ts` | -3/+18 | Added `isExplicitCommand` guard on near-match; broadened visible panel evidence deferral |

---

## Current `handled: true` Paths in `handleGroundingSetFallback`

All audited and compliant:

| Line | What | Input to resolver | Resolver | Compliant |
|---|---|---|---|---|
| 739 | Multi-list clarifier | N/A — asks question | N/A | Yes (not execution) |
| 806 | Step 2.5 active widget strict | `trimmed` (raw) | `resolveStrictRawDeterministic` | Yes |
| 837 | Step 2.5 unique cross-list strict | `trimmed` (raw) | `resolveStrictRawDeterministic` | Yes |
| 939 | Step 3 first-list strict | `trimmed` (raw) | `resolveStrictRawDeterministic` | Yes |

`resolveStrictRawDeterministic` allows only:
- Strict whole-string ordinal ("first", "2nd", "3")
- Raw exact label match (case-insensitive, no stripping)
- Badge letter ("a"-"e" when `hasBadgeLetters: true`)

No verb stripping, no token-subset, no fuzzy Levenshtein, no input rewriting.

---

## Regression Tests

**File**: `__tests__/unit/chat/strict-deterministic-grounding.test.ts` (27 tests)

### Section A: `resolveWidgetSelection` — strict resolver enforcement
- 3 positive: exact label, ordinal, badge letter after widget strip → matched
- 8 negative: verb prefix, show prefix, view prefix, verb after widget, politeness prefix, full polite command, extra words + pls, greeting + command → NOT matched

### Section B: `handleGroundingSetFallback` — non-exact commands never deterministic
- 11 negative (all must return `handled: false`):
  - Command forms: "hi can you open the recent widget", "hi you open the recent widget pls", "hello assistant. you open the recent widget pls", "open recent summary 144", "show recent summary 155", "can you open the recent widget pls"
  - Widget-scoped rewritten forms: "recent summary 144", "recent first", "from recent summary 144", "in the recent summary 144", "the recent summary 155"
- 3 positive: exact ordinal "first", badge "a", exact label "option a" → deterministic OK

### Section C: Step 2.6 — panel evidence always `needsLLM: true`
- 2 positive: "open recent" and "links panel d" with visible panels → `needsLLM: true`

---

## Validation

```
$ npx tsc --noEmit -p tsconfig.type-check.json
(clean — no errors)

$ npx jest --no-coverage __tests__/unit/chat/ __tests__/integration/chat/
Test Suites: 35 passed, 35 total
Tests:       816 passed, 816 total
```

---

## Iteration History

1. **Iteration 1** (commit `806bd142`): Implemented plan from previous session — removed mode gate, exported STOPWORDS, decoupled Step 2.6, removed NON_LIST_CANDIDATE_CAP on visible_panels. Tests showed "open recent pls" still getting wrong-domain candidates.

2. **Iteration 2** (commit `40a326b7`): Identified widget-reference branch (line 745-789) as primary root cause — hijacked non-explicit commands before Step 2.6. Removed path 2 early return. Extended `isExplicitCommand` with "you..." prefix. Removed substantive guard from Step 2.6.

3. **Iteration 3** (commit `0aa01c15`): User audit revealed remaining violations — `resolveUniqueDeterministic` at widget-reference path 1 and Step 3 still did fuzzy/token-subset deterministic execution. Replaced both with `resolveStrictRawDeterministic`.

4. **Iteration 4** (this session, uncommitted): User audit revealed widget-reference path still violated policy via input rewriting (label stripping before strict resolver). Removed deterministic execution from widget-reference branch entirely — now diagnostic-only logging.

---

## Known Limitations

- `isExplicitCommand` does NOT recognize arbitrary greeting prefixes ("hi open...", "hello open..."). These fall through to the widget-reference detection (diagnostic only) and then to Steps 2.5-2.7. The LLM handles resolution — no deterministic execution occurs.
- `resolveWidgetSelection` still exists as an exported function (used by widget-ui-snapshot-plan tests) but is no longer called from any deterministic execution path in `handleGroundingSetFallback`. It could be removed or deprecated in a future cleanup.
- `resolveUniqueDeterministic` still exists and is exported — other test files reference it. No deterministic execution path in `handleGroundingSetFallback` uses it anymore.
