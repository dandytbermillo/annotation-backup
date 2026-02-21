# Server-Side Misclassification Guard — Implementation Report

**Date**: 2026-02-21
**Feature slug**: `chat-navigation`
**Plan**: `/Users/dandy/.claude/plans/spicy-wobbling-backus.md`
**Commit**: `853cd772` ("dont fixing the panel d bug")

---

## Summary

Implemented a **server-side fallback guard** in `route.ts` that catches LLM misclassification of semantic meta-queries. When the LLM incorrectly classifies queries like "what did I do before that?" as `answer_from_context` instead of `explain_last_action`, the guard remaps the intent and re-resolves through existing deterministic resolvers.

**Problem**: The LLM sometimes classifies narrow meta-queries (e.g., "what did I do before that?") as `answer_from_context`. When this happens, the `resolveAnswerFromContext` handler passes through the LLM's free-text `contextAnswer` — which may reference incorrect context (e.g., widget labels, rendering context like "Home") instead of the actual `lastAction` from session state.

**Solution**: A narrow pattern detector (`detectLocalSemanticIntent`) + intent remap in `route.ts`. The LLM is **always consulted** — the guard only overrides the specific `answer_from_context` misclassification for 3 exact-match patterns. No client-side bypass, no new resolver module, no prompt changes.

---

## Architecture

```
User query → Client → LLM (always called) → route.ts resolveIntent()
                                                    ↓
                                          [Server fallback guard]
                                          If LLM said answer_from_context
                                          AND narrow exact pattern match
                                          AND all 6 hard guards pass
                                                    ↓
                                          Remap intent → re-call resolveIntent()
                                                    ↓
                                          Deterministic resolver runs
```

**6 Hard Guard Conditions** (ALL must be true for override):
1. `isSemanticLaneEnabled` — feature flag on
2. `intent.intent === 'answer_from_context'` — the specific misclassification
3. `!context?.pendingOptions?.length` — no pending options (addendum safety)
4. `!context?.lastClarification` — no active clarification (addendum safety)
5. `detectLocalSemanticIntent(userMessage)` returns non-null — exact pattern match
6. `resolutionContext.sessionState?.lastAction` exists — resolver has data

If any condition fails, the original LLM resolution stands unchanged.

---

## Files Modified

| File | Lines | Change |
|------|-------|--------|
| `lib/chat/input-classifiers.ts` | 576-606 | Added `detectLocalSemanticIntent()` — 3 exact patterns |
| `app/api/chat/navigate/route.ts` | 18, 572, 574-600 | Import, `let resolution`, server fallback guard block |
| `__tests__/unit/chat/detect-local-semantic-intent.test.ts` | NEW | 16 test cases for pattern detection |
| `__tests__/unit/chat/semantic-answer-lane.test.ts` | 380-497 | 3 must-have scenario tests + history ordering fix |
| `__tests__/integration/chat/semantic-answer-lane-api.test.ts` | added | `applyFullRoutePipeline()` + 6 API-level integration tests |

### Other files in same commit (Phase B — Centralized ActionTrace)

| File | Change |
|------|--------|
| `lib/chat/chat-navigation-context.tsx` | Freshness guard (200ms window), `setLastAction` dedup |
| `lib/chat/intent-resolver.ts` | `resolveExplainLastAction` uses committed `lastAction` |
| `lib/chat/use-chat-navigation.ts` | ActionTrace centralization |
| `components/dashboard/DashboardInitializer.tsx` | ActionTrace recording via centralized hook |
| `components/dashboard/DashboardView.tsx` | ActionTrace recording via centralized hook |
| `__tests__/integration/chat/action-trace-commit-path.integration.test.tsx` | ActionTrace commit-path tests |

---

## Key Code

### Pattern Detector (`input-classifiers.ts:576-606`)

```typescript
export function detectLocalSemanticIntent(
  input: string
): 'last_action' | 'explain_last_action' | null {
  const n = input.toLowerCase().trim()
  if (/^\d+$/.test(n)) return null
  if (/\b(option|choice|first|second|third|top|bottom)\b/i.test(n)) return null
  if (/\b(and|also|then|plus)\b/i.test(n)) return null
  if (/^what did i do before that\??$/i.test(n)) return 'explain_last_action'
  if (/^what did i (just )?do\??$/i.test(n)) return 'last_action'
  if (/^what was my last action\??$/i.test(n)) return 'last_action'
  return null
}
```

Deliberately **excluded** patterns:
- "what happened?" — too broad, many paraphrase variants
- "summarize my activity" — LLM handles better
- "explain what just happened" — not exact match to a resolver

### Server Fallback Guard (`route.ts:574-600`)

```typescript
if (
  isSemanticLaneEnabled &&
  intent.intent === 'answer_from_context' &&
  !context?.pendingOptions?.length &&
  !context?.lastClarification
) {
  const correctedIntent = detectLocalSemanticIntent(userMessage)
  if (correctedIntent && resolutionContext.sessionState?.lastAction) {
    void debugLog({
      component: 'ChatNavigateAPI',
      action: 'semantic_fallback_remap',
      metadata: { from: 'answer_from_context', to: correctedIntent, userMessage },
    })
    intent.intent = correctedIntent
    resolution = await resolveIntent(intent, resolutionContext)
  }
}
```

**Note**: Uses `context?.` (raw request body) not `conversationContext?.` because `lastClarification` only exists on the raw body. Consistent with existing usage at `route.ts` lines 643, 649.

---

## Test Results

### Unit Tests — Pattern Detection (16 tests)

```
PASS __tests__/unit/chat/detect-local-semantic-intent.test.ts
```

Positive matches: "what did I do before that?" → explain_last_action, "what did I just do?" / "what did I do?" / "what was my last action?" → last_action, case-insensitivity, whitespace trim.

