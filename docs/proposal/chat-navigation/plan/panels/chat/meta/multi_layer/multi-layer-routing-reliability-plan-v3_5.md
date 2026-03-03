# Multi-Layer Routing Reliability Plan (v3.5)

**Status:** Ready for Phase 1 (observe-only)
**Owner:** Chat Navigation
**Last updated:** 2026-03-03
**Scope:** Replace brittle rule-heavy matching with a retrieval-first, validator-gated, bounded-LLM architecture while preserving strict execution safety.

Implementation details reference:
- `docs/proposal/chat-navigation/plan/panels/chat/meta/multi_layer/multi-layer-routing-reliability-implementation-annex-v3_5.md`
- All build-start prerequisites in Annex Section 13 are closed (2026-03-02). All migrations validated.

## 1) Why this plan exists

Current behavior shows two recurring reliability issues:
- rule-driven deterministic logic is rigid and expensive to maintain in production
- non-deterministic failures happen when stale context/latch/scope leaks into candidate selection

We need a design that:
- keeps the fastest/safest exact path
- reduces dependence on growing hardcoded rules
- uses stored query/resolution history with state metadata
- keeps non-exact execution safe and auditable
- keeps intent detection/decomposition LLM-driven (proposal-only), with system validation as final authority

## 2) Non-negotiable policy (kept)

1. `not exact => never deterministic execute`  
2. `non-exact => bounded LLM => safe clarifier`  
3. deterministic execution is allowed only on provably unique validated targets  
4. explicit scope cues constrain candidate domain but do not authorize execution by themselves  

## 3) Core architecture

**LLM = bounded selector, not global executor.**  
**System = candidate builder + safety validator + executor.**

System/LLM responsibility split:
- System owns normalization, snapshotting, storage, embeddings, retrieval, validator gates, and commit-point execution.
- LLM owns bounded selection and optional multi-intent decomposition proposal (never direct execution authority).

Routing lanes:

1. **Lane A - Deterministic Fast Lane (tiny)**
   - raw strict exact label/id checks
   - strict whole-input ordinal only (no embedded extraction)
   - execute only when unique and validated

2. **Lane B - Memory Retrieval Lane (main)**
   - retrieve prior successful resolutions using query + context metadata
   - **B1:** exact memory lookup (deterministic candidate source)
   - **B2:** semantic memory retrieval (non-deterministic candidate source; candidates only)
   - retrieval produces candidates, never direct execute from B2

3. **Lane C - Validation Gate (mandatory)**
   - validate retrieved/derived candidates against current UI snapshot/state
   - reject on drift, missing target, permission mismatch, schema mismatch, ambiguity

4. **Lane D - Bounded LLM Selection**
   - LLM sees only validated candidates
   - output contract: `select(choiceId)` or `need_more_info`

5. **Lane E - Safe Clarifier**
   - if unresolved/failure/low confidence, ask scoped clarifier
   - UX preference: emit clickable option-based clarifiers first; free-text clarifiers are fallback only when options cannot be safely enumerated

## 4) Deterministic scope (what remains deterministic)

Deterministic execute is limited to:
- strict raw exact label/id/sub-label match
- strict whole-input ordinal/badge (anchored only)
- exact memory key + exact context compatibility + single validated target

Deterministic execute is forbidden for:
- fuzzy match, token subset, partial contains, embedded ordinals in sentences
- canonicalization-based execution
- semantic vector hit without validator pass
- any non-exact candidate source, even if unique after validation (must go through bounded LLM)

## 5) Data model (authoritative + serving)

## 5.0 What to store (authoritative log + serving index)

### 5.0.1 Store both raw and normalized query text
Normalization is format-only (no typo correction):
- trim leading/trailing whitespace
- collapse multiple internal spaces
- lowercase (or Unicode casefold)

Store:
- `raw_query_text`
- `normalized_query_text`
- `normalization_version`
- `query_fingerprint`

