-- Migration: Add chat history persistence tables
-- Purpose: Store chat conversations and messages for UI history restoration
-- while keeping LLM context compact (summary + recent window + sessionState)

-- Ensure pgcrypto extension for gen_random_uuid()
CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- Chat conversations table
-- Stores conversation metadata, scope, and rolling summary
CREATE TABLE chat_conversations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  scope text NOT NULL CHECK (scope IN ('global', 'entry', 'workspace')),
  entry_id uuid NULL REFERENCES items(id) ON DELETE CASCADE,
  workspace_id uuid NULL REFERENCES note_workspaces(id) ON DELETE CASCADE,
  title text NULL,
  summary text NULL,
  summary_until_message_id uuid NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- NULL-safe uniqueness per scope
-- Global: one conversation per user (no entry/workspace)
CREATE UNIQUE INDEX chat_conversations_global_unique
  ON chat_conversations (user_id)
  WHERE scope = 'global' AND entry_id IS NULL AND workspace_id IS NULL;

-- Entry: one conversation per user per entry
CREATE UNIQUE INDEX chat_conversations_entry_unique
  ON chat_conversations (user_id, entry_id)
  WHERE scope = 'entry' AND entry_id IS NOT NULL AND workspace_id IS NULL;

-- Workspace: one conversation per user per workspace
CREATE UNIQUE INDEX chat_conversations_workspace_unique
  ON chat_conversations (user_id, workspace_id)
  WHERE scope = 'workspace' AND workspace_id IS NOT NULL;

-- Chat messages table
-- Stores individual messages with role, content, and metadata
CREATE TABLE chat_messages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id uuid NOT NULL REFERENCES chat_conversations(id) ON DELETE CASCADE,
  role text NOT NULL CHECK (role IN ('user', 'assistant', 'system')),
  content text NOT NULL,
  metadata jsonb NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- Index for efficient pagination by conversation
CREATE INDEX chat_messages_conversation_created_at_idx
  ON chat_messages (conversation_id, created_at DESC);

-- Add self-referential FK for summary_until_message_id after chat_messages exists
ALTER TABLE chat_conversations
  ADD CONSTRAINT chat_conversations_summary_until_message_id_fkey
  FOREIGN KEY (summary_until_message_id) REFERENCES chat_messages(id) ON DELETE SET NULL;

-- Comments for documentation
COMMENT ON TABLE chat_conversations IS 'Chat conversation threads with rolling summary for LLM context';
COMMENT ON TABLE chat_messages IS 'Individual chat messages with role and metadata';
COMMENT ON COLUMN chat_conversations.scope IS 'Conversation scope: global (single thread), entry (per entry), or workspace (per workspace)';
COMMENT ON COLUMN chat_conversations.summary IS 'Rolling summary of older messages for compact LLM context';
COMMENT ON COLUMN chat_conversations.summary_until_message_id IS 'Last message ID included in summary (for concurrency guard)';
COMMENT ON COLUMN chat_messages.metadata IS 'Optional JSON: intent, options (selection pills), isError, entryContext, workspaceContext';
