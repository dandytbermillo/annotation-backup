# Deterministic -> LLM Ladder Enforcement Addendum

## Context

The intended arbitration contract is:

1. Deterministic high-confidence execute.
2. Deterministic low_confidence or unresolved ambiguity -> constrained LLM.
3. LLM unavailable/timeout/rate_limited/transport_error/abstain/low_confidence -> safe deterministic clarifier (no risky execute).

Current behavior is only partially aligned. In specific flows (notably typo/polite collisions like `can you ope panel d` with active options), pre-gates can bypass active-option arbitration before LLM eligibility is evaluated, leading to unrelated downstream clarifiers.

This addendum enforces the ladder consistently for active clarification contexts without changing broader routing architecture.

## Authority Boundary (Parent Plan vs Addendum)

Parent authority:
- `deterministic-llm-arbitration-fallback-plan.md` defines the global policy (deterministic first, LLM only for unresolved ambiguity, safe fallback only).

Addendum authority:
- This document defines **where and how** that policy is enforced in active-clarification flows.
- If this addendum conflicts with the parent policy, parent policy wins.
- If code behavior conflicts with this addendum in active-clarification tiers, this addendum wins over local ad-hoc behavior.

## Scope

In scope (this addendum):
- Active clarification option flows in `lib/chat/chat-routing.ts` (Tier 1b.3 family).
- Shared normalization/classification enforcement in `lib/chat/input-classifiers.ts`.
- Regression tests for typo-command + active-option collision paths.

Out of scope (follow-up):
- Full cross-source tie arbitration across all tiers.
- Reworking grounding-set source prioritization semantics.
- Enabling LLM auto-execute. Clarify-only remains default.

## Required Behavioral Rules

### Rule A — Single ladder, single decision point
When active options exist, branch decisions must be based on shared confidence/arbitration signals, not local ad-hoc gates.

### Rule B — No early escape on unresolved active-option ambiguity
If input is command-like but deterministic active-option matching is weak/ambiguous, it must remain ladder-eligible (LLM or safe clarifier), not escape directly to downstream tiers.

### Rule C — LLM is bounded and clarify-only in this phase
LLM can reorder/suggest within bounded candidates but must not auto-execute in this addendum scope.
See supersession note before Phase C: gated auto-execute is only allowed when Phase C is enabled and all gates pass.

### Rule D — Safe fallback is mandatory
On timeout/rate_limited/transport_error/abstain/low_confidence, return deterministic clarifier in the same context. Never best-guess execute.

### Rule E — One unresolved hook after deterministic
Do not scatter LLM entry points across pre-gates and local branches. In active-option flows, LLM arbitration must be invoked from one unresolved hook that runs **after deterministic matching has failed** (`0-match` or `multi-match with no exact winner`).

### Rule F — Loop-guard continuity
Loop-guard may suppress repeated LLM calls within one unresolved cycle, but UI behavior must remain stable. If loop-guard blocks a re-call, reuse the last suggestion ordering for the same option-set cycle so repeated turns do not appear random.

### Rule G — Uncertain means LLM (active-option scope)
In active-option flows, if deterministic confidence is not high (not a unique deterministic winner), LLM arbitration is mandatory before any action/escape decision except explicit hard exclusions (question-intent, no active-option context, or feature flag off).

### Rule H — Scope cue precedence over widget bypass
Explicit scope cues (`from chat`, `in chat`) must be evaluated before widget-selection bypass logic. A widget-context early return must not suppress a valid chat re-anchor.

### Rule I — Scope-bound candidate pools
When explicit scope is resolved, the bounded LLM candidate pool must come from that scope only. `from chat` arbitration must not be fed widget-entry-only candidates when chat-origin options are available.

## Non-Deviation Contract (Mandatory)

This section is binding for implementation and review. Any violation is a merge blocker.

### MUST
- Use one ladder only in active-option flows: deterministic high-confidence -> LLM arbitration (bounded) -> safe clarifier fallback.
- Keep LLM candidate pool bounded to the current active option set for that cycle.
- Keep fallback behavior non-destructive: no execution on LLM timeout/rate_limited/transport_error/abstain/low_confidence.
- Use shared canonicalization/classification utilities only (`canonicalizeCommandInput`, `classifyArbitrationConfidence`).
- Enforce loop-guard semantics exactly as specified in this document.
- Keep unresolved arbitration entry centralized in one post-deterministic hook (Rule E).
- Preserve suggestion continuity when loop-guard skips a re-call (Rule F).
- Treat unresolved active-option states as LLM-mandatory (Rule G).
- Enforce explicit scope-cue precedence before widget bypass checks (Rule H).
- Keep LLM candidate pools scope-bound; no cross-scope mixing in scoped arbitration (Rule I).

