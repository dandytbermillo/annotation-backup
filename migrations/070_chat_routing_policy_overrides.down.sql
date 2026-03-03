-- Migration: Remove chat_routing_policy_overrides table
-- Reverses 070_chat_routing_policy_overrides.up.sql

-- Drop trigger first
DROP TRIGGER IF EXISTS chat_routing_policy_overrides_updated_at ON chat_routing_policy_overrides;

-- Drop table (CASCADE handles indexes)
DROP TABLE IF EXISTS chat_routing_policy_overrides CASCADE;
