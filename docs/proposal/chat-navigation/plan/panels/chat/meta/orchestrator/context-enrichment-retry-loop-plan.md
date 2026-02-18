# Context-Enrichment Retry Loop Plan

**Status:** Draft
**Owner:** Chat Navigation
**Last updated:** 2026-02-18

## Supersession Note

This plan remains background/reference. For active implementation authority, use:
- `grounding-continuity-anti-reclarify-plan.md` (shared enrichment contract),
- `selection-continuity-execution-lane-plan.md` (selection lane),
- `non-selection-semantic-continuity-answer-lane-plan.md` (semantic lane).

If this file conflicts with those plans, the latter set wins.

Authoritative sections pointer (MUST for implementation):
- Shared invariants/constants/fallback reasons: `grounding-continuity-anti-reclarify-plan.md`
- Selection-lane execution behavior and blocker tests: `selection-continuity-execution-lane-plan.md`
- Semantic-lane behavior and blocker tests: `non-selection-semantic-continuity-answer-lane-plan.md`

## Purpose
Add one bounded retry loop so unresolved selection inputs can be resolved with enriched local context before asking the user again.

Target behavior:
1. Deterministic execute only when the system is 100% sure (unique deterministic winner).
2. Unresolved -> constrained LLM.
3. LLM requests more context -> app fetches bounded context -> one retry.
4. If still unresolved/fail/timeout/abstain/low_confidence -> safe clarifier (no unsafe execute).

## Why
Current one-shot arbitration overuses clarifier prompts in obvious user intents when the first LLM call is context-thin.

## Pre-Read Compliance
- **Isolation Reactivity Anti-Patterns:** Not applicable (no provider contract expansion or new `useSyncExternalStore` hooks). This plan is routing-layer orchestration only.

## Normative Dependencies
This plan inherits and must not conflict with:
- `deterministic-llm-arbitration-fallback-plan.md`
- `deterministic-llm-ladder-enforcement-addendum-plan.md`
- `universal-selection-resolver-plan.md`

If conflicts occur, the ladder/addendum rules win.

## Scope
In scope:
- `lib/chat/chat-routing.ts` unresolved arbitration helper path
- `lib/chat/routing-dispatcher.ts` grounding LLM unresolved path
- LLM request/response contract for bounded context enrichment

Out of scope:
- global retrieval ranking changes
- cross-corpus policy rewrites
- unbounded tool use by LLM

## Required Rules
1. **Single orchestration loop**
   - One shared `runBoundedArbitrationLoop(...)` controls first call + optional retry.
2. **Bounded context only**
   - Retry enrichment may use only local, scoped sources that are valid for the currently resolved scope.
   - In active-option unresolved flows, enrichment may add evidence/metadata only; it must not introduce new candidate IDs outside the current active option set.
3. **Retry budget = 1**
   - At most one enrichment retry per unresolved cycle.
4. **No unsafe execute**
   - Execute only when existing deterministic/Phase C gates pass.
5. **Need-more-info is structured**
   - LLM may ask for specific context class (`request_context`) instead of generic user clarifier.
6. **Scope precedence preserved**
   - Explicit `from chat` / `in chat` binds scope before candidate generation.
7. **Fallback remains safe**
   - timeout/rate_limited/transport_error/abstain/low_confidence -> safe clarifier.
8. **Shared classifier/canonicalization only**
   - Use `canonicalizeCommandInput` and `classifyArbitrationConfidence` as the single eligibility contract.
9. **Loop-guard continuity**
   - If loop guard suppresses a repeated call in the same cycle, reuse prior suggestion ordering.
10. **Explicit scope coverage is multi-source**
   - Scope handling must cover explicit cues for chat, active widget, active dashboard, and active workspace (not chat-only phrasing).
11. **Retry requires new evidence**
   - A retry is allowed only when enrichment adds new evidence (fingerprint change). If evidence is unchanged, skip retry and return safe clarifier/`need_more_info`.
12. **Requested context is bounded**
   - `request_context` may request only allowlisted evidence types, with strict item-count and token/size budgets.
13. **Deterministic confidence gate is strict**
   - If deterministic confidence is not 100% (no unique deterministic winner), do not execute.
   - In active-option scope, unresolved input must ladder to bounded LLM before any unrelated downstream fallback, except hard exclusions (question-intent, no active-option context, or feature flags disabled).

## Binding Hardening Rules

1. **LLM contract versioning is mandatory**
   - Any change to LLM decision schema (new `decision` value or required payload change) must bump `contractVersion` and ship behind an explicit flag.
   - Decision-set changes must never be introduced silently.
2. **Scope handling must be exhaustive**
   - All declared scope values must be handled explicitly in resolver/candidate builder logic.
   - Unknown/unhandled scope must return scope-specific `need_more_info` (never default to mixed pools).
3. **Entry gate is single-source**
   - This loop may be entered only from the post-deterministic unresolved hook.
   - No pre-gate or parallel branch may call the loop for active-option arbitration.

## Explicit Scope Cue Matrix (Normative)

