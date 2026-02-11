# Deterministic -> LLM -> Safe Fallback Arbitration Plan

Related addendum:
- `deterministic-llm-ladder-enforcement-addendum-plan.md` (active-option ladder enforcement and typo-command collision prevention)

## Context

Deterministic routing handles most inputs well but becomes inconsistent in low-confidence cases:
- typo-heavy ordinal/label inputs (`secone`, `sumary155`)
- cross-source ambiguity (chat options vs widget items vs known command)
- phrase variants that cross strict/lenient gates across tiers

Goal: keep deterministic routing as primary, invoke constrained LLM only for unresolved uncertainty, and never execute a risky best-guess when LLM is unavailable.

Current rollout mode for this plan: `clarify_only` (mandatory).
- LLM may assist ranking/reordering within bounded candidates.
- LLM must not directly execute actions in this rollout.
- `llm_execute` is reserved for a future rollout mode and is disabled in this phase.

## Governing Rule

1. Deterministic first.
2. If deterministic confidence is low or tie remains, call constrained LLM.
3. If LLM fails/abstains, return deterministic-safe clarifier (non-blocking), not execution.

## Confidence Contract (Single Source of Truth)

Define confidence once in one shared function (no per-tier reinterpretation), e.g.
`classifyArbitrationConfidence(...)` in routing layer.

Return shape:
- `high_confidence_execute`
- `low_confidence_llm_eligible`
- `low_confidence_clarifier_only`

`ambiguityReason` enum (mandatory):
- `multi_match_no_exact_winner`
- `cross_source_tie`
- `typo_ambiguous`
- `command_selection_collision`
- `no_candidate`

Rule:
- Any `high_confidence_execute` result executes deterministically.
- Any `low_confidence_llm_eligible` result can call LLM.
- Any `low_confidence_clarifier_only` result skips LLM and shows deterministic clarifier.

## Decision Ladder

### Step 1 - Deterministic high-confidence path

Execute immediately when any of these are true:
- unique exact normalized label match
- unique ordinal/badge match in active context
- explicit scope cue + unique target
- known command where selection-like resolution does not produce a unique active-option match

### Step 2 - Deterministic low-confidence / tie detection

Mark as unresolved (LLM-eligible) when any of these are true:
- multi-match with no exact winner
- cross-source tie (chat and widget both produce plausible candidates)
- typo-normalized candidate remains ambiguous
- command-like input overlaps active options without unique winner

Selection-vs-command collision guard (required):
- If input is selection-like and uniquely matches an active option -> deterministic selection execute.
- Else if command intent is strong (explicit verb+noun) and active options do not have a unique winner -> command path.
- Else unresolved -> LLM arbitration or deterministic clarifier.

### Step 3 - Constrained LLM arbitration

Call LLM only with bounded candidate pool and metadata:
- candidate list from unresolved sources only
- candidate ids, labels, type, optional hints
- no permission to execute arbitrary actions
- never include known-command candidates unless they are already part of the unresolved tie set

**Latency budget:** `LLM_TIMEOUT_MS = 800` (same constant from `lib/chat/clarification-llm-fallback.ts:42`).
Abort via `AbortController` at 800ms — consistent with existing clarification LLM path.

Expected LLM output:
- selected candidate id with confidence, or
- abstain / need clarification

Clarify-only contract (this rollout):
- selected candidate id is used to prioritize/suggest options in clarifier UI.
- selected candidate id must not trigger direct execution.

Confidence floor:
- if `confidence < LLM_CONFIDENCE_MIN` (configurable constant), treat as abstain.
- abstain always routes to deterministic clarifier (never execute).

### Step 4 - Safe fallback on LLM failure

If LLM times out (>= 800ms), 429s, transport fails, or abstains:
- do **not** execute best-guess
- show deterministic grounded clarifier using same candidate pool
- preserve routing safety and continue conversation

## Implementation Scope

### A. Dispatcher integration