### MUST NOT
- Must not add local per-tier heuristics that bypass the shared classifier contract.
- Must not inject command-space/global candidates into active-option arbitration pools.
- Must not execute on LLM result unless Phase C gates explicitly pass.
- Must not silently fall through to unrelated downstream disambiguation when active-option ambiguity remains unresolved.
- Must not add hardcoded typo dictionaries for ladder eligibility; unresolved inputs should ladder to bounded LLM.
- Must not force deterministic execution or downstream escape while active-option ambiguity is unresolved.
- Must not bypass explicit `from chat`/`in chat` via widget-context early return.
- Must not pass widget-entry-only candidates into a chat-scoped arbitration call.

### Review Gate (Required for merge)
- If code behavior differs from this contract, this addendum takes precedence over local implementation choices.
- PR must include tier assertions (`handledByTier`) for command escape and active-option handling.
- PR must include negative-path tests (timeout/rate_limited/transport_error/abstain/low_confidence) proving safe clarifier fallback.
- PR must include an unresolved command-like test proving LLM is attempted before escape in active-option context.

## Implementation Plan

### Tier Insertion Map (Exact Placement)

Mandatory insertion points:
- `lib/chat/chat-routing.ts`:
  - Tier `1b.3` pre-gate (hard-exclusion gate: question/no-active-options; explicit command does not bypass unresolved active-option ambiguity).
  - Tier `1b.3` unresolved hook (single post-deterministic arbitration hook for `0-match` and `multi-match no exact winner`).
  - Scope-cue chat block Phase `2b` (label/shorthand matching parity with Tier `1b.3`).
- `lib/chat/routing-dispatcher.ts`:
  - Interaction assertion only (no duplicate arbitration logic in this pass): command escape and downstream reachability must remain intact (`handledByTier` expectations in tests).

Non-goal for this pass:
- Do not add parallel arbitration logic in dispatcher Tier 4.5; keep this addendum scoped to chat-routing active-clarification path.

### Step 1: Keep canonicalization shared and strict (no typo dictionaries)

**Files:** `lib/chat/input-classifiers.ts`, `lib/chat/chat-routing.ts`, `lib/chat/panel-command-matcher.ts`

- Canonical normalization source of truth is `canonicalizeCommandInput(...)` in `lib/chat/input-classifiers.ts`.
- Ensure pre-gate checks, active-option candidate matching, and scope-cue Phase 2b all consume this same canonicalized value.
- Do not duplicate local typo maps in Tier 1b.3/Phase 2b.
- Do not expand hardcoded typo maps for ladder behavior; unresolved inputs must ladder via Rule E.

Acceptance:
- Polite/typo phrasing does not require new hardcoded verb entries to remain ladder-eligible.

### Step 2: Restrict pre-gate to hard exclusions only (not uncertainty routing)

**File:** `lib/chat/chat-routing.ts` (Tier 1b.3 pre-gate area)

- Pre-gate may only decide hard exclusions:
  - question-intent escape,
  - no-active-option-context escape.
- Explicit command alone is **not** sufficient for escape when active-option ambiguity is unresolved.
- Feature flag off is not an escape trigger; unresolved active-option flows must still return safe clarifier behavior.
- If active options exist and deterministic is not high-confidence, route to unresolved hook (Rule G).
- Pre-gate must not be the primary LLM trigger.
- Preserve existing deterministic exact-first/ordinal behavior before unresolved hook.

Acceptance:
- `open recent` with non-matching active options still escapes as command **only when deterministic command confidence is high and active-option arbitration is not unresolved**.
- unresolved active-option inputs do not escape early to unrelated downstream clarifiers.

### Step 3: Enforce bounded LLM from one unresolved hook

**File:** `lib/chat/chat-routing.ts` (Tier 1b.3 unresolved hook + shared helper)

