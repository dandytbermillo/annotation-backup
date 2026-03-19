# Stage 6x.8 Phase 5 — Retrieval-Backed Semantic Memory

## Summary

Extend the existing routing stack without changing its order:

`deterministic -> semantic -> bounded LLM -> clarifier`

The change is inside the **semantic** stage only: use pre-seeded and runtime-written successful queries from `chat_routing_memory_index` as semantic exemplars. Retrieval supplies intent/target hints to the bounded LLM and clarifier, but **never directly authorizes execution**. Final truth still comes from current UI/session state and existing validators.

V1 scope: **history + navigation first**.
- History/info: `last_action`, `explain_last_action`, `verify_action`
- Navigation: `go_home`, `open_entry`, `open_workspace`, `open_panel`
- Out of scope for v1: note-content Stage 6, cross-surface state-info, mutation learning

Anti-pattern applicability: **not applicable**. This is routing/memory design, not provider/reactivity work.

## Implementation Changes

### 1. Reuse existing routing-memory storage; do not add a new table
- Use existing `chat_routing_memory_index` and existing embedding model/version (`openai:text-embedding-3-small@v1`).
- Keep `intent_class` split:
  - `info_intent` for `last_action`, `explain_last_action`, `verify_action`
  - `action_intent` for navigation intents
- Keep existing tenant/user boundaries for runtime-learned exemplars; no cross-user retrieval for learned memory.
- Store v1 semantic exemplars with:
  - normalized query text
  - semantic embedding
  - `intent_id`
  - `intent_class`
  - `slots_json`
  - `target_ids`
  - `risk_tier`
  - `context_fingerprint`
  - `schema_version` / `tool_version`
- For info intents, `target_ids` may be `[]`; `slots_json` must still record the resolved semantic intent and answer source, e.g. committed session state vs action-history verification.
- Collision note: the current UPSERT conflict key does **not** include `intent_class`, so mixed-class writes for the same query/context would collide into one row. Builder gating must guarantee that the same query/context cannot be written as both `info_intent` and `action_intent` in v1.

### 2. Extend the existing semantic lookup route; do not add a second semantic API
- Extend `POST /api/chat/routing-memory/semantic-lookup` instead of introducing a separate route.
- Add request fields:
  - `intent_scope: 'history_info' | 'navigation'`
  - optional `max_candidates` default `3`
- Keep existing response shape and add only what is needed for hint use:
  - `candidates[]` with `intent_id`, `intent_class`, `slots_json`, `target_ids`, `similarity_score`, `matched_row_id`, `context_fingerprint`
  - `lookup_status`
  - `current_context_fingerprint`
- Route-level filtering by scope:
  - `history_info` -> `intent_class = 'info_intent'`
  - `navigation` -> `intent_class = 'action_intent'`
- Seed-serving model for v1:
  - curated seeds must live in a distinct serving partition, not masquerade as user-learned rows
  - physical storage rule for v1: curated seeds reuse `chat_routing_memory_index` but are stored under a reserved sentinel `user_id` that runtime user writes can never use
  - define a canonical constant for that sentinel, e.g. `ROUTING_MEMORY_CURATED_SEED_USER_ID`
  - concrete schema tag for v1: curated seeds set `scope_source = 'curated_seed'`
  - retrieval may query two pools in order: current user learned exemplars first, then curated seed exemplars for the same tenant/product version via the reserved seed `user_id`
  - seed rows must be tagged via `scope_source = 'curated_seed'` so telemetry and ranking can distinguish them from learned examples
  - seed exemplars must never be written back over user-learned rows and must not relax same-user boundaries for learned memory
  - seed ingest mechanism: use a dedicated seeding script or privileged seeding path that reuses the same normalization + embedding pipeline but explicitly writes `ROUTING_MEMORY_CURATED_SEED_USER_ID` and `scope_source = 'curated_seed'`; do not reuse the normal runtime user-write path unchanged
- Retrieval filters for both scopes:
  - same tenant/user for learned rows
  - curated seeds allowed only from the curated-seed partition for the same tenant/product scope
  - TTL and schema/tool compatibility
  - embeddings present
  - exclude soft-deleted rows
- Do not auto-execute from this route. It remains hint-only for Phase 5.
- Shared-route backward-compat contract:
  - existing Stage 5/B2 callers that send no `intent_scope` continue to receive the current action-intent-only behavior
  - curated seeds must be excluded from Stage 5/B2 replay-oriented calls by default
  - Phase 5 callers opt into the new scope-aware behavior by sending `intent_scope` and by being gated under the separate Phase 5 hint flag
