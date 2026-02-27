# Scope-Uncertain Detection Gap — Implementation Report

**Date**: 2026-02-26
**Feature**: scope-cues-addendum-plan.md §scope_uncertain safety net
**Scope**: 4-fix plan — SCOPE_VOCAB plurals, scope_uncertain confidence level, detectScopeTriggerUnresolved(), scope-cue handler extension, tests

---

## Summary

Fixed a detection gap where severe scope-cue typos (Levenshtein distance > 1) silently fell through to latch-based routing, causing the wrong widget's items to be shown. Added a `scope_uncertain` confidence level as a last-resort safety net with relaxed distance threshold (≤ 2).

### Key Insight

The bug scenario "from active widgetss" (double 's') is actually caught correctly by Fix 1 alone — adding "widgets"/"panels" to `SCOPE_VOCAB` makes "widgetss" → "widgets" distance 1, triggering `low_typo`. The `scope_uncertain` safety net provides additional coverage for cases where both the trigger word AND scope word are severely misspelled (e.g., "from actvee" where "actvee" → "active" distance 2).

---

## Fix 1: Expand SCOPE_VOCAB with plural forms

**File**: `lib/chat/input-classifiers.ts` (line 507)

Added "widgets" and "panels" to the closed vocabulary:
```typescript
const SCOPE_VOCAB = ['active', 'current', 'widget', 'widgets', 'panel', 'panels', 'chat', 'links', 'recent', 'dashboard', 'workspace'] as const
```

Updated scope classification in `detectScopeCueTypo` (line 560) to map "widgets"/"panels" to widget scope:
```typescript
} else if (bestMatch === 'active' || bestMatch === 'current' || bestMatch === 'widget' || bestMatch === 'widgets' || bestMatch === 'panel' || bestMatch === 'panels') {
```

**Result**: "widgetss" → "widgets" (distance 1) → `low_typo` → safe clarifier shown.

---

## Fix 2: Add `scope_uncertain` confidence level + `detectScopeTriggerUnresolved()`

### 2a. New confidence level

**File**: `lib/chat/input-classifiers.ts` (line 413)

```typescript
confidence: 'high' | 'low_typo' | 'scope_uncertain' | 'none'
```

### 2b. `detectScopeTriggerUnresolved()` function

**File**: `lib/chat/input-classifiers.ts` (after `detectScopeCueTypo`)

Last-resort safety net with relaxed Levenshtein threshold (≤ 2). Catches cases where both the trigger and scope words are severely misspelled (e.g., "from actvee" — "actvee" → "active" distance 2).

Key design decisions:
- **Exact-scope guard carried forward**: Same `EXACT_SCOPE_TOKENS` check as `detectScopeCueTypo`. "from actvee workspace" → NOT widget scope.
- **Stop words filter**: Common non-scope words ("the", "a", "my", etc.) are excluded to prevent false positives.
- **Minimum token length**: 4 characters minimum to avoid matching short common words.

### 2c. Wired into `resolveScopeCue()`

After typo detection fails, before returning `scope: 'none'`:
```typescript
const unresolvedResult = detectScopeTriggerUnresolved(normalized)
if (unresolvedResult.scope !== 'none') return unresolvedResult
```

---

## Fix 3: Handle `scope_uncertain` in scope-cue handler

**File**: `lib/chat/chat-routing-scope-cue-handler.ts` (line 110)

Extended the `low_typo` gate to also handle `scope_uncertain`:
```typescript
if (scopeCue.confidence === 'low_typo' || scopeCue.confidence === 'scope_uncertain') {
```

Both share the same invariant: clarifier-only, never execute. Same "Did you mean?" message, same pending state save for one-turn replay.

---

## Fix 4: Tests

### Unit Tests — `__tests__/unit/chat/selection-intent-arbitration.test.ts` (8 new tests)

Scope-uncertain detection:
- "from active widgetss" (double s) → `low_typo` (distance 1 from "widgets")
- "from actvee" (distance 2 from "active") → `scope_uncertain`
- "from actvee widgezz" (both distance 2) → `scope_uncertain`
- "open sample2 from the library" → `scope: 'none'` (no scope-like tokens)
- "from active widget" → `high` (regression check)
- "from activ workspace" → NOT widget scope (exact-scope guard in typo detector)
- "from activ dashboard" → NOT widget scope (exact-scope guard in typo detector)
- "from actvee workspace" → NOT widget scope (exact-scope guard in scope_uncertain)

### Integration Tests — `__tests__/integration/chat/selection-intent-arbitration-dispatcher.test.ts` (6 new tests)

- "from actvee" → safe clarifier shown, no execution, pending state saved
- "from actvee widgezz" → scope_uncertain, safe clarifier shown
- "from activ workspace" → NOT routed as widget scope (exact-scope guard)
- Strict regression: grounding/LLM never runs for scope_uncertain input — no wrong widget items
- Semantic-lane regression: "can you open sample2 from actvee" handled by scope_uncertain gate, not semantic lane
- Replay regression: "yes from active widget" after scope_uncertain clarifier replays original intent

---

## All Files Modified

| File | Changes |
|------|---------|
| `lib/chat/input-classifiers.ts` | Added "widgets"/"panels" to `SCOPE_VOCAB`, `scope_uncertain` confidence level, `detectScopeTriggerUnresolved()`, wired into `resolveScopeCue()` |
| `lib/chat/chat-routing-scope-cue-handler.ts` | Extended `low_typo` gate to also handle `scope_uncertain` |
| `__tests__/unit/chat/selection-intent-arbitration.test.ts` | 8 new tests for scope_uncertain detection + exact-scope guard |
| `__tests__/integration/chat/selection-intent-arbitration-dispatcher.test.ts` | 6 new tests for scope_uncertain integration + regressions |

---

## Verification

```
$ npx tsc --noEmit
# Only pre-existing error: __tests__/unit/use-panel-close-handler.test.tsx(87,1)

$ npx jest --no-coverage __tests__/unit/chat/ __tests__/integration/chat/
# Test Suites: 37 passed, 37 total
# Tests: 926 passed, 926 total (up from 912)
# Time: 1.171s
```

---

## Safety Invariants

| Invariant | Status |
|-----------|--------|
| `scope_uncertain` is never executable — always shows safe clarifier | Verified |
| `scope_uncertain` gate runs BEFORE ordinal binding, semantic-lane, grounding fallback | Verified |
| Exact-scope guard carried into `detectScopeTriggerUnresolved()` | Verified |
| "from actvee workspace" → NOT widget scope | Verified |
| Grounding/LLM never runs for scope_uncertain input | Verified (strict regression test) |
| Semantic-lane never bypasses scope_uncertain gate | Verified (semantic-lane regression test) |
| One-turn replay works after scope_uncertain clarifier | Verified (replay regression test) |
| Every path through the gate saves pending state for replay | Verified |
