# Grounding Continuity Anti-Reclarify Plan

## Context

Users see repeated clarifiers for follow-up commands that should be resolvable from bounded continuity, e.g. `open the sample2 pls` right after a relevant resolution flow.

This plan adds **bounded continuity state** to grounding arbitration so we reduce unnecessary clarifiers without weakening safety.

## Scope

- In scope: grounding arbitration path, bounded continuity payload, deterministic tie-break before clarifier, strict `need_more_info` veto.
- Out of scope: global routing-order rewrite, free-form memory, unbounded history, cross-source execution outside candidate pool.

## Plan Ownership and Relationship

This file is the umbrella governance plan for continuity anti-reclarify behavior.

- Implementation authority for selection execution lane: `selection-continuity-execution-lane-plan.md`.
- Implementation authority for non-selection semantic lane: `non-selection-semantic-continuity-answer-lane-plan.md`.
- Shared invariants in this umbrella plan remain normative across both lanes.

Conflict rule:
- If lane plans diverge on lane-local mechanics, lane plans win for that lane.
- If any lane plan conflicts with higher-order routing safety governance, higher-order governance wins (see lane-level normative dependency blocks).

## Plan Authority and Supersession (Plan 17 vs Plan 19/20/21)

To prevent duplicate retry-loop implementations:

- `context-enrichment-retry-loop-plan.md` (Plan 17) remains background/reference.
- Implementation authority for continuity retry behavior is this layered set:
  - Plan 19 (shared contract + state + loop invariants),
  - Plan 20 (selection-lane execution behavior),
  - Plan 21 (non-selection semantic behavior).
- If Plan 17 text conflicts with Plan 19/20/21, Plan 19/20/21 win.
- Engineers must not implement a second parallel retry loop from Plan 17.

## Safety Invariants (must remain true)

1. Execute only from bounded candidates provided to the turn.
2. No source/scope jump without a safe winner in the same active scope.
3. If not a 100% safe deterministic winner, deterministic execution must not occur; follow governing ladder behavior (bounded LLM, then safe fallback, with Phase C gated auto-execute only when enabled and eligible by addendum policy). LLM output remains advisory unless governing execute gates approve.
4. Preserve existing stop/cancel/interrupt and question-intent escapes.
5. Preserve existing loop guards and ladder/addendum constraints.

## Shared Context Enrichment Loop Contract (MUST)

This contract applies to both lane plans. The app/orchestrator owns the loop; LLM does not self-loop.

Loop skeleton:

1. Build initial bounded `EvidencePack`.
2. Run deterministic gates.
3. If unresolved, call bounded LLM once.
4. If unresolved with `need_more_info`, attempt bounded enrichment from lane allowlist.
5. Recompute `evidenceFingerprint`.
6. Retry only when fingerprint changed and lane budget remains.
7. If fingerprint unchanged or budget exhausted, stop and ask grounded clarifier.

Hard invariants:

- Never re-call LLM with unchanged `evidenceFingerprint`.
- No unbounded retries.
- No free-form global search in selection lane.
- No execution path bypassing governing deterministic/Phase C policy.

Canonical `EvidenceCandidate` fields (shared minimum):

- `sourceType`
- `sourceId`
- `scope`
- `entityKeys`
- `timestamp`

Canonical fingerprint rule:

- `evidenceFingerprint = hash(canonicalFingerprintPayload)`
- Fingerprint inputs must be deterministic and stable for identical evidence sets.

Canonical fingerprint payload (MUST include all fields below):

1. `scopeBinding`
   - `activeScope`
   - concrete scope instance id (`widgetId` | `dashboardId` | `workspaceId` | `chatOptionSetId`)
2. `activeOptionSetId`
3. `candidateIds` (sorted)
4. `candidateSignatures` (sorted by id), where each entry includes:
   - `id`
   - `labelNormalized`
   - deterministic disambiguators used by the lane (for example: `path`, `type`, `owner`, `sublabel`)
5. `excerptHashes` for enriched evidence blocks included in the turn (sorted)
   - active widget excerpt hash
   - active entity/doc excerpt hash
   - last assistant explanation excerpt hash
6. `continuitySchemaVersion` (or equivalent context schema/version marker)