- Shared-route flag branching contract:
  - requests with no `intent_scope` remain governed by the existing Stage 5/B2 server/client flags
  - requests with `intent_scope` are governed by the separate Phase 5 hint flags only
  - do not require both flag families to be enabled for the same request path
- Use a distinct server/client flag for the new hint usage even though the HTTP route is shared:
  - example: `CHAT_ROUTING_MEMORY_HINT_READ_ENABLED` / `NEXT_PUBLIC_CHAT_ROUTING_MEMORY_HINT_READ`
- Do not couple Phase 5 rollout to the existing Stage 5 replay flag.

### 3. Stage ordering — retrieval-backed hinting must run after local semantic rescue
- Preserve current order:
  - deterministic exact/guards
  - existing local semantic rescue (`trySemanticRescue` / current `last_action` rescue path)
  - retrieval-backed semantic hinting
  - bounded LLM semantic decision
  - clarifier
- Retrieval-backed hinting must **not** replace or run ahead of the existing local rescue for `last_action` / `explain_last_action`.
- This keeps trivial local rescues fast and independent of embedding/database availability.

### 4. Use retrieval inside the semantic stage
- When deterministic and existing local rescue do not resolve:
  - run semantic exemplar retrieval for the relevant scope
  - pass top exemplars plus live context into the bounded LLM
  - LLM compares current query against retrieved successful examples and returns intent/surface/target family/confidence
- Current truth remains authoritative:
  - `last_action` and `explain_last_action` resolve from committed session state
  - `verify_action` resolves from committed action history
  - navigation resolves against current live entities and existing validators
- If confidence is low or top retrieved exemplars conflict materially, ask a targeted clarifier instead of guessing.

### 4a. Boundary: `history_info` Must Bypass the Cross-Surface Arbiter
- The cross-surface arbiter is only for interpreting current UI surface questions across:
  - `note`
  - `panel_widget`
  - `workspace`
  - `dashboard`
- `history_info` queries are not cross-surface queries.
- They resolve from committed history sources:
  - `sessionState.lastAction`
  - `sessionState.actionHistory`
- Required invariant:
  - if `detectHintScope(...) === 'history_info'`, the dispatcher must skip the cross-surface arbiter
  - these turns must continue through the history/info lane:
    - Phase 5 hint retrieval
    - navigate-route intent resolution
    - structured resolver answer from committed session state or action history
- Examples:
  - `what did I just do?` -> `history_info`
  - `what was my last action?` -> `history_info`
  - `did I open links panel b?` -> `history_info`
- Non-examples:
  - `which note is open?`
  - `what panel is open?`
  - `which workspace am I in?`
  - `what's on the dashboard?`
- Rationale:
  - the arbiter answers questions about the current visible UI state
  - `history_info` answers come from committed prior actions, which is a different source of truth
  - allowing `history_info` turns into the cross-surface arbiter causes avoidable ambiguous clarifiers before the history/info lane can run

### 5. Exact write seams
- Keep the existing `buildMemoryWritePayload()` path unchanged for current `groundingAction`-backed `action_intent` writes.
- Add a second builder for semantic answer intents, e.g. `buildInfoIntentMemoryWritePayload()`:
  - eligible for handled, successful semantic answer results for `last_action`, `explain_last_action`, `verify_action`
  - includes both retrieval-backed semantic answers and successful existing local-rescue history answers
  - produces `intent_class: 'info_intent'`
  - writes no `groundingAction`
  - uses the same normalization, snapshot, embedding, and UPSERT route as existing memory writes
- Attach the payload only on successful semantic-answer returns for the v1 history intents, not on clarifiers or failed rescues.
- Do not overload `memory_semantic` replay builders or provenance for this path.
- Learning policy note: successful local semantic rescue for v1 history intents should also feed the exemplar store, otherwise the highest-frequency successful history turns never improve memory coverage.

### 6. Context compatibility policy must differ by scope
- `navigation` exemplars:
  - runtime-learned navigation exemplars keep strict current-context compatibility before any target reuse hint is trusted strongly
  - use existing `context_fingerprint` and live validation expectations for learned navigation rows
  - curated navigation seeds are hint-only semantic exemplars, not replay candidates, so they may participate in intent hinting without exact context-fingerprint match
  - curated navigation seeds must still pass live target validation before any execution path is allowed
- `history_info` exemplars:
  - retrieval must **not** require exact current context fingerprint match
  - current context fingerprint may still be returned for telemetry, but retrieval should not be filtered out on mismatch
  - these intents resolve from committed session/action state, so the live UI may legitimately have changed since the original successful query
