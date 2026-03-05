-- Migration 073: Add semantic_hint_metadata column for Phase 3 B2 telemetry
--
-- Stores B2 semantic hint telemetry (hint_count, top_score, hint_used) in a
-- separate JSONB column to avoid altering context_snapshot_json fingerprints.

ALTER TABLE chat_routing_durable_log
  ADD COLUMN semantic_hint_metadata JSONB NULL;

COMMENT ON COLUMN chat_routing_durable_log.semantic_hint_metadata
  IS 'Phase 3 B2 telemetry: semantic hint count, top score, hint used flag. Nullable, only populated when B2 candidates are present.';
