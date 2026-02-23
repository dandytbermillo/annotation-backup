# Universal Deterministic Confidence Gate

**Date**: 2026-02-22
**Slug**: chat-navigation / universal-deterministic-confidence-gate
**Plan file**: `docs/proposal/chat-navigation/plan/panels/chat/meta/orchestrator/universal-deterministic-confidence-gate-plan.md`
**Status**: Implemented and verified (automated tests)

---

## Summary

**Bug**: Active-option selection paths execute deterministically on soft matches (contains, startsWith, token subset) that are NOT high-confidence. Example: "good morning asssitant can you the open links panels" matches "Links Panels" via substring containment → executes immediately. Should go to bounded LLM for intent verification.

**Root cause**: `findExactOptionMatch` in `routing-dispatcher.ts` mixed high-confidence (exact label) and low-confidence (contains, startsWith, label-contains-input) matching in a single function. All callers treated ANY match as deterministic-execute-worthy. Same issue in `findMatchingOptions` / `findExactNormalizedMatches` in `chat-routing.ts`.

**Fix**: Shared `evaluateDeterministicDecision()` gate with confidence tiers. All 4 execution sites route through the gate. Gate outcome is authoritative — no caller overrides.

**Ladder contract enforced**: `Deterministic high-confidence → bounded LLM (if unresolved) → safe clarifier`

---

## Changes

### 1. Shared Decision Gate

**File**: `lib/chat/input-classifiers.ts` (lines 628–788)

Types and single shared gate for all option-selection paths.

```typescript
export type DeterministicOutcome = 'execute' | 'llm' | 'clarify'
export type MatchConfidence = 'high' | 'medium' | 'low' | 'none'
export type DecisionReason =
  | 'exact_label' | 'exact_sublabel' | 'exact_canonical'
  | 'soft_contains' | 'soft_starts_with' | 'soft_label_contains'
  | 'soft_multi_match' | 'no_match'

export function evaluateDeterministicDecision(
  input: string,
  candidates: Array<{ id: string; label: string; sublabel?: string }>,
  mode: 'active_option' | 'command'
): DeterministicDecision
```

**Confidence tiers**:
- `high` → `execute`: exact label, exact sublabel, or exact canonical token match (unique)
- `medium` → `llm`: soft single match (contains, startsWith, labelContainsInput)
- `low` → `llm`: soft multi-match
- `none` → `llm` (active_option mode) or `clarify` (command mode)

**Canonical token matching** (`exact_canonical`): Handles singular/plural normalization (panels→panel, link→links) via bidirectional token-set equality. "links panel" matches "Links Panels" because canonical tokens {links, panel} === {links, panel}.

### 2. Structured Option Matching (routing-dispatcher.ts)

**Removed**: `findExactOptionMatch` (replaced entirely, zero references remain)

**Added `findOptionCandidates`** (lines 438–485): Returns `OptionCandidate[]` with `OptionMatchType` per candidate, providing structured match info for LLM arbitration.

**Added `findHighConfidenceMatch`** (lines 491–511): Gated wrapper that delegates to `evaluateDeterministicDecision`. Returns non-null only for `outcome === 'execute'`.

### 3. Six Execution Sites Gated (Fully Universal)

| Site | File | Description | Gate mechanism |
|------|------|-------------|---------------|
| 1 | `routing-dispatcher.ts` ~line 1804 | `label_match_selection` (pending options) | `findHighConfidenceMatch` |
| 2 | `routing-dispatcher.ts` ~line 2084 | `label_match_from_message` (message history) | `findHighConfidenceMatch` |
| 3 | `routing-dispatcher.ts` ~lines 563, 598 | `resolveSelectionFollowUp` (chat/widget) | `findHighConfidenceMatch` |
| 4a | `chat-routing.ts` ~line 4708 | Tier 1b.3 single-match | `evaluateDeterministicDecision(trimmedInput, ...)` |
| 4b | `chat-routing.ts` ~line 4803 | Tier 1b.3 multi-match exact-normalized | `evaluateDeterministicDecision(inputForMatching, ...)` |
| 5a | `chat-routing.ts` ~line 3292 | Scope-cue Phase 2b single-match | `evaluateDeterministicDecision(candidateForLabelMatch, ...)` |
| 5b | `chat-routing.ts` ~line 3333 | Scope-cue Phase 2b multi-match exact-first | `evaluateDeterministicDecision(candidateForLabelMatch, ...)` |

