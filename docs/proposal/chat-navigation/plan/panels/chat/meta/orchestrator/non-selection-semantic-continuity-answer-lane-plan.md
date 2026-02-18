# Non-Selection Semantic Continuity Answer Lane Plan

## Context

Non-selection follow-ups are semantic, not bounded-choice resolution. Examples:

- `Why did you open that?`
- `What happened last?`
- `Explain what summary155 means.`
- `Can you summarize what we just did?`

These require conversational continuity and structured state, not selection arbitration alone.

## Goal

Provide reliable semantic continuity answers without unsafe action execution.

## Non-Goals

- No direct action execution from this lane.
- No unbounded transcript injection.
- No replacement of selection arbitration rules.

## Normative Dependencies (MUST)

Precedence order for this lane:

1. `deterministic-llm-ladder-enforcement-addendum-plan.md` (execution safety boundaries)
2. `universal-selection-resolver-plan.md` (scope/source/latch boundaries and routing order)
3. `grounding-continuity-anti-reclarify-plan.md` (shared continuity umbrella invariants)
4. `selection-continuity-execution-lane-plan.md` (handoff counterpart contract)
5. This plan (lane-specific mechanics)

If this plan conflicts with (1) or (2), this plan must be updated before implementation.

## Core Principles

1. Semantic follow-ups use blended context (structured + recent language turns).
2. This lane is answer/explain mode only.
3. If missing critical slots, ask one grounded clarifier; do not enter repeated user-visible clarification loops. Bounded internal enrichment retries are allowed only within this plan's budgets and stop conditions.

## Intent Slot Schema (Normative)

Critical-slot checks are deterministic and intent-schema driven (not free-form).

- `explain_last_action`
  - required: `lastResolvedAction`
  - optional: `lastAssistantExplanation`
- `summarize_recent_activity`
  - required: at least one `recentActionTrace[]` entry
  - optional: `activeScope`
- `explain_entity_meaning`
  - required: `entityReferent`, `scopedEvidence`
  - optional: `activeScope`, `lastResolvedAction`
- `reflective_why_followup`
  - required: `lastResolvedAction`
  - optional: `recentActionTrace[]`, `lastAssistantExplanation`

If required slots are missing, run continuation eligibility checks before deciding to clarify.

## Lane Contract

### Entry Conditions

Input classified as semantic follow-up (non-selection, non-bounded-command), including explanatory or reflective questions about prior actions/conversation.

Hard exclusion guard (MUST):

- If active-option unresolved arbitration is pending in the current cycle, this lane must not enter.
- In that case, control remains in governing selection ladder until resolved or safely clarified.

### Context Assembly

Bounded blended context:

- Structured continuity:
  - `lastResolvedAction`
  - `recentActionTrace[]` (see canonical schema in `grounding-continuity-anti-reclarify-plan.md`)
  - `lastAssistantExplanation`
  - `activeScope`
  - `activeOptionSetId` (if relevant)
  - `pendingClarifierType` (see canonical enum in `grounding-continuity-anti-reclarify-plan.md`)
  - key referenced entities
- Recent language history:
  - sliding window of recent turns (hard cap: 8 turns max, newest first)
- Optional scoped snapshot excerpt:
  - only if directly relevant to the question (hard cap: 400 tokens max)

Hard caps (normative):

- Chat history budget: 8 turns maximum and 1200 tokens maximum.
- Structured continuity fields: 12 keys maximum.
- Action trace budget: follow canonical `recentActionTrace[]` cap from `grounding-continuity-anti-reclarify-plan.md` (max 5 entries).
- Snapshot excerpt budget: 400 tokens maximum.
- Total blended prompt context budget (excluding system prompt): 1800 tokens maximum.

### Output

- Natural-language answer/explanation, or
- One grounded clarifying question if a critical slot is missing.

No action execution in this lane.

## Decision Flow

