# Scope-Typo Clarifier + One-Turn Replay — Implementation Report

**Date**: 2026-02-26
**Feature**: scope-cues-addendum-plan.md §typoScopeCueGate

## Summary

Implemented the 6-stage plan for scope-typo clarifier with one-turn replay:
1. Plural `widgets?`/`panels?` in exact scope-cue patterns → no false typo triggers
2. `PendingScopeTypoClarifier` cross-turn state for replay coordination
3. Typo gate saves pending state (stripped input, fingerprint, turn count)
4. `stripLeadingAffirmation()` helper + confirmation resolver before ordinal binding
5. Replay signal handling in dispatcher with `_replayDepth` guard
6. Full unit + integration tests

## Bug Fixed

- "from active widgets" (plural) no longer triggers typo clarifier — matched as exact scope
- "yes from active widget" after typo clarifier now replays the original intent instead of searching for "yes"
- Pure "yes" after typo clarifier shows a clarifier asking for specific scope (not search)

## Files Modified

| File | Changes |
|------|---------|
| `lib/chat/input-classifiers.ts` | `WIDGET_CUE_PATTERN`: `widgets?`/`panels?` in all widget/panel alternatives + negative lookahead guards |
| `lib/chat/query-patterns.ts` | `AFFIRMATION_TOKENS` shared constant, rebuilt `AFFIRMATION_PATTERN`, `stripLeadingAffirmation()` helper |
| `lib/chat/chat-navigation-context.tsx` | `PendingScopeTypoClarifier` interface, `SCOPE_TYPO_CLARIFIER_TTL`, state + lifecycle hooks in provider |
| `lib/chat/chat-routing-types.ts` | `replaySignal` on `ClarificationInterceptResult`, `_replayDepth`/`snapshotFingerprint`/`currentTurnCount`/`pendingScopeTypoClarifier` on `ClarificationInterceptContext` |
| `lib/chat/chat-routing-scope-cue-handler.ts` | `ScopeCuePhaseParams` extended with `snapshotFingerprint`/`currentTurnCount`, typo gate saves `PendingScopeTypoClarifier` |
| `lib/chat/chat-routing-clarification-intercept.ts` | Confirmation resolver (before ordinal binding): TTL check, drift check, unrelated-input guard, affirmation strip, scope-cue resolution, ambiguous "yes" handler |
| `lib/chat/routing-dispatcher.ts` | `computeSnapshotFingerprint()`, `pendingScopeTypoClarifier` on `RoutingDispatcherContext`, replay signal handler with depth guard |
| `__tests__/unit/chat/selection-intent-arbitration.test.ts` | 8 new tests: plural forms + negative lookahead regression |
| `__tests__/unit/chat/strip-leading-affirmation.test.ts` | New file: 14 tests for `stripLeadingAffirmation` + `AFFIRMATION_TOKENS` consistency |
| `__tests__/integration/chat/selection-intent-arbitration-dispatcher.test.ts` | 8 new tests: plural exact scope, pending state save, replay, TTL expiry, drift, unrelated input, pure "yes" ambiguity |

## Verification

```
$ npx tsc --noEmit
# Only pre-existing error: __tests__/unit/use-panel-close-handler.test.tsx(87,1)

$ npx jest --no-coverage __tests__/unit/chat/ __tests__/integration/chat/
# Test Suites: 37 passed, 37 total
# Tests: 912 passed, 912 total
# Time: 1.25s
```

## Safety Invariants

- `low_typo` confidence is **never executable** — always shows safe clarifier
- Every path through the confirmation resolver calls `clearPendingScopeTypoClarifier()` — no stale state bleed
- `_replayDepth: 0 | 1` prevents recursive replay loops
- Snapshot fingerprint drift detection prevents stale replay after UI changes
- Strict one-turn TTL (`createdAtTurnCount + 1`) prevents late replay
- Confirmation resolver runs **before** ordinal binding — "yes" never captured as query