### 5.0.2 Context snapshot summary (for drift safety)
For widget-heavy routing, store a compact context summary:
- active widget id, widget type, widget version
- open widget/panel ids
- visible item stable ids (not positions only)
- selection/focus/edit-mode flags
- permission flags that affect visibility/actions

Compute a stable `context_fingerprint` from the canonicalized snapshot summary.

## 5.1 Durable interaction log
Store per turn:
- `raw_query_text`
- `normalized_query_text`
- `normalization_version`
- `query_fingerprint`
- `context_snapshot_json`
- `context_fingerprint`
- `routing_lane`
- `candidate_ids_considered`
- `chosen_id`
- `decision_source` (`deterministic`, `memory_exact`, `memory_semantic`, `llm`, `clarifier`)
- `risk_tier`
- `provenance`
- `result_status`
- `embedding_model_version`
- `effective_thresholds_version`
- `effective_margin_version`
- optional resolved values: `effective_confidence_threshold`, `effective_near_tie_margin`

Privacy/redaction rule before persistence:
- redact or hash sensitive fields in `raw_query_text` and `context_snapshot_json` where applicable before writing durable logs
- store only minimum necessary identifiers for routing/audit needs

## 5.2 Resolution memory index (serving layer)
Store compact reusable entries:
- `tenant_id`, `user_id`, `scope_source`
- `query_fingerprint`, optional `semantic_embedding`
- `context_fingerprint`
- `intent_id`, `slots_json`
- `target_ids[]`
- `schema_version`, `tool_version`
- `permission_signature`
- `risk_tier`
- `success_count`, `last_success_at`, `ttl_expires_at`

Serving constraints:
- tenant/user namespace isolation is mandatory for lookup and writeback
- serving index stores minimal reusable payload, while durable log remains the audit source of truth
- cross-user retrieval is disabled by default (including same tenant); enable only for explicitly flagged global-safe help/FAQ intents

### 5.2.1 Exact-memory key stability (v2 refinement)
To avoid false misses from per-turn drift, exact-memory keying must use a stable context profile:
- include only structurally stable compatibility fields in the memory key
- exclude volatile turn-counters/transient fields (for example `message_count`)
- keep full context snapshot in durable logs for observability/audit
- when key profile changes, bump `tool_version` (for example `v1` -> `v2`) so old/new keys are isolated

## 5.3 Optional plan memory
For multi-intent queries:
- `plan_json`
- `plan_summary`
- per-step candidate/validation outcomes

Optional separate store (if product needs response-text reuse):
- full assistant response text should be stored in a separate optional store with its own retention/privacy policy
- this plan's serving index is resolution-oriented (intent/slots/targets/context), not response-text cache by default

## 5.4 Session embedding cache (performance)
Cache commonly repeated query embeddings for the active session:
- key: `tenant_id + user_id + session_id + normalized_query_text + embedding_model_version + normalization_version`
- value: `query_embedding_vector`, `timestamp`, `hit_count`
- scope: in-memory per active session, optional Redis layer for short-TTL cross-request reuse
- ttl: 15-60 minutes (or session lifetime)

Rules:
- cache hit reuses embedding vector (skip embedding call)
- model or normalization version change invalidates cache key
- cache is optimization only; validator and safety behavior unchanged

Flow:
1. normalize query text
2. check session embedding cache
3. on hit, reuse vector (no embedding API call)
4. on miss, embed once, store in cache, continue retrieval

## 5.5 Embedding policy
Embed at minimum:
- `normalized_query_text`

Optionally embed:
- `plan_summary`
- `resolved_intent + slots` summary for resolution-memory retrieval

Long-query quality safeguards:
- chunked embeddings (whole-query + step-level chunks)
- lexical + vector hybrid retrieval for IDs/labels in noisy text

Intent-class separation safeguards:
- store intent-class labels with embeddings (`action_intent`, `info_intent`, etc.)
- enforce retrieval-time filtering by intent class
- do not mix action and information intents in an unlabelled/shared candidate pool