1. Classify input as semantic follow-up.
2. Assemble bounded blended context.
3. If `NEXT_PUBLIC_SEMANTIC_CONTINUITY_ANSWER_LANE_ENABLED` is OFF, return bounded safe clarifier behavior in the same semantic context and stop (no unrelated downstream disambiguation escape).
4. Call LLM in answer mode (not picker mode).
5. If response is under-specified due to missing critical slot:
   - ask one combined clarifier,
   - do not recurse into repeated context-request loops.
6. If user turns command-like/selection-like, hand back to execution lane.
7. This lane must not create or duplicate selection unresolved arbitration hooks; it only consumes post-resolution continuity state.

### Context Enrichment Loop (Semantic Lane, MUST)

Control model:

- Default mode is orchestrator-driven enrichment (preferred).
- Current phase policy: semantic-lane LLM `request_context` / `neededEvidenceTypes[]` hints are disabled.
- Semantic enrichment is orchestrator-driven only in this phase.
- Semantic hint-driven enrichment is deferred to a future flag/plan after dedicated enum expansion and blocker coverage.
- Retry is allowed only when `evidenceFingerprint` changes.

Budgets:

- Use canonical constants from Plan 19:
  - `SEMANTIC_MAX_ENRICHMENT_STEPS`
  - `SEMANTIC_MAX_LLM_CALLS_PER_STEP`
- Max LLM calls: one per enrichment step, fingerprint-gated

Allowlisted enrichment types:

- Pull scoped referent excerpt (active doc/entity excerpt, active widget excerpt, or lastResolvedAction explanation snippet).
- Pull bounded recent chat window (within lane hard caps).
- Pull bounded relevant retrieval chunks for semantic asks (e.g., `what does X mean`, `summarize`) in same scope.

Stop conditions:

- `evidenceFingerprint` unchanged after enrichment.
- Enrichment budget exhausted.
- Critical slots still unresolved after bounded enrichment.

On stop: ask one packed grounded clarifier and end loop (no repeated clarifier loop).

### Critical Slot Policy (Deterministic First)

Missing-slot clarifier is allowed only when at least one required slot is absent after bounded context assembly.

Scoped evidence candidate contract (MUST):

`scopedEvidenceCandidate` object fields:

- `sourceType`: `active_scoped_entity` | `active_widget_snapshot` | `last_assistant_explanation`
- `sourceId`: stable source identifier
- `scope`: normalized scope key
- `excerptId`: stable excerpt identifier (or deterministic hash if id absent)
- `excerptHash`: normalized content hash
- `entityKeys`: normalized entity key list
- `optionSetId`: nullable option-set id
- `timestamp`: source timestamp (epoch ms)

Deterministic candidate builders (MUST):

1. `buildFromActiveScopedEntity(...)`
   - emits candidates only from current `activeScope`.
2. `buildFromActiveWidgetSnapshot(...)`
   - emits candidates only from focused widget snapshot in same scope.
3. `buildFromLastAssistantExplanation(...)`
   - emits candidates from most recent scoped assistant explanation in same scope.

Builder output contract:

- Input: continuity state + scoped snapshots + recent assistant explanation + `activeScope`.
- Output: flat `scopedEvidenceCandidate[]` before filtering.
- Builders must not emit cross-scope candidates.

Canonical `referentRef` schema (MUST):

- `kind`: `choice` | `entity` | `widget_item` | `doc_selection` | `action_target`
- `id`: stable referent identifier
- `scope`: normalized scope key
- `optionSetId`: nullable option-set id

Referent binding contract:

- Referent binders must emit `referentRef[]` using this exact shape before uniqueness checks.
- Cross-scope referents are ineligible and must be filtered before counting uniqueness.

Scoped evidence uniqueness predicate (MUST):

- `unique scoped evidence` is true only when referent binding yields exactly one `referentRef` in `activeScope` and exactly one eligible `scopedEvidence` candidate after normalization/TTL/conflict filtering.
- Eligible evidence sources are bounded to:
  - active scoped entity excerpt,
  - active widget snapshot excerpt,
  - last assistant scoped explanation excerpt.
