-- Migration: Remove chat_routing_resolution_memory table
-- Reverses 069_chat_routing_resolution_memory.up.sql

-- Drop trigger first
DROP TRIGGER IF EXISTS chat_routing_resolution_memory_updated_at ON chat_routing_resolution_memory;

-- Drop table (CASCADE handles indexes)
DROP TABLE IF EXISTS chat_routing_resolution_memory CASCADE;