Canonicalization rules (MUST):

- Build payload as canonical JSON with stable key ordering.
- Sort all arrays before hashing.
- Omit volatile fields (timestamps, random ids, latency values).
- Use a single stable hash algorithm across both lanes.

Enrichment control models:

- Preferred default: orchestrator-driven enrichment (safer).
- Optional advanced: LLM-suggested `neededEvidenceTypes[]` only if validated by allowlist + budget + scope rules.

Canonical enrichment allowlist enum (single source of truth):

- `chat_active_options`
- `chat_recoverable_options`
- `active_widget_items`
- `active_dashboard_items`
- `active_workspace_items`
- `scope_disambiguation_hint`

Phase scope note (MUST):

- This canonical enum is current-phase selection/shared scope.
- Semantic-lane LLM hint enums are deferred to a future flag/plan; semantic lane remains orchestrator-driven in the current phase.

Request contract naming rule (MUST):

- Use `neededEvidenceTypes` as the canonical request field across all plans/implementations.
- Do not introduce parallel aliases (`neededContext`, etc.) in new implementations.

## Runtime Constants Table (Canonical)

All plans must reference these constants; do not duplicate numeric literals ad hoc.

| Constant | Value | Applies To |
|---|---:|---|
| `SELECTION_MAX_ENRICHMENT_STEPS` | 1 | Selection lane |
| `SELECTION_MAX_LLM_CALLS` | 2 (retry requires fingerprint change) | Selection lane |
| `SEMANTIC_MAX_ENRICHMENT_STEPS` | 2 (optional 3 behind flag) | Semantic lane |
| `SEMANTIC_MAX_LLM_CALLS_PER_STEP` | 1 | Semantic lane |
| `CHAT_HISTORY_MAX_TURNS` | 8 | Semantic lane |
| `CHAT_HISTORY_MAX_TOKENS` | 1200 | Semantic lane |
| `SNAPSHOT_EXCERPT_MAX_TOKENS` | 400 | Semantic lane |
| `BLENDED_CONTEXT_MAX_TOKENS` | 1800 | Semantic lane |
| `CONTINUITY_TTL_MAX_TURNS` | 3 | Semantic lane |
| `CONTINUITY_TTL_MAX_MINUTES` | 10 | Semantic lane |
| `RECENT_ACTION_TRACE_MAX_ENTRIES` | 5 | Shared continuity state |
| `NEEDED_EVIDENCE_TYPES_MAX` | 2 | Enrichment requests |

Notes:
- These constants are policy defaults; code-level names may differ but must map 1:1.
- Any change requires updating this table and both lane plans.

## Degradation Matrix (Canonical)

Use one fallback-reason enum semantics across both lanes.

Canonical fallback reasons:
- `timeout`
- `rate_limited`
- `transport_error`
- `abstain`
- `low_confidence`
- `no_new_evidence`
- `budget_exhausted`

| Condition | Selection Lane | Semantic Lane | Canonical Outcome |
|---|---|---|---|
| Timeout | Safe clarifier in active context | Packed grounded clarifier | `timeout` |
| 429 rate-limit | Safe clarifier in active context | Packed grounded clarifier | `rate_limited` |
| Transport/server error | Safe clarifier in active context | Packed grounded clarifier | `transport_error` |
| LLM abstain / no actionable result | Safe clarifier | Packed grounded clarifier | `abstain` |
| Low confidence | Safe clarifier | Packed grounded clarifier | `low_confidence` |
| Fingerprint unchanged | No retry, safe clarifier | No retry, packed clarifier | `no_new_evidence` |
| Enrichment budget exhausted | No retry, safe clarifier | No retry, packed clarifier | `budget_exhausted` |

## Implementation Steps

### Step 1 — Add bounded continuity state

Add sidecar continuity fields in chat navigation state (not in user-visible message schema):

- `lastResolvedAction`
- `recentActionTrace[]` (canonical schema below)
- `lastAcceptedChoiceId`
- `recentAcceptedChoiceIds` (small fixed window)
- `recentRejectedChoiceIds` (small fixed window)
- `activeOptionSetId`
- `activeScope`
- `pendingClarifierType`

Unified state contract rule (MUST):