**Escape prevention** (Site 1, ~line 1910): `hasSoftMatchCandidate` bypass for `looksSelectionLike` word-count gate. Ensures soft matches always reach `callClarificationLLMClient` regardless of input length.

**Scope-cue gating** (Sites 5a, 5b): Input passes through `canonicalizeCommandInput` (verb/article stripping) before reaching the gate. E.g., "open the links panel d in chat" → stripped "links panel d" → gate: exact_label → execute. But "open the panel d from chat" → stripped "panel d" → gate: soft_contains → llm (falls through to unified hook → bounded LLM → safe clarifier).

**Gate is authoritative at all sites**: When gate says `outcome !== 'execute'`, code falls through to bounded LLM. No caller overrides.

### 4. Provenance Badge Fix

**Problem**: `chat-navigation-panel.tsx:1658` defaults to `'deterministic'` when `_devProvenanceHint` is missing (`?? 'deterministic'`). Safe clarifier paths returned `undefined` → false "Deterministic" badge.

**File**: `lib/chat/chat-navigation-context.tsx` (line 363)
```typescript
export type ChatProvenance = 'deterministic' | 'llm_executed' | 'llm_influenced' | 'safe_clarifier'
```

**File**: `components/chat/ChatMessageList.tsx` (line 29)
- Added gray "Safe Clarifier" badge style for `safe_clarifier` provenance.

**Fixed return paths in `chat-routing.ts`**:
- Line 5125: Tier 1b.3 safe clarifier → `'safe_clarifier'` (was `undefined`)
- Line 3606: Scope-cue safe clarifier → `'safe_clarifier'` (was `undefined`)
- Line 4950: Scope-not-available fallback → `'safe_clarifier'` (was missing)
- Line 3460: Scope-cue scope_not_available fallback → `'safe_clarifier'` (was missing)

**Explicit `_devProvenanceHint: 'deterministic'`** added to:
- 7 return sites in `routing-dispatcher.ts` that were relying on the `?? 'deterministic'` fallback
- 2 scope-cue Phase 2b gated execution sites (lines 3312, 3351)
- 2 scope-cue continuity resolver / need_more_info veto sites (lines 3427, 3555)

### 5. Badge Extraction Fix

**File**: `chat-routing.ts` (line 4545)

**Problem**: `extractBadge` didn't strip trailing punctuation. Input "links panel d?" → last token "d?" → failed `/^[a-z]$/` check → badge not extracted → fell through to soft match path.

**Fix**: Strip trailing punctuation before badge check:
```typescript
const lastToken = tokens[tokens.length - 1].replace(/[?!.,;:]+$/, '')
```

---

## Files Modified

| File | Change |
|------|--------|
| `lib/chat/input-classifiers.ts` | Added types + `evaluateDeterministicDecision()` with canonical token matching |
| `lib/chat/routing-dispatcher.ts` | Replaced `findExactOptionMatch` with `findOptionCandidates` + `findHighConfidenceMatch`; gated sites 1-3; added `hasSoftMatchCandidate` bypass; explicit provenance on 7 returns |
| `lib/chat/chat-routing.ts` | Gated site 4 (single-match + exact-normalized); badge extraction punctuation fix; safe_clarifier provenance on 3 return paths |
| `lib/chat/chat-navigation-context.tsx` | Added `'safe_clarifier'` to `ChatProvenance` type |
| `components/chat/ChatMessageList.tsx` | Added `safe_clarifier` badge style |

## Files NOT Modified

