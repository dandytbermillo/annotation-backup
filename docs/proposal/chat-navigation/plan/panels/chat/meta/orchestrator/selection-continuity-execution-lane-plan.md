# Selection Continuity Execution Lane Plan

## Context

Selection follow-ups are structurally bounded (finite candidates, active scope, active option set), but they still need continuity state for references like `that`, `it`, and short imperative follow-ups.

Current issue class: repeated clarifiers for commands that have a safe unique winner in the active bounded set.

## Goal

Reduce unnecessary clarifiers in selection/command follow-ups while preserving the deterministic -> bounded-LLM -> safe-fallback ladder.

## Non-Goals

- No free-form execution outside bounded candidates.
- No semantic/explanatory answer generation in this lane.
- No replacement of existing interrupt/stop guards.

## Normative Dependencies (MUST)

Precedence order for this lane:

1. `deterministic-llm-ladder-enforcement-addendum-plan.md` (deterministic/LLM/fallback safety contract)
2. `universal-selection-resolver-plan.md` (scope/source/latch arbitration contract)
3. `grounding-continuity-anti-reclarify-plan.md` (shared continuity umbrella invariants)
4. This plan (lane-specific mechanics)

If this plan conflicts with (1) or (2), this plan must be updated before implementation.

## Core Principles

1. Deterministic with context is allowed and preferred when 100% safe.
2. Not 100% safe means no deterministic execution; continue to bounded LLM and governing fallback behavior (including Phase C gated auto-execute only when enabled and eligible). LLM output is advisory and cannot execute unless governing gates approve.
3. Continuity state is structured, bounded, and scope-aware.
4. This lane plugs into the active selection policy/resolver; it does not replace governing precedence contracts.

## Lane Contract

### Inputs

- Current user input
- Active bounded candidates
- Structured continuity state:
  - `activeOptionSetId`
  - `activeScope`
  - `lastResolvedAction`
  - `recentActionTrace[]` (see canonical schema in `grounding-continuity-anti-reclarify-plan.md`)
  - `lastAcceptedChoiceId`
  - `recentAcceptedChoiceIds` (small fixed window)
  - `recentRejectedChoiceIds` (small fixed window)
  - `pendingClarifierType` (see canonical enum in `grounding-continuity-anti-reclarify-plan.md`)

### Output

- Execute safe winner, or
- Execute via governing Phase C gated auto-execute (when enabled and eligible and gate-approved), or
- Clarifier, or
- Downstream escape for hard exclusions (question-intent, hard interrupt, etc.)

## Decision Flow

1. Run deterministic matcher with continuity context.
2. Execute only if all are true:
   - command/selection-like input,
   - unique winner in active bounded set,
   - same `activeOptionSetId`,
   - same `activeScope`,
   - no collision, no question-intent, no loop-guard conflict.
3. If unresolved, call bounded LLM.
   - If bounded LLM is feature-disabled for this scope, return a safe clarifier in the same active context (no downstream unrelated escape).
   - In explicit scope-cue flows with recoverable scoped options (for example `from chat`), unresolved turns must enter the scoped unresolved hook; do not bypass directly to downstream command routing on zero-match command phrasing.
4. If LLM returns `need_more_info`, apply strict veto:
   - if deterministic safe-winner gates prove a unique safe winner, execute via deterministic path;
   - else clarifier.

Important: `need_more_info` veto execution is never a direct LLM execute decision. The LLM response is advisory; execution authority remains deterministic safe-winner gates.

### Context Enrichment Loop (Selection Lane, MUST)

`request_context` handling is owned by the shared arbitration loop contract (`runBoundedArbitrationLoop`). This lane must not implement a separate `request_context` parser/loop.
Decision mapping follows Plan 19: canonical unresolved outcome is `need_more_info`; `request_context` is its structured evidence-request variant.

Budgets:

- Use canonical constants from Plan 19:
  - `SELECTION_MAX_ENRICHMENT_STEPS`
  - `SELECTION_MAX_LLM_CALLS`

Allowlisted enrichment types:

- Refresh focused widget snapshot (bounded top-N + focused item).
- Refresh active option set snapshot (same scope, same cycle).
- Add missing metadata for current candidates only (paths/sublabels/recency).

Never do:

- Broad search across whole app/workspace in this lane.
- Cross-scope enrichment without explicit scope-cue override.
- Additional retries when fingerprint unchanged.

Stop conditions:

- `evidenceFingerprint` unchanged after enrichment.
- Enrichment budget exhausted.
- Candidate/scope safety checks fail.
- Loop-guard key unchanged for current unresolved cycle.

On stop: return grounded safe clarifier in same active context.

## Implementation Binding (MUST)

1. Use governing shared utilities for selection arbitration/canonicalization; do not add lane-local ad-hoc classifiers that bypass governing contracts.
2. Keep one post-deterministic unresolved arbitration hook in active-option flows; this lane must not introduce parallel unresolved LLM entry points.
3. Enforce explicit scope-cue precedence before widget bypass in scoped selection arbitration.
4. Enforce scope-bound candidate pools for scoped arbitration (`from chat` -> chat-origin candidates, etc.); no cross-scope mixed arbitration pool.
5. In scope-cue active arbitration with recoverable scoped options, keep one scoped unresolved entry path; do not add zero-match command bypass logic that skips scoped unresolved LLM/clarifier handling.

## Safety Invariants

1. Execute only candidate IDs present in the bounded candidate pool.
2. No cross-source/scope execution without explicit safe winner.
3. Respect stop/cancel/start-over interrupts.
4. Keep existing loop-guard continuity behavior.
   - When loop guard suppresses a same-cycle re-call, preserve prior suggestion ordering for the current option-set cycle.
5. Preserve ladder addendum constraints and fallback guarantees.
6. Context replacement invariant (MUST): when a new active selection context is registered, stale competing contexts must be replaced; continuity logic must not resurrect stale option sets.
7. Command-selection collision invariant (MUST): continuity tie-break cannot override the collision policy defined by governing selection-vs-command arbitration; unresolved collisions must remain unresolved until deterministic or bounded-LLM resolution is valid.
8. Scoped arbitration invariant (MUST): explicit scope cues must be evaluated before widget bypass and must use same-scope candidate pools only.

## Telemetry

Track reasoned outcomes:

- `selection_deterministic_continuity_resolve`
- `selection_llm_select`
- `selection_llm_need_more_info`
- `selection_need_more_info_veto_applied`
- `selection_need_more_info_veto_blocked_reason`
- `selection_enrichment_retry_called`
- `selection_enrichment_fingerprint_unchanged`
- `selection_enrichment_budget_exhausted`

Include `activeOptionSetId`, `activeScope`, candidate count, and collision flags.
Include loop-cycle fields from Plan 19 (`loop_cycle_id`, `fingerprint_before`, `fingerprint_after`, `retry_attempt_index`, `retry_budget_remaining`).

## Test Plan (Blockers)

1. `open the sample2 pls` resolves without repeated clarifier when unique safe winner exists.
2. True ambiguity still clarifies.
3. Stale `activeOptionSetId` does not force old winner.
4. Question-intent and hard interrupts still bypass correctly.
5. No execution outside bounded candidates.
6. Explicit scope cue precedence: `from chat` is evaluated before widget bypass in unresolved selection flows.
7. Scope-bound candidates: scoped arbitration calls do not mix candidates from other scopes.
8. Fingerprint unchanged after enrichment -> no second LLM call; grounded clarifier is returned.
9. Selection enrichment budget exhausted -> no further retry; grounded clarifier is returned.
10. Phase C interaction: with auto-exec ON/OFF, enrichment flow must still respect governing Phase C gates and must not create a new execute path.
11. Loop-guard continuity: same-cycle guard hit reuses prior suggestion ordering for the same option-set cycle (no random reorder drift).
12. Scope-cued filler/polite command (`open the panel d from chat pls thank you`) with no deterministic winner still stays in scoped unresolved handling (deterministic-or-LLM), never unrelated downstream clarifier.
13. Scope-cued ambiguous selection-like input (`that one from chat`) does not trigger command bypass and still enters scoped unresolved handling.

## Rollout

- Flag: `NEXT_PUBLIC_SELECTION_CONTINUITY_LANE_ENABLED` (default `false`)
- Dev -> staging -> gradual enablement with telemetry gate review.
- Apply numeric rollback thresholds from Plan 19 rollout guardrails.

## Anti-Pattern Compliance Check

Reference: `codex/codex_needs_to_avoid/isolation-reactivity-anti-patterns.md`

Applicability: **Partially applicable** (context contract evolution risk).

Compliance:

- Backward-compatible state additions only.
- Feature-flagged rollout.
- No immediate UI hard dependency on new context fields.
- No coupled behavior-priority changes in the same patch.