- These fields form one shared `ContinuityState` sidecar consumed by both lanes:
  - `selection-continuity-execution-lane-plan.md`
  - `non-selection-semantic-continuity-answer-lane-plan.md`
- Lane plans may add lane-local read rules, but must not fork field meaning or schema.

Canonical `recentActionTrace[]` schema (single source of truth):

- max 5 entries, newest first
- each entry contains:
  - `type`
  - `targetRef`
  - `sourceScope`
  - `optionSetId`
  - `timestamp`
  - `outcome`

Canonical `pendingClarifierType` enum (single source of truth):

- `none`
- `selection_disambiguation`
- `scope_disambiguation`
- `missing_slot`
- `confirmation`
- `repair`

### Step 2 — Pass continuity to grounding LLM

Add a compact `continuityContext` block to grounding LLM requests.

Requirements:
- Structured and bounded only.
- No raw transcript dump.
- Candidate IDs remain the execution boundary.

### Step 3 — Deterministic continuity tie-break before clarifier

Before producing a clarifier, run a deterministic continuity resolver:

Resolve directly only when all are true:
- command-like request,
- unique exact/normalized label winner in current candidate set,
- same `activeOptionSetId`,
- same `activeScope`,
- no question-intent, no loop-guard conflict, no command-selection collision.

Else continue normal LLM/clarifier flow.

### Step 4 — Strict `need_more_info` veto

If grounding LLM returns `need_more_info`, apply the same deterministic continuity resolver once:
- if safe unique winner exists -> execute winner,
- otherwise -> keep clarifier.

This is a bounded veto, not a generic override. It does not disable governing Phase C behavior for other eligible LLM outcomes.

### Step 5 — Observability

Add decision telemetry reasons:
- `deterministic_continuity_resolve`
- `llm_select`
- `llm_need_more_info`
- `need_more_info_veto_applied`
- `need_more_info_veto_blocked_reason`
- `continuity_enrichment_retry_called`
- `continuity_enrichment_fingerprint_unchanged`
- `continuity_enrichment_budget_exhausted`

Loop-cycle telemetry fields (required):

- `loop_cycle_id` (stable per unresolved cycle)
- `fingerprint_before`
- `fingerprint_after`
- `retry_attempt_index`
- `retry_budget_remaining`

Include `activeOptionSetId`, `activeScope`, and winner/non-winner diagnostics.

### Step 6 — Tests (blockers)

Add/extend tests for:
1. `open the sample2 pls` resolves without repeated clarifier when unique safe winner exists.
2. True ambiguity still clarifies.
3. Stale continuity (`activeOptionSetId` changed) does not force old winner.
4. Question-intent and stop/cancel still escape correctly.
5. No execution outside bounded candidates.
6. Unchanged `evidenceFingerprint` blocks retry and falls back to grounded clarifier.
7. Enrichment budget exhausted blocks further retry and falls back deterministically.

### Step 7 — Rollout

- Flag: `NEXT_PUBLIC_GROUNDING_CONTINUITY_ENABLED` (default `false`).
- Dev/staging first, then incremental rollout after blocker tests and telemetry review.

Rollout guardrails (numeric rollback thresholds):

- Wrong-action rate increase > **0.5% absolute** vs baseline -> rollback flag.
- Clarifier rate increase > **10% relative** vs baseline for targeted cohorts -> rollback flag.
- P95 latency increase > **250ms** on routed turns -> rollback flag.
- Retry-with-unchanged-fingerprint event rate > **2%** of retries -> investigate and halt rollout progression.

## Acceptance Criteria

- Reduced repeated clarifier rate for command-like follow-ups with continuity context.
- No increase in wrong auto-execution.
- No violations of ladder/addendum safety invariants.

## Anti-Pattern Compliance Check

Reference: `codex/codex_needs_to_avoid/isolation-reactivity-anti-patterns.md`

Applicability: **Partially applicable** (contract-change hygiene).

Compliance in this plan:
- Backward-compatible additions only (sidecar continuity state + gated request payload).
- No hard dependency on new UI-only hooks.
- No coupled priority/behavior changes in same step.
- Feature-flagged rollout with blocker tests before broad enablement.
