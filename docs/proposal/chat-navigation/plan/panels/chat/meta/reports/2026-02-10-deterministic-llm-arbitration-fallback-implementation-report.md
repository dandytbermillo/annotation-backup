# Deterministic -> LLM -> Safe Fallback Arbitration — Implementation Report

**Date**: 2026-02-10
**Feature slug**: `deterministic-llm-arbitration-fallback`
**Governing plan**: `docs/proposal/chat-navigation/plan/panels/chat/meta/deterministic-llm-arbitration-fallback-plan.md`
**Base commit**: `0a5ebf5f` (`still fixing about the open links panel query`)
**Feature flag**: `NEXT_PUBLIC_CLARIFICATION_LLM_FALLBACK=true`

---

## Summary

Implemented the hybrid deterministic-LLM-clarifier architecture from the governing plan. When deterministic routing produces a multi-match with no exact winner (e.g., "open links" with [Links Panels, Links Panel D, Links Panel E]), a constrained LLM is called to break the tie. The LLM operates under a **clarify-only policy**: it may reorder the clarifier options (LLM's pick first) but **never auto-executes**. If the LLM fails, times out, returns low confidence, or abstains, the system falls back to showing the original clarifier with unmodified order.

This builds on the previously-implemented selection-vs-command arbitration (pre-gate + exact-first precedence).

---

## Decision Ladder (Implemented)

```
1. Deterministic high-confidence → execute immediately (unchanged)
   - unique exact normalized label match
   - unique ordinal/badge match
   - explicit scope cue + unique target

2. Deterministic low-confidence / tie detected → call constrained LLM
   - multi-match with no exact winner
   - command-selection collision (verb+noun overlaps active options)

3. LLM result handling (clarify-only):
   - LLM picks winner (confidence >= 0.6) → reorder options, LLM's pick first
   - LLM abstains / low confidence / ask_clarify → show original order
   - LLM timeout / 429 / transport error → show original order
   - ALL paths → show clarifier. User always makes final selection.
```

---

## Files Modified (5 files, +856 / -12 lines)

### Runtime Code

| File | Changes |
|------|---------|
| `lib/chat/clarification-llm-fallback.ts:43` | Exported `MIN_CONFIDENCE_SELECT = 0.6` (was private `const`). Single source of truth for confidence floor — used by both clarification LLM path and arbitration path |
| `lib/chat/input-classifiers.ts:440-514` | Added types (`ConfidenceBucket`, `AmbiguityReason`, `ArbitrationConfidence`) and shared function `classifyArbitrationConfidence()`. Placed here to avoid circular deps between `routing-dispatcher.ts` and `chat-routing.ts` |
| `lib/chat/chat-routing.ts:70-77` | Added imports: `MIN_CONFIDENCE_SELECT` from `clarification-llm-fallback`; `classifyArbitrationConfidence` from `input-classifiers` |
| `lib/chat/chat-routing.ts:1114-1121` | Added module-level loop guard `lastLLMArbitration` and test-only reset function `_resetLLMArbitrationGuard()` |
| `lib/chat/chat-routing.ts:3622-3757` | Core implementation: confidence classification → loop guard check → LLM call (if eligible) → confidence floor → reorder → always re-show clarifier |

### Test Code

| File | Changes |
|------|---------|
| `__tests__/unit/chat/selection-vs-command-arbitration.test.ts` | 9 new unit tests in `describe('LLM arbitration (clarify-only)')`. Updated mock to export `MIN_CONFIDENCE_SELECT`. Added `_resetLLMArbitrationGuard` import + `beforeEach` reset |
| `__tests__/integration/chat/panel-disambiguation-tier-ordering.test.ts` | 4 new integration tests in `describe('dispatchRouting: LLM arbitration integration (clarify-only)')`. Updated mock to include `callReturnCueLLM`, `shouldCallLLMFallback`, `MIN_CONFIDENCE_SELECT`. Added `_resetLLMArbitrationGuard`, `callClarificationLLMClient`, `isLLMFallbackEnabledClient`, `debugLog` imports |

---

## Implementation Details

### A. Confidence Contract (`input-classifiers.ts`)

Per governing plan §18-38: confidence defined once in one shared function, no per-tier reinterpretation.

**Types:**
```typescript
export type ConfidenceBucket =
  | 'high_confidence_execute'
  | 'low_confidence_llm_eligible'
  | 'low_confidence_clarifier_only'

export type AmbiguityReason =
  | 'multi_match_no_exact_winner'
  | 'cross_source_tie'       // deferred — type exists, not triggered
  | 'typo_ambiguous'         // deferred — type exists, not triggered
  | 'command_selection_collision'
  | 'no_candidate'
```

**Classification logic:**
- `matchCount === 0` → `low_confidence_clarifier_only`, reason `no_candidate`
- `matchCount === 1` → `high_confidence_execute` (unique match)
- `exactMatchCount === 1` → `high_confidence_execute` (exact winner among multi-match)
- `inputIsExplicitCommand || isNewQuestionOrCommandDetected` with `matchCount > 1` → `low_confidence_llm_eligible`, reason `command_selection_collision`
- Default multi-match → `low_confidence_llm_eligible`, reason `multi_match_no_exact_winner`

### B. LLM Arbitration in Multi-Match Path (`chat-routing.ts`)

**Location:** Inside `else if (matchingOptions.length > 1)` block, after exact-first check failure, before re-show.

**Flow:**
1. Classify confidence via `classifyArbitrationConfidence()`
2. Check loop guard (`lastLLMArbitration` — same input + same optionIds?)
3. If `low_confidence_llm_eligible` + LLM enabled + not repeat → call `callClarificationLLMClient()`
4. Apply confidence floor: `llmConfidence < MIN_CONFIDENCE_SELECT (0.6)` → abstain
5. LLM success + above floor → set `llmSuggestedId` for reorder (NOT auto-execute)
6. LLM failure → log with `fallback_reason` (`timeout` | `429` | `transport_error` | `abstain` | `low_confidence`)
7. Build `reorderSource` from `lastClarification.options` — LLM's pick first if set, else original order
8. Always re-show clarifier with `reorderSource`

**LLM call parameters:**
```typescript
callClarificationLLMClient({
  userInput: trimmedInput,
  options: confidence.candidates,  // bounded pool from matchingOptions
  context: 'multi_match_arbitration',
})
```

### C. Loop Guard (`chat-routing.ts:1114-1121`)

Module-level `lastLLMArbitration: { input: string; optionIds: string } | null` prevents repeated LLM calls for identical input + option set in consecutive turns. Set after each LLM call (success or failure). Test-only `_resetLLMArbitrationGuard()` exported for `beforeEach` cleanup.

### D. Confidence Constant (Single Source)

`MIN_CONFIDENCE_SELECT = 0.6` exported from `clarification-llm-fallback.ts:43`. Imported in `chat-routing.ts`. No duplication across modules.

---

## Safety Audit

### Safety Invariants (governing plan §115-120)

| # | Invariant | Status | Evidence |
|---|-----------|--------|----------|
| 1 | No LLM-first routing | **SAFE** | `classifyArbitrationConfidence()` runs first at line 3626. LLM only called when `bucket === 'low_confidence_llm_eligible'` at line 3646 |
| 2 | No best-guess execution on LLM failure | **SAFE** | All failure/abstain paths skip `llmSuggestedId` assignment. `handleSelectOption` is never called in the LLM arbitration block (lines 3622-3757) |
| 3 | No source-switch without explicit winner | **SAFE** | LLM receives only `confidence.candidates` from `matchingOptions` — bounded to active clarification pills. Known-command candidates not injected |
| 4 | Explicit scope cues override | **SAFE** | Scope-cue system runs at Tier 0 before reaching multi-match at line 3622 |

### Implementation Safety Invariants

| # | Invariant | Status | Evidence |
|---|-----------|--------|----------|
| 5 | Clarify-only: no auto-execute from LLM | **SAFE** | `handleSelectOption` never called. `llmSuggestedId` only used for reorder. Return always has `clarificationCleared: false` |
| 6 | Feature-flag gated | **SAFE** | `isLLMFallbackEnabledClient()` checked at line 3647 before any LLM call |
| 7 | Confidence floor enforced | **SAFE** | `llmConfidence < MIN_CONFIDENCE_SELECT` at line 3662 → treated as abstain → no reorder |
| 8 | Loop guard prevents repeat calls | **SAFE** | `lastLLMArbitration` checked at lines 3639-3641 before LLM call |

---

## Observability

### Implemented Logs

| Log Action | Trigger | Key Fields |
|------------|---------|------------|
| `llm_arbitration_called` | LLM returns success + above confidence floor | `input`, `suggestedLabel`, `candidateCount`, `ambiguityReason`, `finalResolution: 'clarifier'`, `llm_timeout_ms`, `fallback_reason: null`, `llmConfidence` |
| `llm_arbitration_failed_fallback_clarifier` | LLM fails, times out, abstains, or low confidence | `input`, `candidateCount`, `ambiguityReason`, `finalResolution: 'clarifier'`, `llm_timeout_ms`, `fallback_reason` |
| `clarification_tier1b3_multi_match_reshow` | Always (re-show path) | `input`, `matchCount`, `matchedLabels`, `exactMatchCount`, `llmSuggestedId` |

### Specification Gaps in Observability

The governing plan (§122-138) requires 5 log actions. 3 are not yet implemented as distinct actions:

| Required Log | Status | Notes |
|---|---|---|
| `deterministic_high_confidence_execute` | Not implemented | No log when exact-first selects deterministically. The existing `clarification_tier1b2_exact_first_select` log partially covers this |
| `deterministic_low_confidence_tie` | Not implemented | No dedicated log when tie detected before LLM call |
| `llm_arbitration_abstained` | Merged | Combined into `llm_arbitration_failed_fallback_clarifier` with `fallback_reason: 'abstain'` |

Missing plan-required fields: `sourcesInTie`, `handledByTier` not included in arbitration logs.

---

## Test Results

### Test Execution

```bash
$ npx jest __tests__/unit/chat/ __tests__/integration/chat/ --no-coverage --runInBand

Test Suites: 9 passed, 9 total
Tests:       298 passed, 298 total
Snapshots:   0 total
Time:        0.82 s
```

All 298 tests pass. Zero failures. Zero regressions.

### Unit Tests Added (9 tests)

File: `__tests__/unit/chat/selection-vs-command-arbitration.test.ts`

| # | Test | Plan Ref | Status |
|---|------|----------|--------|
| 1 | LLM narrows multi-match: reorders options with LLM pick first, does NOT auto-execute | §144 #2 | PASS |
| 2 | LLM abstains → clarifier with original order | §144 #3 | PASS |
| 3 | LLM timeout → clarifier, log includes `fallback_reason: timeout` | §144 #4, #5 | PASS |
| 4 | LLM disabled → no LLM call, direct re-show | — | PASS |
| 5 | Deterministic exact winner never calls LLM | §144 #1 | PASS |
| 6 | LLM low-confidence → treated as abstain, re-show | §144 #6 | PASS |
| 7 | Candidate pool matches matchingOptions only | §144 #7 | PASS |
| 8 | Collision rule: selection-like + unique match → deterministic, no LLM | §144 #8 | PASS |
| 9 | Loop guard: same input+options in back-to-back turn → LLM not called again | — | PASS |

### Integration Tests Added (4 tests)

File: `__tests__/integration/chat/panel-disambiguation-tier-ordering.test.ts`

| # | Test | Plan Ref | Status |
|---|------|----------|--------|
| 1 | LLM narrows multi-match: re-shows clarifier with LLM pick first, NOT auto-executed | §153 #1 | PASS |
| 2 | LLM failure → safe clarifier, no execution | §153 #2 | PASS |
| 3 | LLM 429 → safe clarifier, `fallback_reason: '429'` | §153 #3 (adapted) | PASS |
| 4 | Deterministic exact winner skips LLM: "open links panel" → exact-first selects, LLM never called | §153 #4 | PASS |

### Test Coverage Gaps vs Governing Plan

| Plan Test | Gap | Reason |
|-----------|-----|--------|
| Integration #1: "Active chat + widget tie on `second option`" | Uses "open links" with panel options instead | `cross_source_tie` is deferred scope |
| Integration #3: "Typo-heavy input (`secone one`)" | Not tested | `typo_ambiguous` path is deferred scope |
| Unit #5: `llm_timeout_ms >= 800` | Only `fallback_reason: 'timeout'` verified | Wall-clock measurement can't be meaningfully asserted with sync mocks. Timeout enforcement tested separately in `clarification-llm-fallback.test.ts` |

---

## Known Issues

### Issue 1: Dead parameter `inputIsSelectionLike`

`classifyArbitrationConfidence()` accepts `inputIsSelectionLike` (line 472 of `input-classifiers.ts`) but never reads it in any branch. The collision rule (plan §58-61) is effectively handled by `matchCount === 1 → high_confidence_execute`, so no logical gap exists. Cleanup candidate — remove parameter or use it for future `typo_ambiguous` logic.

**Risk:** None (no functional impact).

### Issue 2: Module-level loop guard persistence

`lastLLMArbitration` persists across React re-renders and navigation events. If a user types the same input with the same options after navigating away and returning, the guard blocks the LLM call. Worst case: the user sees original option order instead of LLM-reordered. Not a safety issue — the clarifier still shows.

**Risk:** Minor UX impact in edge case. Could add a `clearLLMArbitrationGuard()` call to chat-clear or navigation handlers if needed.

---

## Deferred Items (Not This PR)

Per implementation plan and governing plan:

1. **Dispatcher refactor** — Wire `classifyArbitrationConfidence()` + `shouldUseLLMArbitration()` into `routing-dispatcher.ts` Tier 4.5
2. **Grounding-set enhancement** — Add `ambiguityReason` to `GroundingSetResult` return type
3. **Cross-source tie detection (`cross_source_tie`)** — Needs widget context integration; separate scope
4. **Typo-ambiguous path (`typo_ambiguous`)** — Needs grounding-set integration for typo-normalized candidates
5. **Upgrade to confidence-gated auto-select** — If telemetry (clarify rate, correction rate, user retries) supports it, upgrade from clarify-only to auto-select at >= 0.85/0.9 threshold
6. **Missing observability logs** — `deterministic_high_confidence_execute`, `deterministic_low_confidence_tie`, `sourcesInTie` field
7. **Dead parameter cleanup** — Remove or use `inputIsSelectionLike` in `classifyArbitrationConfidence()`

---

## Verification Checklist

- [x] All file paths exist and are verified via `git diff --stat`
- [x] `MIN_CONFIDENCE_SELECT` exported from single source (`clarification-llm-fallback.ts:43`)
  - Verified: line 43 reads `export const MIN_CONFIDENCE_SELECT = 0.6`
- [x] `classifyArbitrationConfidence()` added to `input-classifiers.ts:469-514`
  - Verified: function exists, returns correct types
- [x] LLM arbitration block in `chat-routing.ts:3622-3757`
  - Verified: `handleSelectOption` never called in block, always re-shows clarifier
- [x] Loop guard at `chat-routing.ts:1114-1121`
  - Verified: `_resetLLMArbitrationGuard()` exported, called in test `beforeEach`
- [x] Unit tests: 9 new, all pass
- [x] Integration tests: 4 new, all pass
- [x] Full chat test suite: 298 tests pass, 0 failures
- [x] No regressions in existing 285+ tests
- [x] Feature-flag gated: LLM calls require `NEXT_PUBLIC_CLARIFICATION_LLM_FALLBACK=true`

---

## Commands to Reproduce

```bash
# Type-check
npx tsc --noEmit

# Run LLM arbitration unit tests
npx jest __tests__/unit/chat/selection-vs-command-arbitration.test.ts --no-coverage --runInBand

# Run LLM arbitration integration tests
npx jest __tests__/integration/chat/panel-disambiguation-tier-ordering.test.ts --no-coverage --runInBand

# Run full chat test suite
npx jest __tests__/unit/chat/ __tests__/integration/chat/ --no-coverage --runInBand
```

---

## Cross-References

- **Governing plan**: `docs/proposal/chat-navigation/plan/panels/chat/meta/deterministic-llm-arbitration-fallback-plan.md`
- **Predecessor**: `docs/proposal/chat-navigation/plan/panels/chat/meta/reports/2026-02-06-selection-intent-arbitration-implementation-report.md` (selection-vs-command arbitration)
- **Selection-vs-command plan**: `docs/proposal/chat-navigation/plan/panels/chat/meta/selection-vs-command-arbitration-rule-plan.md`
- **LLM fallback infrastructure**: `docs/proposal/chat-navigation/plan/panels/chat/meta/reports/2025-01-23-clarification-llm-fallback-implementation.md`