- If `referentRef` count != 1 or `scopedEvidence` count != 1, treat as non-unique and ask one clarifier.

Deterministic filtering contract (MUST):

- `normalizeCandidates(candidates)`:
  - normalize `entityKeys`/labels; de-dup by (`scope`,`excerptId` or `excerptHash`).
- `applyTTL(candidates, now)`:
  - keep candidates within semantic TTL window (same TTL policy used by continuation eligibility).
- `resolveConflicts(candidates)`:
  - if candidates from different `sourceType` disagree on referent/entity and no strict priority winner exists, mark non-unique.
  - strict source priority for tie-break: `active_scoped_entity` > `active_widget_snapshot` > `last_assistant_explanation`.
- `selectEligibleScopedEvidence(candidates, referentRef)`:
  - return candidates matching bound referent in `activeScope` after normalization/TTL/conflict steps.

### Continuation Eligibility Checklist (Normative)

Borrow from continuity state only if all are true:

1. Current turn is missing at least one required slot from the intent schema.
2. User text has a deterministic referent marker:
   - pronoun/deictic: `it`, `that`, `this`, `those`, `them`, `there`
   - continuation marker: `continue`, `go on`, `more`, `again`, `next`
   - implicit follow-up pattern: `why`, `how`, `what about`
3. Single best continuity source exists in same scope:
   - same `activeScope`
   - recency TTL: within last 3 turns and within 10 minutes
4. User did not provide a conflicting explicit target in current turn.

If any checklist condition fails, do not borrow; ask one grounded clarifier.

### Referential Binding Priority (Normative)

When multiple potential referents exist, resolve in this strict order:

1. Explicit target in current user turn (highest authority).
2. Scoped active entity in current scope (`activeScope`).
3. `lastResolvedAction` referent (if within TTL and no conflict).
4. `recentActionTrace[]` most recent matching referent (if within TTL and no conflict).
5. If no unique referent remains, ask one grounded clarifier.

Conflict rule:

- If rank-1 (explicit current-turn target) conflicts with lower-rank continuity referents, rank-1 wins.
- Do not merge referents across scopes to fabricate a winner.

Deterministic rules:

- `why did you do that` with `lastResolvedAction` present -> answer directly (no clarifier).
- `what happened last` with non-empty `recentActionTrace[]` -> summarize from trace (no clarifier).
- `what does <entity> mean` with exactly one scoped source excerpt -> answer directly (no clarifier).
- `what does <entity> mean` with multiple equally plausible scoped entities and no unique referent -> one combined clarifier.
- If structured context has no actionable referent and recent turns are insufficient -> one combined clarifier, then stop (no repeated loop).

Packed clarifier rule (MUST):

- If 2+ required slots are missing, ask one combined clarifier that collects all missing slots in one turn.
- Do not ask sequential slot-by-slot clarifiers in this lane.

### Lane Handoff Boundary (Normative)

Question-intent precedence over scope-cue (MUST):

- Scope-cued question-intent remains in semantic lane.
- Scope cue constrains referent binding/evidence selection; it does not force selection-lane routing by itself.

Use selection execution lane when any of these are true:

- Input is command-like and references a bounded candidate target (`open`, `go to`, `show`, ordinal, explicit option label).
- Input contains explicit scope-cue targeting a bounded set (`from chat`, `from recent`, `from links panel d`, etc.) and is not question-intent.
- Input is mixed intent with executable bounded target plus explanation clause; execute/clarify through selection lane first, then answer follow-up.

Use semantic answer lane when all are true:

- Input is primarily explanatory/reflective (`why`, `what happened`, `what did you do`, `summarize what we did`).
- No unique executable bounded target is present.

Ambiguous mixed examples (must be covered in tests):