## 6) Runtime decision flow

1. Build live turn snapshot and `context_fingerprint`.
2. Run Lane A deterministic fast lane.
3. If unresolved, query Lane B:
   - B1 exact memory lookup by `(tenant, query_fingerprint, compatible context, versions)` where context compatibility follows Section 7 intent-class rules (action intents: exact fingerprint/strict profile; info intents: relaxed compatibility)
   - compatible context for memory keying must use the stable profile from Section 5.2.1 (not volatile per-turn fields)
   - B2 semantic retrieval fallback (topK, filtered by scope/risk/tool)
4. Run Lane C validator on all candidate actions.
5. Execute only when the remaining validated candidate is from an exact source (`Lane A` strict exact, or exact-memory key match in `Lane B`).
6. If the remaining candidate is from a non-exact source (for example semantic retrieval), call Lane D bounded LLM with validated candidates only.
7. Before any execution commit, run commit-time freshness revalidation against the latest snapshot/context fingerprint (TOCTOU guard).
8. If freshness revalidation passes and LLM (when used) returns valid `choiceId`, execute through the idempotent executor (at-most-once for mutation intents).
9. Else Lane E safe clarifier.
10. Log full trace and update memory entries.

Action replay guard:
- mutation intents require verified semantic reuse through Lane D bounded-LLM auto-selection (including single-candidate cases), or explicit user confirmation for high-risk actions
- semantic retrieval itself never executes directly

## 6.1 Multi-intent decomposition trigger (bounded)
Use decomposition only when non-exact and one of:
- query is long
- query contains conjunction flow (`and`, `then`, `also`)
- query combines ask + do intents

Decomposition output is proposal-only and must pass per-step validator checks before execution.

## 7) Validation gate (hard stop checks)

Every candidate action must pass:
- target exists in current snapshot
- candidate belongs to active declared scope (chat/widget/dashboard/workspace)
- context fingerprint compatibility threshold
- permission/tool/schema compatibility
- no unresolved ambiguity
- risk policy compliance (confirmation for high risk)
- idempotency requirements for mutation intents (idempotency key present and not previously committed)

Commit-time freshness revalidation (TOCTOU):
- required immediately before execution commit
- re-check target existence, scope membership, permission/tool/schema compatibility, and context fingerprint compatibility against latest state
- if drift is detected between pre-validation and commit time, apply deterministic fail policy:
  - action intents: cancel execute and route directly to safe clarifier (no rerun)
  - info intents: rebuild snapshot and rerun Lane C once using the existing validated candidate set (no Lane B re-retrieval in this TOCTOU rerun); if still failing, route to safe clarifier
  - if TOCTOU rerun invalidates all existing candidates, do not re-retrieve; route directly to safe clarifier

Context compatibility by intent class:
- action intents: require exact `context_fingerprint` match, or an explicitly defined strict-compatibility profile
- info intents (read/summary/question): allow relaxed compatibility when safety checks still pass (for example same widget type plus target id exists)
- if compatibility checks fail for the intent class, do not execute; continue with bounded LLM or safe clarifier

Strict-compatibility profile examples (canonical):
- Profile A (`widget_exact_visible_set`): same active widget id and same visible item-set hash
- Profile B (`widget_type_selected_item`): same widget type and same selected item stable id
- Profile C (`panel_scope_action`): same panel/widget id set and same permission signature for action-capable operations


Ambiguity check definition:
- treat as ambiguous when multiple validated candidates remain with the same intent + slot-shape and no deterministic discriminator
- treat as ambiguous when score-based candidates have near-tie margin (`top1_score - top2_score < configured margin`)
- ambiguous outcome must not execute directly; route to Lane D disambiguation, except near-tie margin cases which must route to safe clarifier

Any failure means:
- no execute
- bounded LLM (if candidates remain) or safe clarifier

