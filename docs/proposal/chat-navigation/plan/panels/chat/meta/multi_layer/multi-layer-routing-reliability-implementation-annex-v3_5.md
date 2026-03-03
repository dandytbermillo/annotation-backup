# Multi-Layer Routing Reliability: Implementation Annex (v3.5)

**Status:** Proposed  
**Owner:** Chat Navigation  
**Last updated:** 2026-03-02  
**Applies to:** `multi-layer-routing-reliability-plan-v3_5.md`

## 1) Purpose

This annex turns the v3.5 architecture into an implementation-ready specification:
- concrete schema/migration plan
- concrete embedding model/version policy
- latency budgets and failure matrix
- context fingerprint algorithm
- Option A vs Option B scoping
- migration map from current tiered dispatcher

## 2) Option Scope (Now vs Later)

### 2.1 Option A (implement now)
- single-user execution path
- local/session caches
- fixed constants: `tenant_id = 'default'`, `user_id = 'local'` (persisted for forward compatibility)
- no cross-user retrieval
- response-text reuse: out of scope for Phase 1

### 2.2 Option B (later, schema-compatible)
- multi-user and true tenant isolation
- policy overrides per tenant/user
- global-safe help/FAQ cross-user retrieval exceptions (explicitly flagged only)

## 3) Concrete Schema and Migrations

## 3.1 Migration files to add

1. `migrations/20260302_chat_routing_durable_log.up.sql`  
2. `migrations/20260302_chat_routing_durable_log.down.sql`  
3. `migrations/20260302_chat_routing_memory_index.up.sql`  
4. `migrations/20260302_chat_routing_memory_index.down.sql`  
5. `migrations/20260302_chat_routing_resolution_memory.up.sql`  
6. `migrations/20260302_chat_routing_resolution_memory.down.sql`  
7. `migrations/20260302_chat_routing_policy_overrides.up.sql`  
8. `migrations/20260302_chat_routing_policy_overrides.down.sql`

## 3.2 `chat_routing_durable_log` (authoritative audit log)

Columns (recommended types):
- `id uuid primary key default gen_random_uuid()`
- `created_at timestamptz not null default now()`
- `tenant_id text not null`
- `user_id text not null`
- `session_id text not null`
- `interaction_id text not null`
- `turn_index integer not null`
- `raw_query_text text not null`
- `normalized_query_text text not null`
- `normalization_version text not null`
- `query_fingerprint text not null`
- `context_snapshot_json jsonb not null`
- `context_fingerprint text not null`
- `routing_lane text not null`
- `decision_source text not null`
- `candidate_ids_considered jsonb not null default '[]'::jsonb`
- `chosen_id text null`
- `risk_tier text not null`
- `provenance text not null`
- `result_status text not null`
- `embedding_model_version text not null`
- `effective_thresholds_version text not null`
- `effective_margin_version text not null`
- `effective_confidence_threshold numeric(5,4) null`
- `effective_near_tie_margin numeric(5,4) null`
- `commit_revalidation_result text null`
- `commit_revalidation_reason_code text null`
- `idempotency_key text null`

Indexes:
- `(tenant_id, user_id, created_at desc)`
- `(session_id, turn_index)`
- `(interaction_id)`
- `(query_fingerprint, context_fingerprint)`

Constraints:
- check `risk_tier in ('low','medium','high')`
- check `result_status in ('executed','clarified','blocked','failed')`
- check `decision_source in ('deterministic','memory_exact','memory_semantic','llm','clarifier')`

## 3.3 `chat_routing_memory_index` (serving index)

Columns:
- `id uuid primary key default gen_random_uuid()`
- `created_at timestamptz not null default now()`
- `updated_at timestamptz not null default now()`
- `tenant_id text not null`
- `user_id text not null`
- `scope_source text not null`
- `intent_class text not null` -- `action_intent` or `info_intent`
- `query_fingerprint text not null`
- `normalized_query_text text not null`
- `semantic_embedding vector(1536) null` -- adjust dimension by model
- `embedding_model_version text not null`
- `context_fingerprint text not null`
- `intent_id text not null`
- `slots_json jsonb not null`
- `target_ids jsonb not null`
- `schema_version text not null`
- `tool_version text not null`
- `permission_signature text not null`
- `risk_tier text not null`
- `success_count integer not null default 0`
- `last_success_at timestamptz null`
- `ttl_expires_at timestamptz null`
- `is_deleted boolean not null default false`