The resolver must treat explicit scope cues as first-class bindings before candidate generation.

- **Chat scope cues**
  - Examples: `from chat`, `in chat`, `from earlier options`
- **Widget scope cues**
  - Examples: `from recent`, `from links panel d`, `from active widget`
- **Dashboard scope cues**
  - Examples: `from dashboard`, `in dashboard`, `from active dashboard`
- **Workspace scope cues**
  - Examples: `from workspace`, `in workspace`, `from active workspace`

Rules:
- Explicit scope cue binds source first (before latch/default/bypass).
- Once bound, deterministic + LLM candidate pools must remain scope-bound.
- If bound-scope candidates are unavailable/insufficient, return scope-specific `need_more_info` (no cross-scope guess/execute).

## LLM Contract Extension
Add decision:
- `request_context`

Response fields:
- `contractVersion`: semantic/monotonic contract identifier (required)
- `neededEvidenceTypes`: array of enum values from the canonical allowlist in `grounding-continuity-anti-reclarify-plan.md`:
  - `chat_active_options`
  - `chat_recoverable_options`
  - `active_widget_items`
  - `active_dashboard_items`
  - `active_workspace_items`
  - `scope_disambiguation_hint`
- `reason`: brief explanation

Constraints:
- No free-form tool instructions.
- If requested context is unavailable, orchestrator returns safe clarifier.
- `neededEvidenceTypes` must remain scope-bound (no cross-scope candidate mixing).
- Max requested evidence types per turn: 1-2 (hard cap; map to `NEEDED_EVIDENCE_TYPES_MAX` from `grounding-continuity-anti-reclarify-plan.md`).
- Per-evidence budget caps must be enforced by app policy (no "give me everything").
- Contract changes require `contractVersion` bump + flag gate.

## Implementation Plan (Reference Only)

This section is non-authoritative and retained for historical/reference clarity. Implement active behavior from Plan 19/20/21 when any statement differs.

### Step 1 — Shared orchestrator
**Files:** `lib/chat/chat-routing.ts` (primary), optional extraction to `lib/chat/arbitration-loop.ts`

Add:
- `runBoundedArbitrationLoop(params)`:
  - input text
  - initial bounded candidates
  - scope metadata
  - loop guard key
  - context fetch callbacks

Flow:
0. run deterministic classification; execute only on unique deterministic winner (100% sure)
1. otherwise, call bounded LLM (attempt 1) unless blocked by hard exclusions
2. if `select` -> execute only via existing deterministic/Phase C gates; otherwise safe clarifier
3. if `request_context` and retryBudget > 0 -> fetch allowed context -> compute evidence fingerprint delta
4. retry only if fingerprint changed; otherwise skip retry and return safe clarifier/`need_more_info` (`no_new_evidence`)
5. if fingerprint changed -> rebuild bounded candidates -> call LLM (attempt 2)
6. else -> safe clarifier

Active-option placement rule:
- In active-option flows, invoke this loop from the single post-deterministic unresolved hook in `chat-routing.ts` only.
- `routing-dispatcher.ts` may reuse the helper for non-active-option grounding flows, but must not introduce a second unresolved hook for active-option arbitration.

### Step 2 — Context fetchers (bounded)
**Files:** `lib/chat/chat-routing.ts`, `lib/chat/routing-dispatcher.ts`

Add explicit fetch adapters:
- `getScopedChatOptions()`
- `getScopedWidgetOptions()`

No global corpus fetch inside retry loop.

### Step 2a — Explicit scope resolver expansion (required)
**Files:** `lib/chat/input-classifiers.ts`, `lib/chat/chat-routing.ts`, tests

Add deterministic multi-source scope parsing (not chat-only):
- Extend `ScopeCueResult.scope` to include `dashboard` and `workspace`.
- Keep existing chat cues and add deterministic parsing for:
  - widget cues (for example `from recent`, `from links panel d`, `from active widget`)
  - dashboard cues (for example `from dashboard`, `in dashboard`, `from active dashboard`)
  - workspace cues (for example `from workspace`, `in workspace`, `from active workspace`)
- Ensure explicit scope resolution runs before latch/default/bypass routing.
- If cue text exists but cannot be bound to a concrete scope instance, return scope-specific `need_more_info` (do not guess or cross-mix).

Acceptance:
- Explicit widget/dashboard/workspace scope cues bind deterministically before unresolved arbitration.
- Ambiguous explicit scope cues never downgrade to chat-default/no-scope behavior.

### Step 3 — Scope-safe candidate builder
**Files:** `lib/chat/chat-routing.ts`

- Build candidate pool from scope first.
- For explicit chat scope: do not include widget-only candidates.
- For widget scope: do not include chat-only candidates.
- For explicit dashboard scope: do not include chat/widget/workspace-only candidates.
- For explicit workspace scope: do not include chat/widget/dashboard-only candidates.
- For unresolved scope: return scope clarifier, not mixed-guess execute.

### Step 4 — Retry-aware loop guard
**Files:** `lib/chat/chat-routing.ts`