Idempotency contract:
- required for mutation intents
- key format: `interaction_id + plan_step_id + chosen_id + tool_action`
- executor behavior: at-most-once commit for each key within ttl window
- duplicate key behavior: return prior committed result (no re-execution)
- execution status tracking: `pending | committed | failed` with timestamps

## 7.1 Verified semantic reuse thresholds (operational)

Semantic candidate reuse remains non-exact and must go through Lane D. The table below defines verifier behavior:

Score source contract (must be explicit and consistent):
- `primary_similarity_score` = cosine similarity between current `normalized_query_text` embedding and candidate retrieval embedding in the same intent-class index
- optional support scores (for example `plan_summary_similarity`, `intent_slots_similarity`) may be logged for diagnostics/ranking only
- threshold tiers in this section (`very_high`, `high`, `medium`, `low`) apply to `primary_similarity_score` only
- all candidates in one decision pass must use the same score type/model/version for fair comparison
- long-query chunking consistency: when chunked query embeddings are used, compute `primary_similarity_score` from chunk scores via configured reducer (default `max(chunk_score)`; optional weighted-max), and apply the same tier thresholds to that reduced score

| Similarity tier | Score band (example) | Lane D low-risk behavior | Medium/high-risk behavior | Verifier requirement |
|---|---:|---|---|---|
| `very_high` | `>= 0.96` | Lane D may auto-select if validator passes and exactly one candidate remains | confirmation required before execution | strict context compatibility + permission/tool/schema pass |
| `high` | `0.92 - 0.959` | Lane D select allowed; if `need_more_info`, safe clarifier | confirmation required | strict context compatibility + permission/tool/schema pass |
| `medium` | `0.85 - 0.919` | no auto-select; Lane D expected to disambiguate or return `need_more_info` | confirmation required | strict validator pass plus ambiguity check |
| `low` | `< 0.85` | no semantic reuse; move to clarifier path | no execution | treat as non-reusable semantic hint only |

Notes:
- thresholds are configuration values and should be tuned from production telemetry.
- thresholds are embedding-model/version dependent and must be calibrated with a small offline labeled set (`should_reuse` / `should_not_reuse`) for each model/version.
- `very_high`/`high` never bypass Lane D for non-exact inputs.
- any verifier failure downgrades to bounded LLM disambiguation or safe clarifier (no execute).
- near-tie guard: if `(top1_score - top2_score) < 0.02` (configurable margin), do not auto-select; force clarifier path
- near-tie margin source: configuration service (versioned), with global default, optional per-intent override, and optional per-tenant override under bounded guardrails; log effective margin used per decision
- per-tenant overrides must be clamped to approved `[min,max]` safety bands, require explicit tenant allowlist, and emit audit logs for create/update/delete events
- reject per-tenant overrides that reduce safety posture (for example margin below minimum guardrail or confidence threshold below minimum guardrail)
- log effective clamp bounds and resolved override values per decision for audit/debug

## 8) Bounded LLM contract

LLM input:
- current user text
- validated candidate list only (`id`, `label`, `type`, optional action hint)
- optional clarifier reply context

LLM output:
```json
{ "decision": "select" | "need_more_info", "choiceId": "..." | null, "confidence": 0.0 }
```

System-side enforcement:
- reject unknown `choiceId`
- reject low confidence below threshold
- never accept free-form action generation
- single-candidate behavior (explicit): for non-exact inputs with one validated candidate, remain in Lane D (do not route to Lane A deterministic)
  - default mode: still call bounded LLM; expected output is `select(choiceId)` unless a concrete required slot is missing
  - optional optimization mode: allow a Lane D internal no-model shortcut that emits a synthetic `select(choiceId)` only when validator checks pass, no required slot is missing, and TOCTOU + idempotency checks pass at commit
  - both modes must keep Lane D provenance and safe-clarifier fallback behavior on uncertainty/failure

