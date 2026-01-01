-- Migration: Drop session_state column from chat_conversations
-- Purpose: Session state is now stored in dedicated chat_session_state table (migration 057)
-- Note: Data was already migrated by migration 057

-- Drop the column (data preserved in chat_session_state table)
ALTER TABLE chat_conversations DROP COLUMN IF EXISTS session_state;

-- Add comment for documentation
COMMENT ON TABLE chat_conversations IS 'Chat conversations metadata. Session state moved to chat_session_state table (migration 057/058).';
