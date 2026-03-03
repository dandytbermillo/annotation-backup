-- Migration: Create chat_routing_resolution_memory table
-- Purpose: Ambiguity resolution cache — tracks how clarifier choices resolve uncertain intents
-- Reference: multi-layer-routing-reliability-implementation-annex-v3_5.md Section 3.4
--
-- PREREQUISITE: update_updated_at() function must exist (created in migration 001).

CREATE TABLE chat_routing_resolution_memory (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),

  -- Tenant/user isolation
  tenant_id text NOT NULL,
  user_id text NOT NULL,

  -- Trigger identification (hash of ambiguous query + ambiguity class + context shape)
  trigger_fingerprint text NOT NULL,
  ambiguity_class text NOT NULL,

  -- Resolved outcome
  resolved_intent_id text NOT NULL,
  resolved_slots_json jsonb NOT NULL,
  resolved_target_ids jsonb NOT NULL,

  -- Conditions that must hold for safe reuse
  condition_json jsonb NOT NULL,

  -- Optional plan signature for multi-intent fast compatibility checks
  plan_signature text NULL,

  -- Reuse tracking and eviction
  reuse_count integer NOT NULL DEFAULT 0,
  ttl_expires_at timestamptz NULL,

  -- Soft delete
  is_deleted boolean NOT NULL DEFAULT false
);

-- updated_at trigger (function exists from migration 001)
CREATE TRIGGER chat_routing_resolution_memory_updated_at
  BEFORE UPDATE ON chat_routing_resolution_memory
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- Primary lookup: find prior resolutions for this ambiguity trigger
CREATE INDEX idx_chat_routing_resolution_memory_lookup
  ON chat_routing_resolution_memory (tenant_id, user_id, trigger_fingerprint)
  WHERE is_deleted = false;

-- TTL/eviction management
CREATE INDEX idx_chat_routing_resolution_memory_ttl
  ON chat_routing_resolution_memory (tenant_id, user_id, ttl_expires_at)
  WHERE is_deleted = false;

-- Documentation
COMMENT ON TABLE chat_routing_resolution_memory IS 'Ambiguity resolution cache for repeated clarifier scenarios (v3.5 multi-layer routing). Reused when trigger conditions still hold.';
COMMENT ON COLUMN chat_routing_resolution_memory.trigger_fingerprint IS 'Hash of (query + ambiguity_class + context_shape) that triggered the original clarifier';
COMMENT ON COLUMN chat_routing_resolution_memory.ambiguity_class IS 'Category of ambiguity (e.g., multi_intent, near_tie, scope_ambiguous)';
COMMENT ON COLUMN chat_routing_resolution_memory.condition_json IS 'Context conditions that must still hold for safe reuse of this resolution';
COMMENT ON COLUMN chat_routing_resolution_memory.plan_signature IS 'Optional: intent_ids + slot-shape signature for fast plan compatibility checks';