- Reuse shared confidence classifier output (`classifyArbitrationConfidence`) as the sole gate for LLM eligibility.
- Invoke this from one unresolved hook that handles:
  - `matchCount === 0`, and
  - `multi-match with no exact winner`.
- In this hook, unresolved states are LLM-mandatory in active-option scope (Rule G).
- Candidate pool must be bounded to active clarification options only.
- Keep clarify-only policy: LLM suggestion may reorder options, not execute.
- Enforce loop guard with explicit key and reset policy:
  - `guardKey = normalizedInput + sortedCandidateIds + activeOptionSetId`
  - Optionally include scope key if active-option source can differ by scope.
  - Set guard only after an LLM attempt starts (success or failure).
  - Reset guard on any cycle boundary:
    - normalized input changes
    - candidate set changes
    - `activeOptionSetId` changes
    - successful resolution / selection execution
    - clarification context cleared
    - explicit command escape to downstream tiers
    - chat clear/reset
  - Guard must prevent repeated calls within one unresolved cycle, but must not suppress calls across new cycles.
  - If guard suppresses a repeated call in the same cycle, reuse prior suggestion ordering for continuity (Rule F).

Acceptance:
- Unresolved (`0-match` or `multi no-exact`) can call LLM once per cycle/input+option-set.
- No command-space candidate injection unless already part of the active option set.

### Step 4: Uniform safe fallback semantics

**Files:** `lib/chat/chat-routing.ts`, tests

- For timeout/rate_limited/transport_error/abstain/low_confidence, always show deterministic clarifier for current options.
- Add/keep explicit fallback reason logs.

Acceptance:
- Failure modes never execute actions.
- Clarifier remains anchored to current active options.

### Step 5: Scope-cue compatibility guard

**File:** `lib/chat/chat-routing.ts` (scope-cue block + Phase 2b)

- Ensure scope-cue label/shorthand path uses the same canonicalization and matching semantics as Tier 1b.3.
- Scope-cue unresolved path must also use the same unresolved hook semantics (bounded LLM -> safe clarifier), not bespoke logic.
- Rebind full option state from reordered source so ordinals map to displayed order.
- Run explicit scope-cue resolution before widget-context bypass so `from chat` cannot be short-circuited.
- In explicit chat scope, candidate pool must be chat-origin options; do not downgrade to widget-only pools when chat options exist.
- If chat scope is explicit but chat candidate pool is stale/insufficient, return `need_more_info`/scope clarifier (no forced execute, no unrelated fallback).

Acceptance:
- `ope panel d from chat` resolves against recovered chat options if available, or produces chat clarifier, not unrelated widget clarifier.

## Test Plan (Blockers)

### Unit

1. Canonicalization:
   - Shared canonicalization remains strict and shared across call sites.
2. Pre-gate:
   - command-like + unresolved active-option context -> no early escape; unresolved hook invoked.
3. High-confidence command escape remains:
   - `open recent` with non-matching active options -> bypass to command path.
4. LLM fallback safety:
   - timeout/rate_limited/transport_error/abstain/low_confidence -> clarifier, no execute.
5. LLM mandatory-on-uncertain:
   - active options + no unique deterministic winner -> LLM attempted unless blocked by hard exclusions (question-intent/no active context/feature off).
6. Loop-guard key/reset:
   - same `guardKey` in unresolved cycle -> second turn does not re-call LLM.
   - changed input/candidates/optionSet or cleared clarification -> LLM is eligible again.

7. Loop-guard continuity:
   - same cycle + guard hit -> no second LLM call, but suggested ordering remains stable.

### Integration

1. Active options `[Links Panels, Links Panel D, Links Panel E]` + `can you ope panel d pls`:
   - must not route to unrelated `sample2/workspace` clarifier.
   - must re-show relevant links options (clarify-only) with stable suggestion ordering.
2. Scope-cue:
   - `can you ope panel d from chat pls` with recoverable chat options -> chat-scope ladder path.
   - With active widget context, explicit `from chat` still reaches chat re-anchor path (no pre-bypass early return).
3. Deterministic command preservation:
   - `open recent` still executes Recent when intended.
4. Command escape tier assertion (required):
   - active non-matching options + `open recent` -> intercept returns `handled: false`, dispatcher resolves command tier (assert `handledByTier`, not message text only).
