-- Migration: Add session_state column to chat_conversations
-- Purpose: Persist session stats (openCounts for entries and workspaces) across reloads
-- This allows "did I open X?" to work after page reloads

ALTER TABLE chat_conversations ADD COLUMN session_state jsonb NULL;

-- Comment for documentation
COMMENT ON COLUMN chat_conversations.session_state IS 'Session statistics including openCounts: { [id]: { type, name, count } } for entries and workspaces';