File: `lib/chat/routing-dispatcher.ts`
- Add a shared `shouldUseLLMArbitration(...)` gate.
- Require `shouldUseLLMArbitration(...)` to consume:
  - `ambiguityReason` from grounding/deterministic resolver output
  - `confidenceBucket` from `classifyArbitrationConfidence(...)`
  - no local per-tier heuristics that reinterpret low-confidence conditions
- Gate only unresolved/tie states; skip for high-confidence deterministic winners.
- On LLM failure, call grounded clarifier path directly.

### B. Grounding-set integration

File: `lib/chat/grounding-set.ts`
- Keep deterministic resolver unchanged for high-confidence outcomes.
- Return explicit `ambiguityReason` for unresolved cases (tie, multi-match, typo ambiguity).
- Provide bounded candidates for arbitration input.

### C. Clarification intercept consistency

File: `lib/chat/chat-routing.ts`
- Ensure low-confidence ambiguous states do not auto-execute.
- Route ambiguous unresolved states into LLM arbitration or safe clarifier fallback.

## Safety Invariants

1. No LLM-first routing.
2. No best-guess execution on LLM failure.
3. No source-switch execution without explicit winner.
4. Explicit scope cues always override defaults.
5. Clarify-only mode is enforced: no LLM-driven execution in this rollout.

## Observability

Add logs:
- `deterministic_high_confidence_execute`
- `deterministic_low_confidence_tie`
- `llm_arbitration_called`
- `llm_arbitration_abstained`
- `llm_arbitration_failed_fallback_clarifier`

Each log includes:
- input
- candidateCount
- sourcesInTie
- handledByTier
- finalResolution (`deterministic_execute` | `clarifier`)
- `llm_timeout_ms` (actual elapsed time when LLM was called)
- `fallback_reason` (`timeout` | `429` | `transport_error` | `abstain` | `null`)

Note:
- `llm_execute` remains a reserved future enum value for forward compatibility only.
- In this rollout, any observed `llm_execute` is a policy violation.

## Test Plan (Blockers)

### Unit

1. High-confidence deterministic winner never calls LLM.
2. Multi-match with no exact winner calls LLM.
3. LLM select result still returns clarifier (no execution) in `clarify_only` mode.
4. LLM abstain returns clarifier (no execution).
5. LLM error/429 returns clarifier (no execution).
6. LLM timeout at 800ms (`LLM_TIMEOUT_MS`) triggers clarifier fallback — log includes `fallback_reason: 'timeout'` and `llm_timeout_ms >= 800`.
7. LLM low-confidence response (`confidence < LLM_CONFIDENCE_MIN`) is treated as abstain and returns clarifier.
8. Candidate pool contract: known-command candidates are excluded unless present in tie set.
9. Collision rule: selection-like + unique active-option match executes deterministically (no LLM call).

### Integration

1. Active chat + widget tie on `second option` -> LLM arbitration path -> clarifier (no execution).
2. Same tie with LLM unavailable -> safe clarifier, no execution.
3. Typo-heavy input (`secone one`) with ambiguity -> LLM arbitration, then clarifier on abstain.
4. Exact normalized winner (`open links panel d`) -> deterministic execute, no LLM call.

## Rollout

1. Ship behind existing arbitration feature flag.
2. Freeze mode to `clarify_only` for this rollout.
3. Enable logs first, then LLM arbitration path.
4. Validate error-rate and clarifier-rate before broad rollout.
5. Any request to enable LLM auto-execute requires a separate plan/addendum and explicit acceptance updates.

## Anti-Pattern Compliance (Mandatory)

Reference: `codex/codex_needs_to_avoid/isolation-reactivity-anti-patterns.md`

Applicability: **Not applicable** to isolation provider/minimap reactivity.

Reason:
- This plan changes chat arbitration/routing only.
- No new isolation context fields or `useSyncExternalStore` hooks.
- No provider/consumer API shape change in isolation subsystem.