Indexes:
- exact lookup: `(tenant_id, user_id, query_fingerprint, context_fingerprint, schema_version, tool_version)`
- retrieval filter: `(tenant_id, user_id, intent_class, risk_tier, ttl_expires_at)`
- metadata recency: `(tenant_id, user_id, last_success_at desc)`
- vector index for semantic path (provider-specific index type)

Constraints:
- check `risk_tier in ('low','medium','high')`
- check `intent_class in ('action_intent','info_intent')`

## 3.4 `chat_routing_resolution_memory`

Columns:
- `id uuid primary key default gen_random_uuid()`
- `created_at timestamptz not null default now()`
- `updated_at timestamptz not null default now()`
- `tenant_id text not null`
- `user_id text not null`
- `trigger_fingerprint text not null`
- `ambiguity_class text not null`
- `resolved_intent_id text not null`
- `resolved_slots_json jsonb not null`
- `resolved_target_ids jsonb not null`
- `condition_json jsonb not null`
- `plan_signature text null`
- `reuse_count integer not null default 0`
- `ttl_expires_at timestamptz null`
- `is_deleted boolean not null default false`

Indexes:
- `(tenant_id, user_id, trigger_fingerprint)`
- `(tenant_id, user_id, ttl_expires_at)`

## 3.5 `chat_routing_policy_overrides`

Columns:
- `id uuid primary key default gen_random_uuid()`
- `created_at timestamptz not null default now()`
- `updated_at timestamptz not null default now()`
- `tenant_id text not null`
- `scope_level text not null` -- `global_default`, `intent`, `tenant`, `tenant_intent`
- `intent_class text null`
- `override_payload jsonb not null`
- `thresholds_version text not null`
- `margin_version text not null`
- `approved_by text not null`
- `is_allowlisted boolean not null default false`
- `is_active boolean not null default true`

Rules:
- reject write if override lowers safety below configured minimum bands
- store audit log for create/update/delete

## 4) Embedding Model and Score Contract

Confirmed embedding model for v3.5:
- `text-embedding-3-small` (dimension 1536) — **confirmed for production**
- stored as `embedding_model_version = openai:text-embedding-3-small@v1`
- vector engine: pgvector on PostgreSQL 16, `vector(1536)`, `ivfflat` + `vector_cosine_ops`

Rules:
- all score thresholds apply to `primary_similarity_score` only
- `primary_similarity_score` = cosine similarity(query embedding, candidate embedding) in same intent-class index
- if model/version changes, thresholds must be recalibrated before rollout

Calibration requirement:
- maintain offline labeled set per model/version:
  - `should_reuse`
  - `should_not_reuse`
- publish calibration artifact with:
  - threshold values
  - sample size
  - precision/recall summary
  - date and owner

## 5) Latency Budgets (SLO Targets)

Per-turn targets (p95):
- Lane A: <= 5 ms
- Lane B1 exact lookup: <= 30 ms
- Lane B2 semantic retrieval: <= 200 ms
- Lane C validation: <= 40 ms
- Lane D bounded LLM selector call: <= 800 ms
- End-to-end routing (no network retries): <= 1500 ms

Error budget guard:
- if Lane D timeout budget is exceeded, fail closed to safe clarifier.

## 6) Failure/Fallback Matrix

1. Embedding service down:
- fallback: skip B2 semantic; continue B1 + Lane D/Lane E
- user effect: slightly lower recall, no unsafe execute

2. LLM timeout/malformed output:
- fallback: safe clarifier (clickable options if available)
- user effect: asks for clarification instead of guessing

3. Durable DB unavailable:
- fallback: enforce durable-audit authority at execution commit
- action/mutation intents: fail closed (no execute) and return safe clarifier
- info intents: allow degraded read-only path using in-memory/session data only
- if temporary local buffer exists, queue durable-log writeback for recovery with original timestamps; otherwise mark turn as `unaudited_degraded`
- user effect: safe behavior preserved; mutations paused until durable logging is restored

4. Serving index unavailable/corrupt:
- fallback: bypass memory reuse, rely on current-turn grounding + bounded LLM
- user effect: slower and more clarifiers, no unsafe execute

5. TOCTOU commit revalidation failure:
- action intents: immediate safe clarifier
- info intents: one bounded Lane C rerun on existing candidates, then clarifier