- LLM prompt should be told that history/info exemplars are semantic precedents, not current-state evidence.
- Freshness rule refinement:
  - do **not** broadly reject persisted `lastAction` history for exemplar use
  - only “just now / last action” wording may apply a freshness-aware answer policy at resolver time if needed
  - Phase 5 retrieval itself should not drop history exemplars simply because the current UI session continued or reloaded

### 7. Threshold policy by scope
- `navigation` scope:
  - keep a higher retrieval floor aligned with current replay-grade semantic memory usage
  - default: reuse current 0.92 floor unless later telemetry justifies lowering it
- `history_info` scope:
  - use a lower hint-grade retrieval floor than replay-grade action routing
  - default: retrieve top-k above a broader floor and let the bounded LLM arbitrate
  - do not require replay-grade similarity for `last_action` / `verify_action` exemplar hinting
- Final decision authority still comes from LLM confidence + resolver validation, not threshold alone.

### 8. Pre-seeding and writeback promotion rules
- Seed the DB with curated exemplar rows for v1 high-value paraphrase families:
  - history:
    - `what did I just do?`
    - `what was my last action?`
    - `remind me what I just did`
    - `did I open links panel b?`
  - navigation:
    - `go home`
    - `take me home`
    - `return home`
    - `open budget100`
    - `open links panel b`
- Seed rows must be inserted through the same normalization + embedding pipeline as runtime rows, not raw SQL with hand-built vectors.
- Runtime positive writeback contract:
  - write on successful v1 history/info answers and successful v1 navigation executions
  - do not write ambiguous, blocked, failed, or clarifier-only turns
  - do not write turns followed by explicit immediate correction signals (`no`, `wrong`, `not that`, equivalent correction flow)
- Concrete write timing policy for v1:
  - all Phase 5 positive exemplar writes, including direct-success and clarified-then-successful turns, enter a one-turn pending state first
  - if the immediate next user turn is not a correction/rejection, promote the exemplar write
  - if the immediate next user turn is a correction/rejection, drop the pending write
  - pending writes are session-scoped, do not survive reload/tab restore, and expire if no next user turn arrives within the next user turn window
  - on session end/reload with no next user turn, pending writes are dropped rather than auto-promoted
  - do not mix immediate write for direct success with delayed write for clarified success in v1; use one uniform promotion model
- Clarified-then-successful exemplars that survive promotion must be marked in storage, e.g. `slots_json.resolution_required_clarification = true`.
- Retrieval policy for clarified exemplars:
  - they may be used as semantic precedents
  - but they must be down-ranked or restricted to clarification assistance, not treated as direct high-confidence exemplars
- If a turn is later proven wrong by explicit correction before promotion, do not promote it into the positive serving index.
- For v1, record negative/uncertain outcomes only in telemetry/logging, not as positive exemplars.
- Risk-tier policy for v1 memory rows:
  - `last_action`, `explain_last_action`, and `verify_action` info exemplars are written as `risk_tier = 'low'`
  - curated seeds for v1 history and navigation exemplars must also be stored with `risk_tier IN ('low','medium')`; default to `low` unless a later approved policy says otherwise
  - no v1 Phase 5 exemplar or curated seed should be written as `high`, because current semantic lookup excludes high-risk rows

### 9. General correction-suppression seam
- Do not rely on doc-retrieval-only correction handling.
- Add a generic semantic-memory correction suppression mechanism for Phase 5:
  - when a turn produces a pending Phase 5 exemplar candidate, record lightweight pending metadata in client/session state
  - on the immediate next user turn, detect correction/rejection phrases using the existing correction/rejection vocabulary (`no`, `wrong`, `not that`, equivalent repair phrases)
  - if detected, suppress/drop the pending Phase 5 write
- This correction suppression applies to Phase 5 pending writes only; it does not replace existing doc-retrieval correction handling.

### 10. Clarifier behavior
- Clarifier remains the final fallback.
- Retrieved exemplars may shape the clarifier prompt, but the clarifier must present competing interpretations grounded in current context.
- Clarifier must not write back a positive exemplar until the user clarifies and the resulting turn succeeds.

## Public Interfaces / Types

- Extend semantic lookup request/response types to support `intent_scope` and `max_candidates`.
- Client-reader contract for v1:
  - keep the existing Stage 5/B2 reader behavior unchanged for callers that do not send `intent_scope`
  - implement Phase 5 through a separate client reader function or a clearly separated wrapper that always sends `intent_scope` and uses the Phase 5 hint flag
  - do not silently broaden the existing Stage 5 reader default payload shape for legacy callers
