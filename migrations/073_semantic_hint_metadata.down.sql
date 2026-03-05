-- Migration 073 DOWN: Remove semantic_hint_metadata column

ALTER TABLE chat_routing_durable_log
  DROP COLUMN IF EXISTS semantic_hint_metadata;
