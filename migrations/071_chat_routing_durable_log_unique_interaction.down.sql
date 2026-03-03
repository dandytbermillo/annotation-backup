-- Migration: Revert unique constraint on (tenant_id, user_id, interaction_id)
-- Reverses 071_chat_routing_durable_log_unique_interaction.up.sql

-- Drop the unique constraint
ALTER TABLE chat_routing_durable_log
  DROP CONSTRAINT IF EXISTS uq_chat_routing_durable_log_interaction;

-- Restore original non-unique index from migration 067
CREATE INDEX idx_chat_routing_durable_log_interaction_id
  ON chat_routing_durable_log (interaction_id);
