# Universal Selection Resolver — Remaining Gaps Fix Report

**Date:** 2026-02-11
**Feature slug:** `chat-navigation`
**Governing plan:** `universal-selection-resolver-plan.md`

---

## Summary

Fixed 4 bugs in the Universal Selection Resolver implementation:

1. **`isCommandLike` question-intent bypass** — Imperative commands with trailing `?` (e.g., "open that summary144 now plssss?") were misclassified as questions, allowing cross-corpus to intercept them instead of routing to widget/entry resolution.

2. **Universal resolver question-intent filter local regex drift** — The `resolveSelectionFollowUp()` function had a local regex for polite commands instead of using shared utilities. Replaced with `isPoliteImperativeRequest` + `isCommandLike` from `query-patterns.ts`.

3. **`clearChat` missing widget context clear** — Phase 6 violation: clearing chat didn't clear `widgetSelectionContext`, potentially leaving stale widget selection state.

4. **Stop/exit paths missing widget context clear** — Phase 6 violation: 4 stop/exit paths in `handleClarificationIntercept` cleared `focusLatch` but not `widgetSelectionContext`.

---

## Changes

### 1. `lib/chat/query-patterns.ts` (+3 lines, -1 line)

**Line 458:** Replaced `hasQuestionIntent(normalized)` with `QUESTION_INTENT_PATTERN.test(normalized)` in `isCommandLike()`.

- Before: `hasActionVerb(normalized) && !hasQuestionIntent(normalized)` — `hasQuestionIntent` returns true for trailing `?`, blocking action verbs
- After: `hasActionVerb(normalized) && !hasQuestionWordPrefix && !containsDocInstructionCue(normalized)` — only actual question-word prefixes (what/how/why/is/etc.) block action verbs

### 2. `lib/chat/routing-dispatcher.ts` (+3 lines, -5 lines)

**Line 62:** Added `isCommandLike`, `isPoliteImperativeRequest` to imports from `query-patterns.ts`.

**Lines 500-510:** Replaced local regex `isPoliteCommand` with shared utilities:
```typescript
// Before (local regex):
const isPoliteCommand = /^(can|could|would)\s+(you\s+)?(please\s+)?/.test(normalizedInput)
    && ACTION_VERB_PATTERN.test(input)
if (hasQuestionIntent(input) && !isPoliteCommand) { return { handled: false } }

// After (shared utilities):
if (hasQuestionIntent(input) && !isPoliteImperativeRequest(input) && !isCommandLike(input)) { return { handled: false } }
```

### 3. `components/chat/chat-navigation-panel.tsx` (+1 line)

**Line 2688:** Added `clearWidgetSelectionContext()` to `clearChat` callback + dependency array.

### 4. `lib/chat/chat-routing.ts` (+4 lines)

Added `clearWidgetSelectionContext()` after `clearFocusLatch()` at all 4 stop/exit paths:
- Line 2331 (Tier 0 stop-confirmed)
- Line 3267 (Tier 1a explicit exit, 2nd+ time)
- Line 3343 (Tier 1a confirmed exit after ambiguous)
- Line 3416 (Tier 1a explicit exit, options visible)

### 5. `__tests__/unit/chat/selection-vs-command-arbitration.test.ts` (+38 lines)

Added `isCommandLike` import and 5 new test cases:
- Imperative commands with trailing `?` are commands
- Imperative commands without trailing `?` remain commands
- Actual questions remain non-commands
- Doc instruction cues remain non-commands
- Polite imperative requests are commands

### 6. `__tests__/integration/chat/panel-disambiguation-tier-ordering.test.ts` (+100 lines)

Added `describe` block with 3 E2E blocker tests:
- **BLOCKER:** "open that summary144 now plssss?" with focus latch must NOT hit cross-corpus AND must resolve entry (positive + negative assertion)
- **BLOCKER:** Cross-corpus handler returns `{handled: false}` for imperative command with trailing `?`
- **Regression guard:** Genuine question "what is summary144?" still routes normally

---

## Test Results

```
Type-check:
$ npx tsc --noEmit
__tests__/unit/use-panel-close-handler.test.tsx(87,1): error TS1005: ')' expected.
(Pre-existing, unrelated — documented in MEMORY.md)

All 3 test suites:
$ npx jest selection-vs-command-arbitration panel-disambiguation-tier-ordering provenance-badge --no-coverage --runInBand
PASS __tests__/unit/chat/selection-vs-command-arbitration.test.ts (51 tests)
PASS __tests__/integration/chat/panel-disambiguation-tier-ordering.test.ts (36 tests)
PASS __tests__/unit/chat/provenance-badge.test.tsx (4 tests)
Test Suites: 3 passed, 3 total
Tests:       91 passed, 91 total
```

---

## Root Cause Analysis

`hasQuestionIntent()` at `query-patterns.ts:354`:
```typescript
return QUESTION_INTENT_PATTERN.test(normalized) || normalized.endsWith('?')
```

The `endsWith('?')` clause was designed to catch questions without explicit question words. But in practice, users often append `?` to imperative commands ("open that summary144 now plssss?"). This caused `isCommandLike` to return `false`, which:

1. **Cross-corpus handler** (line 113): `isCommandLike` guard failed → handler processed the command → cross-corpus disambiguation shown instead of widget entry resolution
2. **Universal resolver** (line 508): Question-intent filter blocked the input → no selection follow-up attempt
3. **Dispatcher cross-corpus skip** (line 1132): `skipCrossCorpusForFocusLatch` requires `isSelectionLike(input)`, which is false for imperative commands → guard didn't protect against cross-corpus

**Fix strategy:** Decouple "question-word prefix" detection from "trailing `?`" detection in `isCommandLike`. Use `QUESTION_INTENT_PATTERN.test()` (prefix-only) instead of `hasQuestionIntent()` (prefix + trailing `?`).

---

## Risks/Limitations

1. **Trailing `?` on ambiguous inputs**: "delete this?" is now treated as a command (action verb "delete", no question-word prefix). This is correct behavior — the user is issuing a command with informal punctuation, not asking a question.

2. **`hasQuestionIntent` not changed globally**: The original `hasQuestionIntent()` function is unchanged. Only `isCommandLike` and `resolveSelectionFollowUp` bypass the trailing-`?` clause. Other callers still get the full behavior.

---

## Acceptance Test Mapping

| Plan Test | Status | Evidence |
|-----------|--------|----------|
| #6: Explicit command escape with active context | PASS | Integration test: "open that summary144 now plssss?" → known_noun, not cross_corpus |
| #7a: Standalone unresolved no-escape blocker | PASS | Integration test: cross-corpus not invoked for imperative + `?` |
| #4: Question-intent gate | PASS | Regression test: "what is summary144?" routes normally |
| Phase 6: Stop clears both contexts | FIXED | 4 stop/exit paths + clearChat now clear widgetSelectionContext |
