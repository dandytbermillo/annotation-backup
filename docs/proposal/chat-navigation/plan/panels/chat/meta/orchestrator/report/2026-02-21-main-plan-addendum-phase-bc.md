# Plan Addendum (2026-02-21) — Semantic Fallback Guard + Phase C Refinement

## Status
- Incorporated changes validated after Phase B stabilization.
- Scope: add a narrow server-side guard for semantic meta-query misclassification; keep LLM-first behavior; prepare incremental Phase C cleanup.

## Implemented in Phase B
- Added `detectLocalSemanticIntent()` in `lib/chat/input-classifiers.ts`.
- Added post-`resolveIntent` remap guard in `app/api/chat/navigate/route.ts`.
- Guard remaps only `answer_from_context` -> `last_action` / `explain_last_action` for exact patterns, then re-runs existing `resolveIntent`.
- No client-side bypass, no new resolver module, no prompt/schema/routing-tier changes.

## Hard Guard Conditions (all required)
- semantic lane enabled
- `intent.intent === 'answer_from_context'`
- no `pendingOptions`
- no `lastClarification`
- detector returns exact-match semantic intent
- `sessionState.lastAction` exists

## Detector Coverage (intentionally narrow)
- `"what did i do before that?"` -> `explain_last_action`
- `"what did i (just) do?"` -> `last_action`
- `"what was my last action?"` -> `last_action`
- everything else -> no override (LLM result stands)

## Addendum Compliance Note
- Active-option ladder rules remain unchanged.
- No new unresolved hook in `chat-routing` Tier 1b.3.
- Override is post-LLM safety correction only, outside active-option arbitration.

## Test Updates
- New detector unit tests in `__tests__/unit/chat/detect-local-semantic-intent.test.ts`.
- Added semantic fallback scenarios in `__tests__/unit/chat/semantic-answer-lane.test.ts`.
- Added route-pipeline integration validation in `__tests__/integration/chat/semantic-answer-lane-api.test.ts` (`applyFullRoutePipeline` path).

## Phase C (next) — refined execution
- Remove legacy `setLastAction` writes incrementally by action type (not one-shot).
- First candidates: `open_panel`, `open_entry`, `open_workspace` (where commit-point parity is proven).
- Keep legacy writes for non-parity actions until covered.
- Require parity tests + telemetry comparison before each removal batch.
- Success condition per batch: no regression in `lastAction`, `actionHistory`, and semantic `before that` answers.