Confidence threshold policy:
- default Lane D confidence threshold: `0.75`
- per-intent overrides are allowed (for example stricter thresholds for mutation/high-risk intents)
- if confidence is below the effective threshold, do not execute; route to safe clarifier
- no-model shortcut interaction: confidence thresholds do not apply to synthetic `select(choiceId)`; shortcut is allowed only when validator + commit-time freshness revalidation (TOCTOU) + idempotency checks all pass, otherwise fallback to normal Lane D model call

Bounded candidate caps (hard limits):
- B2 semantic retrieval `topK`: 10-20 (default 15)
- maximum validated candidates passed to Lane D: 8
- if validated candidates exceed cap, rank + trim deterministically before LLM call (scope compatibility, exact-id/label boosts, recency, prior-success signal)

Deterministic rank+trim specification (canonical order):
1. scope match priority
2. exact id/label boost
3. context compatibility score
4. recency (`last_success_at` descending)
5. prior success count (`success_count` descending)
6. risk tier preference (lower risk first when otherwise equivalent)

Tie-break rule:
- if all ranking signals are equal, sort by stable `candidate_id` ascending
- invariant: same input + same snapshot must produce the same trimmed candidate set/order

## 9) Multi-intent handling

Use LLM decomposition as a **proposal** for non-exact multi-intent input.
System executes per-step only after validator pass.

Structured plan contract example:
```json
{
  "plan_version": "1",
  "intents": [
    { "intent_id": "open_item", "slots": { "target_id": "summary155" }, "risk": "low", "requires_confirmation": false },
    { "intent_id": "move_item", "slots": { "target_id": "summary155", "position": "top" }, "risk": "high", "requires_confirmation": true }
  ],
  "clarifying_questions": []
}
```

Replay rules:
- replay full plan only if all steps remain valid in current context
- otherwise execute safe subset and clarify remaining steps

User-facing behavior rules:
- if any step is `high` risk, show a plan preview before execution (for example: "I can do A now, and B needs confirmation. Proceed?")
- plan preview must list which steps are low-risk auto-eligible vs confirmation-gated

Partial execution policy (predictable by risk tier):
- low-risk validated steps may auto-execute
- medium/high-risk steps always require explicit confirmation
- unresolved high-risk steps block only those steps, not low-risk steps, unless policy mode is set to `no_partial_without_consent`

Policy mode switch:
- default: `risk_tier_partial_allowed` (execute validated low-risk subset; confirm higher-risk remainder)
- optional strict mode: `no_partial_without_consent` (no subset execution until user confirms the full/partial plan)

## 10) Clarifier and resolution memory

Store compact resolution memory for repeated ambiguities:
- trigger fingerprint (`query + ambiguity class + context shape`)
- resolved target and scope
- validation conditions
- optional short plan signature (`intent_ids + slot-shape`) for fast compatibility checks

On future similar turns:
- apply only if conditions still hold
- else re-clarify (never force stale replay)

Note:
- storing literal clarifier question text is optional; trigger/intent/condition memory is authoritative for replay safety

## 10.1 Clarifier-reply lock (must-have)

When Lane E emits a clarifier, store pending clarifier state:
- `pendingClarifierType`
- bounded `candidate_ids` (or option payload ids)
- `created_turn`
- optional `clarifier_message_id`

Rules:
- one-turn ttl by default (`current_turn - created_turn <= 1`)
- next user turn must route to clarifier resolver before any other parsing path (including ordinal binding and free-form routing)
- if user reply is affirmation-only (for example `yes`, `ok`) or does not map to an allowed confirmation payload, remain in clarifier-only path
- clarifier-only path never default-executes
- on ttl expiry, context drift, or explicit unrelated new command, clear pending clarifier and follow normal routing
- clear pending clarifier on successful resolution/execute
- clear pending clarifier when user explicitly selects an option from the clarifier option set
- clear pending clarifier when user reply is non-confirming and routing opens a new clarifier context