Negative matches: commands, ordinals, non-matching queries, compound queries, summarize variants, "what happened?", "explain what just happened", option-related words, empty/whitespace input.

### Unit Tests — Scenario Tests (3 tests)

```
PASS __tests__/unit/chat/semantic-answer-lane.test.ts
```

1. Misclassified `answer_from_context` + exact meta-query → overridden deterministic answer (verifies "Links Panel E" in message, "Before that" → Links Panel D)
2. Normal `answer_from_context` (notes-scope clarification) → unchanged
3. Active-option context → guard skipped entirely (addendum safety)

**History ordering fix**: Test data corrected from oldest-first to newest-first at line 414. The `resolveExplainLastAction` resolver uses `actionHistory[1]` with newest-first ordering (per `chat-navigation-context.tsx:1174`).

### Integration Tests — API-Level Pipeline (6 tests)

```
PASS __tests__/integration/chat/semantic-answer-lane-api.test.ts
```

Tests exercise `applyFullRoutePipeline()` which replicates the actual route.ts guard logic:
1. Misclassified → remap → correct panel names in response
2. Normal passthrough (non-matching query) → no override
3. Active `pendingOptions` → guard skipped
4. Active `lastClarification` → guard skipped
5. Feature flag disabled → guard skipped
6. No `lastAction` in session → guard skipped

### Full Suite

```
Test Suites: 3 passed, 3 total
Tests:       63 passed, 63 total
Type-check:  clean (0 errors)
```

---

## Live Investigation — Debug Log Analysis (2026-02-21)

### Method

Queried `debug_logs` table for all entries from the test session (18:05+ UTC) and historical entries matching `answer_from_context`.

### Findings

1. **Guard never fired in live testing**: 0 rows with `action = 'semantic_fallback_remap'`. The LLM correctly classified all "what did I do before that?" queries as `explain_last_action` during the test session.

2. **All 18:05+ session requests classified correctly**: Every request in the test session had `action = 'inform'` with `resolvedIntent = explain_last_action` or `last_action`. The deterministic resolver produced correct answers ("Links Panel E", "Before that → Links Panel D").

3. **Historical misclassification found**: One `answer_from_context` entry at log ID 29561992 (04:27 UTC). At that time, `lastAction` was "Home" — the LLM's free-text answer happened to be correct because the user had physically navigated home before that query.

4. **Screenshot verification** (4 screenshots analyzed):
   - **Image 1**: "what did I do before that?" → "Links Panel E" (correct — user had just opened Links Panel E)
   - **Image 2**: "what did I do before that?" → "Home" (correct — user confirmed they pressed the home button to navigate from summary144 to dashboard before opening the recent widget)
   - **Image 3**: "what did I do?" → correct answer showing last action
   - **Image 4**: Multiple queries showing correct responses throughout the session

### Conclusion

The guard is **deployed and tested** but has not yet been triggered in production because the LLM happened to classify correctly in all test cases. The guard serves as a safety net for future misclassifications — the specific `answer_from_context` misclassification pattern was observed historically (04:27 entry) and is known to be intermittent.

---

## Addendum Compliance

**Reference**: `docs/proposal/chat-navigation/plan/panels/chat/meta/deterministic-llm-ladder-enforcement-addendum-plan.md`

| Rule | Status | Notes |
|------|--------|-------|
| **Rule G** (Uncertain means LLM) | Compliant | LLM always called. Guard only overrides `answer_from_context` for 3 narrow exact patterns. Uncertain → null → LLM stands. |
| **Rule E** (One unresolved hook) | Compliant | No new hooks in active-option flows. Guard is in `route.ts`, post-resolution. |
| **Rule D** (Safe fallback) | Compliant | If any guard condition fails, original LLM resolution stands unchanged. |
| **Scope separation** | Compliant | Addendum scope is "Active clarification option flows in `chat-routing.ts` (Tier 1b.3)". Guard operates outside this scope — post-LLM server guard in `route.ts`. |
| **Hard guards** | Compliant | `!context?.pendingOptions?.length` AND `!context?.lastClarification` prevent guard from firing during active clarification. |

---

## Plan Refinement History

The plan went through 4 review rounds before approval:

1. **Rejection 1**: "Why there is no LLM?" — Original plan had a client-side bypass that skipped the LLM entirely. Removed; LLM must always be consulted.
2. **Rejection 2**: "Step 1 is over-scoped" — Original plan extracted resolvers into a shared module. Removed; use intent remap + existing `resolveIntent()` instead.
3. **Rejection 3**: Three tighten-ups applied: (a) added `!lastClarification` guard, (b) removed "what happened?" pattern (too broad), (c) switched from `console.log` to `debugLog`.
4. **Approved**: Final plan: 3 files, narrow scope, LLM always in the loop, 6 hard guards.

---

## Risks / Limitations

1. **Guard untriggered in production**: The LLM classified correctly in all test cases. Guard is a safety net — validated by unit/integration tests but not yet observed firing in live use.
2. **Pattern coverage**: Only 3 exact patterns. Other meta-query paraphrases (e.g., "what happened?", "explain what just happened") are left to the LLM. This is by design — narrow scope reduces false-positive risk.
3. **`context?.lastClarification` typing**: Uses raw request body (`context`) rather than typed `conversationContext`. If the field moves to a different location in future refactors, the guard check needs updating.

---

## Next Steps

- Monitor `semantic_fallback_remap` debug log entries in production to track real occurrences
- Consider expanding patterns if new high-confidence exact matches are identified (requires addendum review)
- Schedule feature flag cleanup for `NEXT_PUBLIC_SEMANTIC_ANSWER_LANE` once stable
