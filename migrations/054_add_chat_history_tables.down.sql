-- Migration: Remove chat history persistence tables
-- Reverses 054_add_chat_history_tables.up.sql

-- Drop FK constraint first (added after table creation)
ALTER TABLE chat_conversations
  DROP CONSTRAINT IF EXISTS chat_conversations_summary_until_message_id_fkey;

-- Drop tables (CASCADE handles indexes and dependent objects)
DROP TABLE IF EXISTS chat_messages CASCADE;
DROP TABLE IF EXISTS chat_conversations CASCADE;
