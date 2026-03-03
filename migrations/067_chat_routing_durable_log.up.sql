-- Migration: Create chat_routing_durable_log table
-- Purpose: Immutable audit log for all chat routing decisions (v3.5 multi-layer routing)
-- Reference: multi-layer-routing-reliability-implementation-annex-v3_5.md Section 3.2

-- Ensure pgcrypto for gen_random_uuid()
CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE chat_routing_durable_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at timestamptz NOT NULL DEFAULT now(),

  -- Tenant/user isolation (fixed constants in Option A; multi-user in Option B)
  tenant_id text NOT NULL,
  user_id text NOT NULL,

  -- Session and turn identification
  session_id text NOT NULL,
  interaction_id text NOT NULL,
  turn_index integer NOT NULL,

  -- Query text (raw + normalized)
  raw_query_text text NOT NULL,
  normalized_query_text text NOT NULL,
  normalization_version text NOT NULL,
  query_fingerprint text NOT NULL,

  -- Context snapshot and fingerprint (SHA-256 of canonical JSON)
  context_snapshot_json jsonb NOT NULL,
  context_fingerprint text NOT NULL,

  -- Routing decision metadata
  routing_lane text NOT NULL CHECK (routing_lane IN ('A', 'B1', 'B2', 'C', 'D', 'E')),
  decision_source text NOT NULL CHECK (decision_source IN ('deterministic', 'memory_exact', 'memory_semantic', 'llm', 'clarifier')),
  candidate_ids_considered jsonb NOT NULL DEFAULT '[]'::jsonb,
  chosen_id text NULL,
  risk_tier text NOT NULL CHECK (risk_tier IN ('low', 'medium', 'high')),
  provenance text NOT NULL,
  result_status text NOT NULL CHECK (result_status IN ('executed', 'clarified', 'blocked', 'failed')),

  -- Model and config versions active at decision time
  embedding_model_version text NOT NULL,
  effective_thresholds_version text NOT NULL,
  effective_margin_version text NOT NULL,
  effective_confidence_threshold numeric(5,4) NULL,
  effective_near_tie_margin numeric(5,4) NULL,

  -- TOCTOU commit-time revalidation
  commit_revalidation_result text NULL,
  commit_revalidation_reason_code text NULL,

  -- Idempotency (mutation intents)
  idempotency_key text NULL
);

-- No updated_at column: this is an immutable audit log (append-only, never updated)

-- Indexes
CREATE INDEX idx_chat_routing_durable_log_tenant_user_time
  ON chat_routing_durable_log (tenant_id, user_id, created_at DESC);

CREATE INDEX idx_chat_routing_durable_log_session_turn
  ON chat_routing_durable_log (session_id, turn_index);

CREATE INDEX idx_chat_routing_durable_log_interaction_id
  ON chat_routing_durable_log (interaction_id);

CREATE INDEX idx_chat_routing_durable_log_fingerprint
  ON chat_routing_durable_log (query_fingerprint, context_fingerprint);

-- Documentation
COMMENT ON TABLE chat_routing_durable_log IS 'Immutable audit log for all chat routing decisions (v3.5 multi-layer routing). Append-only, never updated.';
COMMENT ON COLUMN chat_routing_durable_log.routing_lane IS 'Which routing lane handled this turn: A (deterministic), B1 (exact memory), B2 (semantic), C (validation), D (bounded LLM), E (clarifier)';
COMMENT ON COLUMN chat_routing_durable_log.decision_source IS 'How the final decision was made: deterministic, memory_exact, memory_semantic, llm, or clarifier';
COMMENT ON COLUMN chat_routing_durable_log.context_fingerprint IS 'SHA-256 hex of canonical sorted-key JSON context snapshot';
COMMENT ON COLUMN chat_routing_durable_log.query_fingerprint IS 'Deterministic hash of normalized query text';
COMMENT ON COLUMN chat_routing_durable_log.idempotency_key IS 'Dedup key for mutation intents: interaction_id + plan_step_id + chosen_id + tool_action';
COMMENT ON COLUMN chat_routing_durable_log.commit_revalidation_result IS 'TOCTOU freshness check outcome at commit time';
