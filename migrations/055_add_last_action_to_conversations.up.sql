-- Migration: Add last_action column to chat_conversations
-- Purpose: Persist the most recent navigation action for session state continuity
-- This allows "what is the last workspace I opened" to work after page reloads

ALTER TABLE chat_conversations ADD COLUMN last_action jsonb NULL;

-- Comment for documentation
COMMENT ON COLUMN chat_conversations.last_action IS 'Most recent navigation action (type, workspaceId, workspaceName, timestamp) for session state persistence';
