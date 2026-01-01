-- Rollback: Remove chat_session_state table
-- Note: Data will be lost. If backwards migration is needed, consider copying data back to chat_conversations.session_state first.

DROP TABLE IF EXISTS chat_session_state;