Clickable clarifier contract:
- Lane E option payloads must include stable payload IDs (labels are display-only)
- clarifier resolver accepts only payload-ID selections, or ordinals that map to IDs in the active option set
- free-text label matching is fallback-only and must resolve to exactly one active payload ID; otherwise re-clarify
- canonical option schema: `{ payload_id, label, scope_hint?, candidate_id? }`
- clarifier option cap: maximum 8 options per clarifier; when candidate set exceeds cap, use narrowing-question strategy instead of enumerating all options

Narrowing-question strategy (deterministic reduction order):
- canonical prompt examples: "Which scope?", "Which item type?", "Which panel?"
- reduction order: scope first, then item type, then recency
- each narrowing response must produce a strictly smaller candidate set or escalate to safe clarifier

Unrelated new command detection rule:
- if user message is command-shaped (imperative/start-verb pattern) or matches known command grammar, and does not match any active clarifier option payload, treat it as a new command
- on new-command detection, clear pending clarifier and route through normal command handling

Command-shaped definition (canonical):
- starts with a known executable command verb (for example `open`, `move`, `delete`, `rename`) in imperative form, or
- matches a maintained command-grammar pattern for executable intents

Grammar ownership rule:
- keep command grammar patterns and affirmation vocabulary in a single shared source-of-truth module used by command detection, clarifier-reply parsing, and affirmation stripping
- grammar/vocabulary updates require versioned change tracking and regression tests to prevent list drift across modules
- when grammar/vocabulary version changes, run a golden parsing suite covering command detection, clarifier-reply resolution, and affirmation parsing before release

## 11) Performance strategy

- keep deterministic fast lane in-process for obvious exacts
- use short-lived exact cache for memory index hits
- run semantic retrieval only when exact memory and deterministic both fail
- optionally use chunked/hybrid embeddings for long queries (query-level + step-level chunks)
- combine lexical filters (explicit ids/labels) with vector similarity for precision
- attach retrieval latency, validator latency, and LLM latency telemetry

## 12) Rollout plan

1. **Observe-only**
   - write logs/memory records, no behavioral change
2. **Exact-memory assist**
   - use exact memory to propose candidates, validator still required
3. **Semantic assist**
   - add semantic candidate retrieval (no auto execute without gate)
4. **Bounded LLM optimize**
   - LLM selector over validator-approved candidates
5. **Resolution memory reuse**
   - controlled replay for repeated ambiguities
6. **Verified semantic reuse**
   - allow bounded-LLM auto-selection for low-risk validated actions; high-risk remains confirmation-gated
   - semantic retrieval never directly executes, even when verified

Feature flag each stage and keep kill switches.

## 13) Testing plan

### 13.1 Safety tests
- non-exact never deterministic execute
- semantic hit without validator pass never executes
- stale context fingerprint blocks replay
- commit-time drift after pre-validation blocks execute (TOCTOU)
- near-tie guard (`top1 - top2 < margin`) blocks auto-select and routes to clarifier
- Lane D no-model shortcut keeps Lane D provenance and never bypasses validator/idempotency checks

### 13.2 Reliability tests
- repeated phrasing variants resolve to same target via memory + validation
- exact same command across consecutive turns with only message-count drift still hits B1 exact memory (stable key profile)
- panel switch then unscoped query never uses stale widget candidates
- clarifier-reply sentences never misfire ordinal extraction

### 13.3 Contract tests
- LLM invalid `choiceId` -> safe clarifier
- low confidence -> safe clarifier
- high-risk intents always require confirmation

### 13.4 Regression tests
- existing strict exact command behavior remains fast
- known deterministic paths keep provenance labels and expected latency bounds

### 13.5 Multi-intent and replay tests
- long query decomposition yields ordered intents
- context drift blocks stale multi-intent replay
- safe subset execution works when only part of a stored plan remains valid
- similar wording with same plan summary retrieves canonical memory candidate

## 14) Observability requirements