Guard key:
- `normalizedInput + evidenceFingerprint + loop_cycle_id`
- `evidenceFingerprint` must include `scopeBinding` with concrete scope instance id (widget/dashboard/workspace/chat option set) per Plan 19.

Evidence fingerprint gate:
- Compute `evidenceFingerprintBefore` and `evidenceFingerprintAfter` around enrichment.
- `enrichmentSignature` and fingerprint payload serialization must follow the canonical JSON/sorting rules from `grounding-continuity-anti-reclarify-plan.md`.
- Retry is permitted only when fingerprints differ.
- If unchanged, set fallback reason `no_new_evidence` and do not re-call LLM.

Reset on:
- input change
- candidate set change
- option-set change
- successful resolution
- clarification cleared/chat reset

Continuity:
- On same-cycle guard hit, do not re-call LLM; reuse prior suggestion ordering.

### Step 5 — Telemetry
**Files:** `lib/chat/routing-telemetry.ts`, call sites in routing modules

Emit:
- `arbitration_loop_started`
- `arbitration_request_context`
- `arbitration_retry_called`
- `arbitration_retry_resolved`
- `arbitration_retry_fallback`

Fields:
- scope
- candidate counts (attempt 1 / attempt 2)
- resolution_source (`deterministic` | `llm` | `clarifier`)
- attempts (`0` | `1` retry)
- evidence_fingerprint
- fallback reason (`timeout` | `rate_limited` | `transport_error` | `abstain` | `low_confidence` | `no_new_evidence` | `budget_exhausted`)
- total latency

### Step 6 — Tests (Blockers)

#### Unit
1. unresolved -> `request_context` -> retry -> `select` -> resolved
2. `request_context` but unavailable context -> safe clarifier
3. retry budget exhausted -> safe clarifier
4. explicit chat scope never mixes widget candidates
5. explicit widget scope never mixes chat candidates
6. timeout/rate_limited/transport_error/abstain/low_confidence after retry -> safe clarifier
7. loop guard suppresses duplicate retries in same cycle
8. active options + command-like unresolved input attempts bounded LLM before any escape
9. same-cycle guard hit preserves prior suggestion ordering (continuity)
10. explicit widget scope cue (`from links panel d`) binds widget candidates only
11. explicit dashboard scope cue binds dashboard candidates only
12. explicit workspace scope cue binds workspace candidates only
13. explicit scoped candidates unavailable -> scope-specific `need_more_info` (no cross-scope fallback)
14. explicit scope cue with unresolved target identity -> scope-specific `need_more_info` (no implicit fallback to chat scope)
15. `request_context` with unchanged evidence fingerprint -> no retry, fallback reason `no_new_evidence`
16. `request_context` exceeding allowlist caps -> rejected and falls back safely
17. unknown scope value -> scope-specific `need_more_info` (no mixed-pool fallback)
18. decision-set change without supported `contractVersion` -> loop rejects and falls back safely

#### Integration
1. Active widget + `from chat` unresolved phrasing uses chat-scoped retry, not widget candidate pool
2. Obvious typo/polite selection resolves after retry without extra user clarifier when confidence gates pass
3. Same case with retries disabled falls back to current safe clarifier behavior
4. Active options + unresolved command-like input does not fall through to unrelated downstream disambiguation before LLM attempt
5. `from links panel d` + entry target resolves against Links Panel D item candidates, not panel-level fallback
6. explicit dashboard/workspace cues remain source-bound through retry and fallback paths
7. explicit scope cue resolution occurs before latch/widget bypass (no early bypass suppression)
8. repeated `request_context` with unchanged evidence does not loop; emits `no_new_evidence` and returns stable clarifier
9. active options + ambiguous command-like input enters loop only via post-deterministic unresolved hook (or safe clarifier when flag off), never unrelated downstream clarifier

## Rollout
- Flag: `NEXT_PUBLIC_LLM_CONTEXT_RETRY_ENABLED`
- Default OFF
- Internal dogfood first
- Success criteria:
  - lower clarifier rate for unresolved selection-like inputs
  - no increase in wrong-execution incidents
  - stable p95 latency within budget

## Non-Deviation Contract
- MUST NOT call unbounded retrieval from this loop.
- MUST NOT bypass scope precedence.
- MUST NOT execute on `request_context` / unresolved states.
- MUST NOT exceed one enrichment retry.
- MUST keep safe clarifier fallback on all failure modes.
- MUST NOT cross-mix scope candidates during enrichment.
- MUST NOT bypass shared classifier/canonicalization contract.
- MUST NOT duplicate unresolved-hook entry points for active-option flows.
- MUST NOT treat explicit widget/dashboard/workspace scope cues as chat-default or no-scope input.
- MUST NOT re-call LLM when enrichment produced no new evidence fingerprint.
- MUST NOT accept unbounded or free-form context requests.
- MUST NOT silently extend LLM decision schema without `contractVersion` bump and flag gate.
- MUST NOT default unknown scope to mixed candidate pools.