| File | Reason |
|------|--------|
| `lib/chat/known-noun-routing.ts` | Already uses `classifyExecutionMeta` + `isStrictExactMatch` — already ladder-compliant |
| `lib/chat/clarification-llm-fallback.ts` | Existing bounded LLM infrastructure unchanged |

---

## New Test Files

| File | Tests | Description |
|------|-------|-------------|
| `__tests__/unit/chat/deterministic-gate.test.ts` | 19 | Unit tests for `evaluateDeterministicDecision` (all confidence tiers, canonical tokens, reason allowlist) |
| `__tests__/unit/chat/deterministic-gate-regression.test.ts` | 12 | Regression + invariant tests (noisy inputs never execute, provenance, unresolved safety) |
| `__tests__/integration/chat/tier1b3-noisy-soft-match.integration.test.ts` | 10 | Integration test calling real `handleClarificationIntercept` with mocked context |

---

## Verification

```
$ npx tsc --noEmit -p tsconfig.type-check.json
(clean — no errors)

$ npx jest --no-coverage __tests__/unit/chat/ __tests__/integration/chat/
Test Suites: 33 passed, 33 total
Tests:       734 passed, 734 total
```

### Key test scenarios verified:

**Gate blocks soft matches (NOT deterministic)**:
- "good morning asssitant can you the open links panels" + options → `handleSelectOption` NOT called
- "pls show the Links Panel D thank you" + options → `handleSelectOption` NOT called
- "can you open links panels" + options → `handleSelectOption` NOT called
- "hey open that links panel d for me" + options → `handleSelectOption` NOT called

**Gate allows exact matches (deterministic)**:
- "Links Panels" → `handleSelectOption` IS called with correct option
- "links panel d" (lowercase) → `handleSelectOption` IS called
- "link panels" (canonical: link→links, panels→panel) → exact_canonical → execute

**Multi-match → exact-normalized (deterministic via canonical tokens)**:
- "open links panel" → multi-match all 3 → exact-normalized narrows to "Links Panels" → gate: `exact_canonical` → execute

**Invariants**:
- `outcome === 'execute'` always has `confidence === 'high'`
- Noisy inputs never get `outcome === 'execute'`
- All reasons from fixed allowlist
- Safe clarifier path returns `_devProvenanceHint: 'safe_clarifier'` (not `undefined`)

---

## Design Decisions

1. **Gate is authoritative**: No caller overrides the gate outcome. If the gate says `llm`, the code falls through to bounded LLM / safe clarifier — even if the caller knows the match is unique. This prevents over-execution of noisy inputs.

2. **Canonical token matching as high-confidence**: Bidirectional token-set equality after singular/plural normalization (panels→panel, link→links) is treated as `exact_canonical` (high confidence). This preserves the "exact-first" intra-selection precedence for the multi-match path without being a gate override.

3. **Verb-stripped input for exact-normalized gate**: The multi-match exact-normalized gate call passes `inputForMatching` (verb-stripped) instead of `trimmedInput`, so the gate sees "links panel" instead of "open links panel". The canonical token matching then succeeds.

4. **`soft_contains` single-match is NOT upgraded**: Even when `findMatchingOptions` returns exactly 1 match and the input contains the complete label, the gate's `soft_contains → llm` decision is respected. The bounded LLM is the appropriate arbiter for noisy inputs with embedded labels.

---

## Risks / Limitations

1. **LLM dependency for noisy inputs**: When the bounded LLM is not available or disabled, noisy inputs that clearly reference a specific option (e.g., "pls show the Links Panel D thank you") will fall to safe clarifier instead of auto-executing. This is by design (ladder compliance) but may feel slower to users.

2. **Badge extraction is the only "shortcut"**: Inputs ending with a badge suffix ("links panel d?") are resolved via badge extraction (deterministic, bypasses the gate). If the badge extraction fails for other reasons, the input falls to the gate → LLM → safe clarifier path.

3. **Canonical token map is hardcoded**: The `CANONICAL_TOKEN_MAP` in the gate (panel/panels, widget/widgets, link/links) covers current option labels but may need expansion for future option types.
