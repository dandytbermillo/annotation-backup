# Plan: Stage 6x.8 Phase 3a — Imperative Note-Read Bugfix

## Context

Phase 3 shipped the cross-surface arbiter for note families. Summary/explain-style note reads now work, but command-shaped note-read requests can still miss the `note.read_content` lane and fall through to legacy routing.

Observed failing class:

- `show me the content of that note`
- `show the text of that note`
- `read that note`
- `display the contents of this note`

Observed bad outcome:

- request falls through into entry/panel disambiguation instead of returning a note content answer

This is a Phase 3 classification/fallback bug, not a new surface migration.

## Goal

Make imperative note-read requests route reliably to `note.read_content`, and ensure that if Stage 6 cannot answer after that classification, the turn returns a bounded note-read failure message instead of falling through to unrelated routing.

## Scope

In scope:

- arbiter prompt/examples for imperative note-read phrasing
- regression tests for imperative note-read variants
- bounded fallback when arbiter-classified `note.read_content` reaches Stage 6 but does not produce `content_answered`

Out of scope:

- broader Phase 4 surface migration
- token/answer-budget tuning unless logs show Stage 6 abort is the remaining blocker after classification is fixed

## Files to change

| File | Change |
|------|--------|
| `app/api/chat/cross-surface-arbiter/route.ts` | strengthen arbiter prompt with imperative note-read examples |
| `lib/chat/routing-dispatcher.ts` | add bounded fallback for arbiter-classified `note.read_content` when Stage 6 aborts/fails |
| `__tests__/unit/chat/content-intent-dispatcher-integration.test.ts` | add imperative note-read routing + abort-fallback cases |
| `__tests__/unit/chat/cross-surface-arbiter.test.ts` | add prompt/contract-oriented arbiter cases if this suite exists or is created |

## Step 1: Strengthen arbiter classification for imperative note-read phrasing

Update the cross-surface arbiter prompt so these are explicitly classified as:

- `surface=note`
- `intentFamily=read_content`

Example phrases to include:

- `show me the content of that note`
- `show the text of this note`
- `read that note`
- `display the contents of my note`

Prompt rule:

- imperative verbs such as `show`, `read`, `display`, and `tell me` do not imply navigation when the object is clearly note content
- if the user is asking to see, explain, summarize, or read note content, classify as `read_content`
- use `navigate` only when the user is asking to open, go to, switch to, or move somewhere in the UI

## Step 2: Add regression coverage for imperative note-read requests

Dispatcher integration cases:

- `show me the content of that note` -> arbiter returns `note.read_content` -> Stage 6 runs
- `show the text of this note` -> Stage 6 runs
- `read that note` -> Stage 6 runs
- `display the contents of my note` -> Stage 6 runs

Negative assurance:

- these phrases must not end in panel/entry disambiguation
- these phrases must not fall through as `note.navigate`

## Step 3: Add bounded fallback for Stage 6 non-answer after arbiter `note.read_content`

Current problem:

- arbiter can classify `note.read_content`
- `executeS6Loop(...)` can return without `content_answered`
- dispatcher then falls through to legacy routing
- legacy routing can produce unrelated disambiguation

Fix:

In the arbiter `note.read_content` path, if Stage 6 returns no surfaced content answer:

- set `contentIntentMatchedThisTurn = true`
- do not fall through to Stage 5 / later routing tiers
- return a bounded assistant message such as:
  - `I couldn't read enough of the current note to answer that. Try asking a more specific question about the note.`
- write routing telemetry before early return

This fallback should apply to:

- Stage 6 abort
- Stage 6 timeout
- Stage 6 structural failure
- any non-`content_answered` terminal result after arbiter-classified `note.read_content`

## Step 4: Add regression coverage for the bounded non-answer fallback

Dispatcher integration cases:

- arbiter -> `note.read_content`, Stage 6 abort -> bounded note-read failure message, no fallthrough
- arbiter -> `note.read_content`, Stage 6 timeout -> bounded note-read failure message, no fallthrough
- arbiter -> `note.read_content`, Stage 6 non-answer -> `contentIntentMatchedThisTurn` suppresses later routing

## Step 5: Only inspect token/answer budget if classification is already correct

Do not start by increasing `maxOutputTokens`.

Only investigate Stage 6 answer-length limits if logs show this sequence:

1. arbiter correctly returns `note.read_content`
2. Stage 6 actually runs
3. Stage 6 aborts because of truncated/insufficient answer generation

If that evidence appears, then evaluate:

- `maxOutputTokens`
- answer-text length cap
- prompt instructions for shorter grounded answers

## Verification

1. `npm run type-check`
2. `npx jest --testPathPattern content-intent-dispatcher-integration`
3. `npx jest --testPathPattern cross-surface-arbiter`
4. Manual:
   - `show me the content of that note` -> content answer
   - `show the text of this note` -> content answer
   - forced Stage 6 abort path -> bounded note-read failure message, no budget/panel disambiguation

## Success criteria

- imperative note-read requests classify as `note.read_content`
- they no longer fall through into unrelated disambiguation
- Stage 6 non-answer after correct note-read classification returns a bounded note-read failure message
- token-limit tuning remains deferred unless logs prove it is still needed
