-- Migration: Create dedicated chat_session_state table
-- Purpose: Separate session tracking from conversation metadata for cleaner architecture

-- Create the dedicated session state table
CREATE TABLE chat_session_state (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id UUID NOT NULL REFERENCES chat_conversations(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL,
  session_state JSONB NOT NULL DEFAULT '{}',
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  -- Ensure one session state per conversation per user
  CONSTRAINT uq_chat_session_state_conv_user UNIQUE (conversation_id, user_id)
);

-- Index for fast lookups by conversation
CREATE INDEX idx_chat_session_state_conversation ON chat_session_state(conversation_id);

-- Index for lookups by user
CREATE INDEX idx_chat_session_state_user ON chat_session_state(user_id);

-- Migrate existing session_state data from chat_conversations
-- This preserves any existing session stats
INSERT INTO chat_session_state (conversation_id, user_id, session_state, updated_at)
SELECT id, user_id, session_state, NOW()
FROM chat_conversations
WHERE session_state IS NOT NULL;

-- Comment for documentation
COMMENT ON TABLE chat_session_state IS 'Dedicated table for chat session tracking (openCounts, lastAction). Separated from chat_conversations for cleaner architecture.';
COMMENT ON COLUMN chat_session_state.session_state IS 'JSONB containing: openCounts { [id]: { type, name, count } }, lastAction { type, workspaceId?, entryId?, ... }';