5. Unresolved-before-escape assertion (required):
   - active options + command-like unresolved input -> intercept attempts LLM (or safe clarifier when flag off), and must not fall through to unrelated downstream disambiguation.
6. Scope-bound-candidate assertion (required):
   - `from chat` unresolved arbitration must not pass widget-entry-only candidates when chat options are available.
7. Need-more-info assertion (required):
   - explicit scope + insufficient scoped candidates -> scope clarifier/`need_more_info`, not forced execute and not unrelated fallback.

## Rollout

1. Keep behind existing clarification LLM feature flag.
2. Bake in clarify-only mode.
3. Monitor logs:
   - `clarification_selection_bypassed_command_intent`
   - `llm_arbitration_called`
   - `llm_arbitration_failed_fallback_clarifier`
   - `clarification_tier1b3_multi_match_reshow`
4. Promote only after typo-collision regression set is clean.

## Anti-Pattern Compliance

Reference: `codex/codex_needs_to_avoid/isolation-reactivity-anti-patterns.md`

Applicability: **Not applicable**.

Reason: This addendum changes chat routing/arbitration logic only and does not change isolation provider APIs, `useSyncExternalStore` contracts, or minimap/control-panel reactivity behavior.

---

Supersession note:
- Phase C policy below supersedes earlier clarify-only wording when and only when its gates are ON and satisfied.
- When Phase C is OFF (or any gate fails), clarify-only fallback behavior remains the default.

## Phase C: LLM Auto-Execute for High-Confidence Results

### Policy Change

Rule C is revised: LLM may auto-execute when **all** of the following gates pass:

1. **Kill switch ON**: `NEXT_PUBLIC_LLM_AUTO_EXECUTE_ENABLED=true` (default OFF — users opt in via `.env.local`)
2. **Confidence threshold**: LLM confidence >= `AUTO_EXECUTE_CONFIDENCE` (0.85)
3. **Reason allowlist**: Ambiguity reason is in `AUTO_EXECUTE_ALLOWED_REASONS` (typed `Set<AmbiguityReason>`)

If any gate fails, behavior falls back to safe clarifier (with reorder if LLM suggested).

### Auto-Execute Allowlist

Typed `Set<AmbiguityReason>` — only:
- `no_deterministic_match` (typo/filler inputs where deterministic fails entirely)

NOT allowlisted (too ambiguous for auto-execute):
- `command_selection_collision`
- `multi_match_no_exact_winner`
- `cross_source_tie`
- `typo_ambiguous`
- `no_candidate`

### Auto-Execute Blocklist (Hard)

- Loop guard repeat input: never auto-execute on repeat (Rule F continuity returns `autoExecute: false`)
- LLM fail/timeout/rate_limited/transport_error/abstain/low_confidence: safe clarifier (Rule D unchanged)
- Question intent: falls through to downstream (Rule G unchanged)

### Kill Switch

- Flag: `NEXT_PUBLIC_LLM_AUTO_EXECUTE_ENABLED`
- Default: OFF (auto-execute disabled)
- When OFF: all LLM results produce safe clarifier (existing behavior)
- When ON + all gates pass: auto-execute fires
- Instant rollback: set flag to `false` → all auto-execute stops, falls back to clarifier

### Implementation

- Constants in `lib/chat/clarification-llm-fallback.ts`: `AUTO_EXECUTE_CONFIDENCE`, `AUTO_EXECUTE_ALLOWED_REASONS`, `isLLMAutoExecuteEnabledClient()`
- 3-gate check in `tryLLMLastChance` success path (returns `autoExecute: boolean`)
- Auto-execute branches in both unresolved hooks (Tier 1b.3 + scope-cue) with full state/snapshot/repair cleanup
- All non-success return paths set `autoExecute: false`

### Safety Summary

| Gate | Check | Fail → |
|------|-------|--------|
| Kill switch | `isLLMAutoExecuteEnabledClient()` | Safe clarifier |
| Confidence | >= 0.85 | Safe clarifier with reorder |
| Reason allowlist | `no_deterministic_match` only | Safe clarifier with reorder |
| Loop guard | Not repeat input | Safe clarifier with stored ordering |
| LLM fail/timeout | Not success | Safe clarifier, original order |
| Question intent | Excluded before LLM | Falls through to downstream |