- `open sample2 and explain why` -> selection lane first, then semantic answer.
- `why did you open sample2` -> semantic lane.
- `what does summary155 mean` (no bounded action request) -> semantic lane.

## Safety Invariants

1. This lane cannot execute actions.
2. Structured context and chat window must be size-capped.
3. Scope boundaries must be preserved (no cross-scope claims without evidence).
4. Hard interrupts (stop/cancel/start-over) always preempt.
5. Fallback to explicit uncertainty when context is insufficient.
6. Pending active-option unresolved arbitration preempts semantic lane entry.

## Telemetry

- `semantic_followup_answered`
- `semantic_followup_missing_slot`
- `semantic_followup_single_clarifier_asked`
- `semantic_followup_handoff_to_selection_lane`
- `semantic_followup_context_insufficient`
- `continuity_slot_filled`
- `continuity_blocked_conflict`
- `continuity_ttl_expired`
- `continuity_no_referent_marker`
- `continuity_non_unique_scoped_evidence`
- `semantic_enrichment_retry_called`
- `semantic_enrichment_fingerprint_unchanged`
- `semantic_enrichment_budget_exhausted`

Include window size, structured-field usage, and slot-missing reasons.
Include loop-cycle fields from Plan 19 (`loop_cycle_id`, `fingerprint_before`, `fingerprint_after`, `retry_attempt_index`, `retry_budget_remaining`).

## Test Plan (Blockers)

1. `Why did you open that?` with `lastResolvedAction` present answers directly (no clarifier).
2. `What happened last?` with non-empty `recentActionTrace[]` summarizes recent actions (no clarifier).
3. `What happened last?` with empty trace and insufficient context asks one combined clarifier only.
4. `What does <entity> mean?` with exactly one scoped excerpt answers directly (no clarifier).
5. `What does <entity> mean?` with multiple plausible referents asks one combined clarifier.
6. Semantic lane does not execute actions.
7. Command-like turn after semantic answer hands off to selection lane correctly.
8. Missing 2+ required slots triggers one packed clarifier (no sequential clarifier loop).
9. Continuity borrowing is blocked when TTL expires or explicit target conflict is present.
10. Pending active-option unresolved arbitration blocks semantic-lane entry and keeps control in selection ladder.
11. Referential binding uses strict priority order (explicit target > scoped active entity > lastResolvedAction > recentActionTrace); ambiguous cross-rank tie asks one clarifier.
12. Scope-cued question-intent (e.g., `from links panel d, what does summary155 mean?`) stays in semantic lane and uses scope-constrained binding.
13. `unique scoped evidence` requires exactly one referent and one scoped evidence candidate after filtering; otherwise one clarifier.
14. Cross-source conflict with no strict-priority winner is treated as non-unique scoped evidence and asks one clarifier.
15. Cross-scope evidence candidates are excluded from eligibility and cannot be merged to force uniqueness.
16. Fingerprint unchanged after semantic enrichment -> no further retry; one packed grounded clarifier.
17. Semantic enrichment budget exhausted with missing critical slots -> one packed grounded clarifier and stop.
18. Mixed intent (`open sample2 and explain why`) resolves via selection lane first, then semantic answer; enrichment retry must not consume/drop the explanation clause.

## Rollout

- Flag: `NEXT_PUBLIC_SEMANTIC_CONTINUITY_ANSWER_LANE_ENABLED` (default `false`)
- Dev -> staging -> gradual rollout after telemetry verification.
- Apply numeric rollback thresholds from Plan 19 rollout guardrails.

## Anti-Pattern Compliance Check

Reference: `codex/codex_needs_to_avoid/isolation-reactivity-anti-patterns.md`

Applicability: **Partially applicable** (new context contract and consumer drift risk).

Compliance:

- Backward-compatible context fields.
- Feature-flagged launch.
- No new UI-only hard coupling required for correctness.
- Provider/router logic remains the source of truth.
