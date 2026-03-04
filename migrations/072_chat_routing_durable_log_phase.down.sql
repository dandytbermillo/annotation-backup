-- Migration 072 DOWN: Remove log_phase column, restore original unique constraint.
-- Must delete execution_outcome rows first to avoid unique constraint violation.

DELETE FROM chat_routing_durable_log WHERE log_phase = 'execution_outcome';

ALTER TABLE chat_routing_durable_log
  DROP CONSTRAINT uq_chat_routing_durable_log_interaction;

ALTER TABLE chat_routing_durable_log
  ADD CONSTRAINT uq_chat_routing_durable_log_interaction
  UNIQUE (tenant_id, user_id, interaction_id);

ALTER TABLE chat_routing_durable_log
  DROP COLUMN log_phase;
