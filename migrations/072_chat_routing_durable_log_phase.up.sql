-- Migration 072: Add log_phase column for two-phase logging (Bug #3 fix)
-- Each interaction produces: 1 routing_attempt + 0-1 execution_outcome rows.
-- Existing rows default to 'routing_attempt'.

ALTER TABLE chat_routing_durable_log
  ADD COLUMN log_phase TEXT NOT NULL DEFAULT 'routing_attempt'
  CHECK (log_phase IN ('routing_attempt', 'execution_outcome'));

ALTER TABLE chat_routing_durable_log
  DROP CONSTRAINT uq_chat_routing_durable_log_interaction;

ALTER TABLE chat_routing_durable_log
  ADD CONSTRAINT uq_chat_routing_durable_log_interaction
  UNIQUE (tenant_id, user_id, interaction_id, log_phase);
