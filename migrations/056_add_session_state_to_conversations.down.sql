-- Rollback: Remove session_state column from chat_conversations

ALTER TABLE chat_conversations DROP COLUMN IF EXISTS session_state;