Required logs per turn:
- lane entered/exited
- candidate counts by lane
- validator pass/fail reasons
- chosen path provenance
- drift reason codes
- idempotency key, dedupe hit/miss, and duplicate-suppression reason (for mutation intents)
- commit-time revalidation result (`pass`/`fail`) and fail reason code
- effective config/model versions (`embedding_model_version`, `effective_thresholds_version`, `effective_margin_version`)

Required dashboards:
- deterministic success rate
- memory hit rate (exact vs semantic)
- validator rejection rate
- LLM `need_more_info` rate
- clarifier loop rate
- duplicate execution suppression rate (mutation intents)
- TOCTOU failure rate by intent class (action vs info)
- clickable-clarifier adoption rate
- free-text clarifier fallback rate

Retention and dedupe controls:
- immutable durable log for audit
- serving index dedupe by exact fingerprints and semantic clustering
- configurable ttl by layer (exact cache, semantic serving index, resolution memory, raw log)
- deletion/retention propagation is mandatory across durable log controls, serving index/vector store, and embedding/session caches (including replicas), with auditable deletion traces

## 15) File-level implementation map (current codebase)

Primary integration points:
- `lib/chat/routing-dispatcher.ts` (lane orchestration + validator gate)
- `lib/chat/grounding-set.ts` (selection-like and strict matching limits)
- `lib/chat/grounding-llm-fallback.ts` (bounded LLM client contract)
- `app/api/chat/grounding-llm/route.ts` (server-side contract enforcement)
- `components/chat/chat-navigation-panel.tsx` (UI flow, panel-open latch re-anchor consistency)

New modules to add:
- `lib/chat/retrieval-memory.ts` (exact + semantic retrieval)
- `lib/chat/context-fingerprint.ts` (canonical context hashing)
- `lib/chat/action-validator.ts` (single validator gate)
- `lib/chat/resolution-memory-store.ts` (resolution memory CRUD)

## 16) Risk matrix

- **Risk:** stale memory replay executes wrong target  
  **Mitigation:** validator gate + context fingerprint + scope isolation

- **Risk:** semantic retrieval over-trust  
  **Mitigation:** retrieval is candidate generation only, never direct execution

- **Risk:** latency regression  
  **Mitigation:** deterministic fast lane retained, exact cache, semantic retrieval only on misses

- **Risk:** hidden behavior drift  
  **Mitigation:** strict provenance logging and per-lane metrics

## 17) Acceptance criteria

Plan is complete only when:
- strict policy remains true in production (`not exact => never deterministic execute`)
- deterministic fast lane is small, exact, and non-fuzzy
- memory retrieval is primary matching layer for non-exacts
- every execution passes validator gate
- bounded LLM runs only on validated scoped candidates
- unresolved always returns safe clarifier
- regression suite covers stale-latch, clarifier-reply, and context drift scenarios

## 18) Anti-pattern pre-read compliance

Mandatory pre-read:
- `codex/codex_needs_to_avoid/isolation-reactivity-anti-patterns.md`

Applicability:
- partially applicable
  - avoid contract drift between producer/consumer layers
  - avoid coupling broad behavior changes in one patch

Compliance in this plan:
- introduces modular layers with explicit contracts (planner/retriever/validator/executor)
- keeps execution authority in system validator, not in heuristic or LLM output alone
- stages rollout to prevent high-blast-radius changes

## 19) Imported priorities from Updated_Query_Response_Implementation_Plan_LLM_Driven.md

Directly adapted:
- system vs LLM responsibility split (LLM does bounded selection and decomposition proposal; system validates and executes)
- two-store model (durable immutable log + minimal serving index)
- format-only normalization with versioned normalization contract
- context-fingerprint drift safety before any reuse
- exact-first, semantic-second retrieval with verifier/confirmation for risky reuse
- multi-intent structured plan contract and partial replay safety
- resolution-memory reuse with condition checks, not blind replay
- dedupe/retention strategy for serving index and logs
