-- Migration: Add unique constraint on (tenant_id, user_id, interaction_id)
-- Purpose: Enable ON CONFLICT DO NOTHING for idempotent log writes (Phase 1 observe-only)
-- Reference: multi-layer-routing-reliability-implementation-annex-v3_5.md Section 3.2
-- Note: Replaces the non-unique index from migration 067

-- Drop existing non-unique index (replaced by unique constraint below)
DROP INDEX IF EXISTS idx_chat_routing_durable_log_interaction_id;

-- Add unique constraint (serves as both conflict target and index)
ALTER TABLE chat_routing_durable_log
  ADD CONSTRAINT uq_chat_routing_durable_log_interaction
  UNIQUE (tenant_id, user_id, interaction_id);

COMMENT ON CONSTRAINT uq_chat_routing_durable_log_interaction ON chat_routing_durable_log
  IS 'Unique constraint for ON CONFLICT idempotent writes. Scoped to tenant+user for Option B forward compatibility.';