- Add `buildInfoIntentMemoryWritePayload()` (or equivalent) for `info_intent` writes.
- Extend memory write payload types to support `info_intent` without `groundingAction`.
- Add a routing-stage type for retrieved semantic exemplars, distinct from Stage 5 replay candidates.
- Extend stored `slots_json` for clarified exemplars with a clarification-required marker.
- Add pending Phase 5 write metadata type for one-turn delayed promotion, including whether the pending exemplar came from direct success vs clarified success, whether its source was learned vs curated-seed-assisted, and its expiry/finalization status.
- Add telemetry fields for hint usage.
  - Storage home: existing `semantic_hint_metadata` JSON in the durable routing log.
  - New Phase 5 fields should be namespaced separately from current B2/S5 fields, e.g. `h1_*` or `phase5_*`, to avoid mixing replay telemetry with hint telemetry.

## Test Plan

### Unit / API
- semantic lookup route:
  - `history_info` returns only `info_intent` candidates
  - `navigation` returns only `action_intent` candidates
  - existing callers with no `intent_scope` preserve current Stage 5 action-intent-only behavior
  - learned rows come from the current runtime user only
  - curated seeds come only from the reserved seed partition and are excluded from legacy Stage 5 calls
  - respects TTL / schema / tool filters
  - returns top-k by similarity
  - fail-open on embedding/server errors
- writeback builders:
  - `buildMemoryWritePayload()` unchanged for `action_intent`
  - `buildInfoIntentMemoryWritePayload()` writes `info_intent` rows correctly
  - clarified exemplars set the clarification-required marker
  - no write payload for failed / blocked / clarified-only turns
  - corrected turns do not produce positive write payloads
- pending-promotion logic:
  - successful direct-success turn creates pending write, not immediate write
  - successful clarified turn creates pending write, not immediate write
  - immediate next correction drops pending write
  - immediate next non-correction promotes pending write
  - reload/session-end/no-next-turn expiry drops pending write

### Integration
- history/info:
  - `what did i just do ?` retrieves seeded/learned history exemplar, resolves to `last_action`, answers from committed state
  - `what was my last action?` same
  - `did I open links panel b?` resolves to `verify_action`
  - history/info retrieval still works when current UI context changed after the original exemplar write
  - local semantic rescue still runs before retrieval-backed hinting
  - successful local-rescue `last_action` / `explain_last_action` answers still create pending `info_intent` exemplar writes
- navigation:
  - `take me home` retrieves `go_home` exemplars and resolves to `go_home`
  - `return home` same
  - `open budget100` resolves to the correct live workspace/entry target using current validators
- ambiguity:
  - conflicting retrieved examples -> clarifier, not execution
  - clarified exemplar influences clarifier/ranking but does not behave like a direct high-confidence precedent
  - stale retrieved target that fails current validation -> fall through to existing semantic/LLM path or clarifier
- correction suppression:
  - pending Phase 5 direct-success exemplar + next-turn `no` / `wrong` / `not that` -> pending write dropped
  - pending Phase 5 clarified-success exemplar + next-turn `no` / `wrong` / `not that` -> pending write dropped
  - pending exemplar expires on reload/session-end/no-next-turn and is not promoted later
- regression:
  - current deterministic selection handling still wins over semantic memory
  - Stage 5 replay behavior remains unchanged
  - cross-surface arbiter phases 3/4 remain unchanged
  - Phase 5 hint telemetry is emitted separately from B2/S5 replay telemetry

### Acceptance
- No new direct-execution path from retrieval alone
- `decision_source='memory_semantic'` remains reserved for actual replay paths; this new hint path logs as LLM-assisted with separate hint telemetry, not replay
- `what did I just do ?` no longer fails because of punctuation/noise if a retrieved exemplar exists or semantic hinting resolves it
- `go to home` / `take me home` resolve through semantic memory + existing validation, not regex expansion

## Assumptions and Defaults

- Plan file target: `docs/proposal/chat-navigation/plan/panels/chat/meta/multi_layer/stage6x8-phase5-retrieval-backed-semantic-memory-plan.md`
- V1 is limited to **history + navigation**, not all semantic lanes.
- Existing Stage 5 semantic replay path stays intact; this plan extends the existing semantic lookup route for a separate hint-oriented usage.
- Retrieval uses same-tenant and same-user boundaries for learned exemplars, plus a reserved sentinel-user curated-seed partition for product-provided seeds.
- Embedding provider/model stays `text-embedding-3-small` unless an existing platform-wide embedding change happens first.
- No new broad regex expansion for paraphrase handling; retrieval-backed semantics is the intended evolution path.
