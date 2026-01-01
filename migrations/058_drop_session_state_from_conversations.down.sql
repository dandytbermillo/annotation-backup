-- Rollback: Restore session_state column to chat_conversations
-- Note: This will restore the column structure but data will need to be migrated back from chat_session_state

-- Restore the column
ALTER TABLE chat_conversations ADD COLUMN IF NOT EXISTS session_state JSONB;

-- Migrate data back from dedicated table
UPDATE chat_conversations c
SET session_state = ss.session_state
FROM chat_session_state ss
WHERE c.id = ss.conversation_id AND c.user_id = ss.user_id;

-- Remove the comment (or update it)
COMMENT ON TABLE chat_conversations IS 'Chat conversations with session state.';
