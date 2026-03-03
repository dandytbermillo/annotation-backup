-- Migration: Remove chat_routing_memory_index table
-- Reverses 068_chat_routing_memory_index.up.sql

-- Drop trigger first
DROP TRIGGER IF EXISTS chat_routing_memory_index_updated_at ON chat_routing_memory_index;

-- Drop table (CASCADE handles indexes)
DROP TABLE IF EXISTS chat_routing_memory_index CASCADE;

-- Note: We do NOT drop the vector extension here as other tables/extensions may depend on it.
-- To remove pgvector entirely: DROP EXTENSION IF EXISTS vector CASCADE;
