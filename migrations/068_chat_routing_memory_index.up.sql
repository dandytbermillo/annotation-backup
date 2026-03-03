-- Migration: Create chat_routing_memory_index table
-- Purpose: Serving index for fast exact + semantic retrieval of reusable routing decisions
-- Reference: multi-layer-routing-reliability-implementation-annex-v3_5.md Section 3.3
--
-- PREREQUISITE: pgvector extension must be installed on the Postgres instance.
-- If pgvector is not available, this migration will fail and block subsequent migrations.
-- Pre-provision with: CREATE EXTENSION IF NOT EXISTS vector;
--
-- PREREQUISITE: update_updated_at() function must exist (created in migration 001).
-- Verify with: SELECT n.nspname, p.proname FROM pg_proc p
--   JOIN pg_namespace n ON n.oid = p.pronamespace WHERE p.proname = 'update_updated_at';

-- Enable pgvector for vector(1536) column
CREATE EXTENSION IF NOT EXISTS vector;

CREATE TABLE chat_routing_memory_index (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),

  -- Tenant/user isolation
  tenant_id text NOT NULL,
  user_id text NOT NULL,

  -- Scope and intent classification
  scope_source text NOT NULL,
  intent_class text NOT NULL CHECK (intent_class IN ('action_intent', 'info_intent')),

  -- Query identification
  query_fingerprint text NOT NULL,
  normalized_query_text text NOT NULL,

  -- Semantic embedding (nullable; populated when embeddings are computed)
  -- Dimension 1536 for OpenAI text-embedding-3-small; adjust if model changes
  semantic_embedding vector(1536) NULL,
  embedding_model_version text NOT NULL,

  -- Context fingerprint (SHA-256 of canonical JSON)
  context_fingerprint text NOT NULL,

  -- Resolution data
  intent_id text NOT NULL,
  slots_json jsonb NOT NULL,
  target_ids jsonb NOT NULL,

  -- Compatibility versioning
  schema_version text NOT NULL,
  tool_version text NOT NULL,
  permission_signature text NOT NULL,

  -- Risk and reuse tracking
  risk_tier text NOT NULL CHECK (risk_tier IN ('low', 'medium', 'high')),
  success_count integer NOT NULL DEFAULT 0,
  last_success_at timestamptz NULL,
  ttl_expires_at timestamptz NULL,

  -- Soft delete
  is_deleted boolean NOT NULL DEFAULT false
);

-- updated_at trigger (function exists from migration 001)
CREATE TRIGGER chat_routing_memory_index_updated_at
  BEFORE UPDATE ON chat_routing_memory_index
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- Exact lookup index (Lane B1): unique per query+context+schema+tool within active entries
CREATE UNIQUE INDEX idx_chat_routing_memory_index_exact_lookup
  ON chat_routing_memory_index (tenant_id, user_id, query_fingerprint, context_fingerprint, schema_version, tool_version)
  WHERE is_deleted = false;

-- Retrieval filter index (Lane B2/D candidate pool)
CREATE INDEX idx_chat_routing_memory_index_retrieval_filter
  ON chat_routing_memory_index (tenant_id, user_id, intent_class, risk_tier, ttl_expires_at)
  WHERE is_deleted = false;

-- Recency index (LRU tracking for eviction)
CREATE INDEX idx_chat_routing_memory_index_recency
  ON chat_routing_memory_index (tenant_id, user_id, last_success_at DESC);

-- Vector similarity index for semantic retrieval path
-- NOTE: IVFFLAT index performance improves with sufficient rows. On an empty or low-row table,
-- the index will function but clustering won't be well-optimized. Run ANALYZE after bulk
-- inserts for best performance. Consider rebuilding the index periodically as data grows.
CREATE INDEX idx_chat_routing_memory_index_semantic
  ON chat_routing_memory_index USING ivfflat (semantic_embedding vector_cosine_ops)
  WHERE is_deleted = false AND semantic_embedding IS NOT NULL;

-- Documentation
COMMENT ON TABLE chat_routing_memory_index IS 'Serving index for fast exact and semantic retrieval of reusable routing decisions (v3.5 multi-layer routing)';
COMMENT ON COLUMN chat_routing_memory_index.semantic_embedding IS 'Vector embedding (1536d for text-embedding-3-small). Nullable; populated when embeddings are computed.';
COMMENT ON COLUMN chat_routing_memory_index.intent_class IS 'Intent classification: action_intent (mutations/navigations) or info_intent (reads/queries)';
COMMENT ON COLUMN chat_routing_memory_index.context_fingerprint IS 'SHA-256 hex of canonical sorted-key JSON context snapshot';
COMMENT ON COLUMN chat_routing_memory_index.is_deleted IS 'Soft delete flag; partial indexes filter on is_deleted = false';
COMMENT ON COLUMN chat_routing_memory_index.permission_signature IS 'Hash of user permissions at creation time for compatibility checks';