6. Policy override load failure:
- fallback: use baked-in global safety defaults

## 7) Context Fingerprint Specification

Serialization:
- canonical JSON with lexicographically sorted keys at every object depth
- arrays:
  - id sets sorted ascending
  - preserve semantic order only when order is part of meaning
- remove non-deterministic fields (timestamps, transient UI animation state)

Hash:
- SHA-256 over UTF-8 bytes of canonical JSON string
- lowercase hex output in `context_fingerprint`

Compatibility functions:
- action intent: exact fingerprint or one approved strict-compatibility profile
- info intent: relaxed compatibility (same widget type + target exists + permission signature compatible)

## 8) Transition Map (Current Tiers -> New Lanes)

Coexistence under feature flags:
- current Tier 0/strict-exact paths -> Lane A
- current scope-constrained deterministic grounding -> Lane C prefilter + Lane D selection
- current grounding memory-like reuse -> Lane B1/B2
- current clarifier interception and option handling -> Lane E + clarifier-reply lock

Rollout strategy:
- keep existing tier implementation active
- introduce lane wrapper in dispatcher
- route by feature flag to old tier path or new lane path
- compare provenance and outcome in shadow mode before cutover

## 9) Config Management

Configuration sources:
1. static safe defaults in code (immutable fallback)
2. versioned config records in `chat_routing_policy_overrides`
3. resolved runtime config attached to each decision log

Required runtime config fields:
- `thresholds_version`
- `margin_version`
- `effective_confidence_threshold`
- `effective_near_tie_margin`
- `embedding_model_version`
- clamp bounds used

## 10) Retention, Eviction, and Deletion Propagation

Eviction policy:
- exact cache: TTL eviction + LRU
- semantic serving index: TTL + periodic compaction
- resolution memory: TTL + reuse-count cap

Deletion propagation:
- durable log redaction/deletion policy
- serving index/vector deletion
- embedding/session cache invalidation
- replica propagation with audit trail

## 11) Testing and Golden Datasets

Framework:
- unit/integration in existing Jest test suite
- add deterministic golden suites for grammar/vocab version changes

Must-have tests:
- non-exact never deterministic execute
- near-tie margin always clarifies
- TOCTOU drift blocks commit
- no-model shortcut still enforces validator + TOCTOU + idempotency
- per-tenant unsafe override rejected

Golden datasets:
- semantic calibration set
- clarifier resolution set
- multi-intent decomposition and partial execution set

## 12) Rollout Entry/Exit Criteria

Phase progression gates:
1. Observe-only -> Exact-memory assist
- minimum 1000 routed turns logged
- schema/config parse error rate < 1%

2. Exact-memory assist -> Semantic assist
- exact-memory mismatch incidents = 0 critical
- validator false-positive rate acceptable by owner review

3. Semantic assist -> Bounded LLM optimize
- semantic candidate precision at target quality in shadow metrics
- near-tie and ambiguity guard behavior verified

4. Bounded LLM optimize -> Resolution memory reuse
- safe clarifier loop rate improving trend
- no policy-violation executions in audit sample

5. Resolution memory reuse -> Verified semantic reuse
- calibration artifact approved for active embedding model/version
- TOCTOU and idempotency suppression rates stable

## 13) Pre-Build Decisions (All Closed)

1. ~~Confirm embedding provider/model in production environment.~~
   **Closed (2026-03-02):** `text-embedding-3-small` (1536d), `openai:text-embedding-3-small@v1`. See Section 4.
2. ~~Confirm vector index extension/engine and dimensions.~~
   **Closed (2026-03-02):** pgvector on PostgreSQL 16, `vector(1536)`, `ivfflat` + `vector_cosine_ops`. See Section 4.
3. ~~Confirm Option A initial `tenant_id` and `user_id` constants.~~
   **Closed (2026-03-02):** `tenant_id = 'default'`, `user_id = 'local'`. See Section 2.1.
4. ~~Confirm whether response-text reuse is in or out of scope for first implementation.~~
   **Closed (2026-03-02):** Out of scope for Phase 1. See Section 2.1.
5. ~~Author, review, and merge the concrete `.up.sql/.down.sql` migration files.~~
   **Closed (2026-03-02):** 8 files authored (migrations/067–070). All 4 validated (up/down/re-up) on local annotation_dev with pgvector/pgvector:pg16.
