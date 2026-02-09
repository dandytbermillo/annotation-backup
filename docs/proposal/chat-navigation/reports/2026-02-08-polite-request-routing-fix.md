# Polite Request Routing Fix — Shared Canonicalizer + 3-Part Guardrail

**Date:** 2026-02-08
**Feature slug:** chat-navigation
**Plan:** `/Users/dandy/.claude/plans/wiggly-juggling-haven.md`

## Summary

Fixed a bug where polite/verbose commands like "can you open links panel pls", "hey open the links panel", and "could you show the links panel please" failed while clean commands like "open links panel" worked correctly.

**Root cause:** Three cascading failure paths:
1. **Tier 1b.4 fuzzy re-show** swallowed command-like panel intents — core word "link" overlapped with pending options, causing stale option re-show.
2. **Normalization gap** — `stripVerbPrefix` (Tier 2c) and `normalizeForNounMatch` (Tier 4) lacked article stripping and trailing filler removal. "can you open the links panel" → "the links panel" did not match `KNOWN_NOUN_MAP["links panel"]`.
3. **Tier 2c question-intent block** — `hasQuestionIntent` matched `^can\b` on polite commands like "can you open links panel", preventing Tier 2c from running at all.
4. **Tier 4.5 grounding LLM** hijacked command inputs into `buildGroundedClarifier` → "Which option did you mean? sample2 F, sample2, Workspace 4?"

## Changes

### Part 1: Shared command canonicalizer

**File:** `lib/chat/input-classifiers.ts`

- Added `canonicalizeCommandInput()` (~40 lines) — deterministic function that strips polite/verb prefixes (longest first), leading articles, trailing filler words, and trailing punctuation. Shared by Tier 2c and Tier 4 to prevent normalization drift.
- Prefix list covers compound forms: "hey can you open", "can you please open", "could you show", "would you pls open", etc.

**File:** `lib/chat/panel-command-matcher.ts`

- Imported `canonicalizeCommandInput` from `input-classifiers`.
- `stripVerbPrefix()` now delegates to `canonicalizeCommandInput()` (backward compat preserved).
- `matchVisiblePanelCommand()` uses `canonicalizeCommandInput(input)` directly.

**File:** `lib/chat/known-noun-routing.ts`

- Imported `canonicalizeCommandInput` from `input-classifiers`.
- `normalizeForNounMatch()` now delegates to `canonicalizeCommandInput()` — gains article stripping and trailing filler removal.

### Part 2: Tier 1b.4 panel-intent guard

**File:** `lib/chat/chat-routing.ts` (lines 4164-4177)

- Added guard before the fuzzy re-show logic: when `uiContext.mode === 'dashboard'` and `matchVisiblePanelCommand(trimmedInput, dashboardWidgets).type !== 'none'`, the fuzzy re-show is skipped.
- Prevents "can you open links panel pls" from being swallowed by stale Recent panel options.
- Non-panel inputs ("the second one", "workspaces 2b") still trigger fuzzy re-show as before.

### Part 3: Tier 2c question-intent override

**File:** `lib/chat/routing-dispatcher.ts` (lines 1172-1195)

- Refined the `hasQuestionIntent` guard at Tier 2c: before blocking, checks if the input matches visible panels via `matchVisiblePanelCommand`. If panel evidence exists, the question-intent block is overridden — polite commands pass through to Tier 2c.
- "can you open links panel" (matches visible panels) → Tier 2c runs.
- "what is links panel?" (no panel evidence or genuine question) → Tier 2c skipped as before.

### Part 4: Tier 4.5 grounding LLM gate

**File:** `lib/chat/routing-dispatcher.ts` (lines 2824-2842)

- Added narrowed gate: when `isExplicitCommand(input)` AND `matchVisiblePanelCommand(input, visibleWidgets).type !== 'none'`, the grounding LLM is skipped.
- Prevents command-like panel opens from being hijacked into "Which option did you mean?" with wrong widget items.
- Non-command inputs still get LLM fallback normally.

### Part 5: Tests (17 new tests)

**`__tests__/unit/chat/panel-command-matcher.test.ts`** (14 new tests):

`canonicalizeCommandInput` (9 tests):
- "can you open links panel pls" → "links panel"
- "hey can you open the links panel" → "links panel"
- "please open recent panel" → "recent panel"
- "could you show the links panel please" → "links panel"
- "open links panel" → "links panel"
- "links panel" → "links panel" (no-op)
- "open recent" → "recent"
- Trailing punctuation stripping (?, !)
- `stripVerbPrefix` delegates to `canonicalizeCommandInput`

`matchVisiblePanelCommand — polite/natural variants` (5 tests):
- "can you open links panel pls" → partial (3 panels)
- "hey open the links panel" → partial (3 panels)
- "could you show the links panel please" → partial (3 panels)
- "can you open the links panel" → partial (3 panels)
- "please show links panel d" + single panel → exact

**`__tests__/integration/chat/panel-disambiguation-tier-ordering.test.ts`** (3 new tests):
- "can you open links panel pls" + 3 variants → Tier 2c disambiguates
- "hey open the links panel" + single panel → Tier 2c opens directly
- "could you show the links panel please" + 3 variants → Tier 2c disambiguates

## Verification

### Type check
```
$ npx tsc --noEmit
__tests__/unit/use-panel-close-handler.test.tsx(87,1): error TS1005: ')' expected.
```
Only pre-existing error (unrelated to our work).

### Unit + Integration tests
```
$ npx jest __tests__/unit/chat/ __tests__/integration/chat/ --no-coverage --runInBand

Test Suites: 8 passed, 8 total
Tests:       264 passed, 264 total
Time:        0.527 s
```
All 264 tests pass (247 existing + 17 new). No regressions.

## Files Modified

| File | Changes |
|------|---------|
| `lib/chat/input-classifiers.ts` | Added `canonicalizeCommandInput()` (~40 lines) |
| `lib/chat/panel-command-matcher.ts` | Import canonicalizer; `stripVerbPrefix` delegates; `matchVisiblePanelCommand` uses canonicalizer |
| `lib/chat/known-noun-routing.ts` | Import canonicalizer; `normalizeForNounMatch` delegates |
| `lib/chat/chat-routing.ts` | Added panel-match guard at Tier 1b.4 (~12 lines) |
| `lib/chat/routing-dispatcher.ts` | Refined Tier 2c question-intent guard (~15 lines); added Tier 4.5 narrowed gate (~12 lines); upgraded panel-command-matcher import |
| `__tests__/unit/chat/panel-command-matcher.test.ts` | 14 new tests |
| `__tests__/integration/chat/panel-disambiguation-tier-ordering.test.ts` | 3 new tests |

## Manual Test Cases

1. "open links panel" + 3 variants → disambiguation (3 options) — existing behavior preserved
2. "can you open links panel pls" + 3 variants → disambiguation (3 options) — **FIXED**
3. "hey open the links panel" + single panel → opens directly — **FIXED**
4. "could you show the links panel please" + 3 variants → disambiguation — **FIXED**
5. "can you open links panel pls" with active Recent options → goes to panel disambiguation, NOT re-show of stale options — **FIXED**
6. "what is links panel?" → routes to docs (Tier 5) — preserved
7. "the second one" with active options → selects second option — preserved
