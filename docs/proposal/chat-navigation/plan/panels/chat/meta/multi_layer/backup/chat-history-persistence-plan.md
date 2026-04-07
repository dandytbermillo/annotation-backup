# Chat History Persistence Plan (UI Pagination + Compact LLM Context)

## Goal
Persist all chat conversations to the database so the UI can restore history after reload, while keeping LLM context compact (summary + recent window + sessionState).

## Non-Goals
- No full conversation sent to the LLM.
- No redesign of chat UX beyond pagination/"Show older messages".
- No cross-user sharing.
- No multi-tab sync for v1 (changes won’t live-sync across tabs).

## Decisions Needed
- Conversation scope default:
  - Option A: Global conversation per user (single thread across entries/workspaces).
  - Option B: Per-entry conversation.
  - Option C: Per-entry + per-workspace.
- Recommended default: Global conversation (aligns with single chatbox).
- User model (v1): Single-user only. Use a server-side constant or local user record for user_id; never accept user_id from client.

## Data Model
### chat_conversations
- id (uuid)
- user_id (uuid)
- scope ("global" | "entry" | "workspace")
- entry_id (uuid, nullable)
- workspace_id (uuid, nullable)
- title (text, nullable)
- summary (text, nullable)
- summary_until_message_id (uuid, nullable)
- created_at (timestamp)
- updated_at (timestamp)

### chat_messages
- id (uuid)
- conversation_id (uuid)
- role ("user" | "assistant" | "system")
- content (text)
- metadata (jsonb) // optional: intent, entry/workspace context, error flag
- created_at (timestamp)

## Indexes and Constraints
- chat_conversations: use partial unique indexes (NULL-safe) to prevent duplicates per scope.
- chat_messages: index (conversation_id, created_at DESC).

## SQL Schema (Example)
```sql
CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE chat_conversations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  scope text NOT NULL CHECK (scope IN ('global','entry','workspace')),
  entry_id uuid NULL,
  workspace_id uuid NULL,
  title text NULL,
  summary text NULL,
  summary_until_message_id uuid NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, scope, entry_id, workspace_id)
);

-- NULL-safe uniqueness per scope
CREATE UNIQUE INDEX chat_conversations_global_unique
  ON chat_conversations (user_id)
  WHERE scope = 'global' AND entry_id IS NULL AND workspace_id IS NULL;

CREATE UNIQUE INDEX chat_conversations_entry_unique
  ON chat_conversations (user_id, entry_id)
  WHERE scope = 'entry' AND entry_id IS NOT NULL AND workspace_id IS NULL;

CREATE UNIQUE INDEX chat_conversations_workspace_unique
  ON chat_conversations (user_id, workspace_id)
  WHERE scope = 'workspace' AND workspace_id IS NOT NULL;

CREATE TABLE chat_messages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id uuid NOT NULL REFERENCES chat_conversations(id) ON DELETE CASCADE,
  role text NOT NULL CHECK (role IN ('user','assistant','system')),
  content text NOT NULL,
  metadata jsonb NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX chat_messages_conversation_created_at_idx
  ON chat_messages (conversation_id, created_at DESC);
```

## API Endpoints
- POST /api/chat/conversations
  - Returns active conversation for scope (create if missing).
- GET /api/chat/conversations/:id/messages?cursor=<createdAt,id>&limit=<n>
  - Paginates older messages using a stable cursor (created_at + id).
  - Enforce max limit (e.g., 50) server-side.
- POST /api/chat/conversations/:id/messages
  - Append user/assistant message to conversation.
- DELETE /api/chat/conversations/:id/messages
  - Clear messages and reset summary for the conversation.
- POST /api/chat/conversations/:id/summary
  - Summarize older messages and update conversation summary (async).

## API Response Shapes (Example)
```json
// POST /api/chat/conversations
{ "conversation": { "id": "...", "scope": "global" } }

// GET /api/chat/conversations/:id/messages
{ "messages": [ { "id": "...", "role": "user", "content": "...", "createdAt": "..." } ], "nextCursor": "2025-01-01T00:00:00.000Z,uuid" }

// POST /api/chat/conversations/:id/messages
{ "message": { "id": "...", "role": "assistant", "content": "..." } }
```

## Message Metadata (Example)
```json
{
  "intent": "open_workspace",
  "options": [
    { "type": "workspace", "id": "...", "label": "Workspace 7" }
  ],
  "isError": false,
  "entryContext": { "id": "...", "name": "summary14 C" },
  "workspaceContext": { "id": "...", "name": "Workspace 7" }
}
```

## LLM Context Assembly (Client-Side)
- Build context payload with:
  - System prompt
  - Conversation summary (from chat_conversations.summary, loaded on init)
  - Last N user messages (e.g., 6-10)
  - Last assistant question (if any)
  - sessionState (current view, lastAction, openCounts)
- Do NOT include full history.

## Rolling Summary Strategy
- Trigger when new messages since summary exceed threshold (e.g., 10-15 messages).
- Summarize only messages older than the recent window.
- Store summary + summary_until_message_id.
- Cap summary length (e.g., 400-600 chars).
- Concurrency guard: update summary only if summary_until_message_id matches expected previous value.
- Run summarization asynchronously after responding; do not block the user response.

## Client Flow
1) On app load:
   - Request active conversation (scope default).
   - Fetch last N messages (e.g., 30-50).
2) Render chat with latest messages only.
3) "Show older messages" button loads more above, preserving scroll position.
4) On send:
   - Append user message via /api/chat/conversations/:id/messages.
   - Call /api/chat/navigate (LLM) with compact context (summary + recent window + sessionState).
   - Append assistant response via /api/chat/conversations/:id/messages.

## UI Behavior
- Default view: recent window only.
- "Show older messages" loads more above, preserving scroll position.
- Optional: summary banner at top ("Earlier summary...").

## Integrity and Security
- Never store secrets.
- All DB writes go through API routes.
- Conversation access scoped by user_id on every query; user_id must come from auth, never from client payload.
- sessionState remains session-only and is not persisted across reloads.

## Retention and Deletion
- Provide a user action to clear chat history.
- Default retention is indefinite; allow user-initiated deletion only.
- Clearing a conversation should delete both messages and summary.

## Migration Notes
- Future-proofing only (current chat is in-memory). If history exists later:
  - Backfill into chat_messages and attach to a single global conversation per user.
  - If duplicates exist, keep the newest conversation per scope and migrate messages, then delete extras.
  - After backfill, run a one-time summary generation for older messages to avoid large first-run prompts.

## Rollback Note
- If issues arise, disable history loading in the client while keeping the stored data intact; the APIs can remain in place for later re-enable.

## Implementation Steps
1) Add DB tables and indexes.
2) Implement conversation/message APIs.
3) Wire client to load recent messages and paginate older.
4) Add summary update job in API route.
5) Keep LLM context compact and server-side.

## Testing Checklist
- Reload restores chat history.
- "Show older messages" loads more without scroll jump.
- LLM requests only use summary + recent window + sessionState.
- Access control prevents cross-user reads.
- Long conversations still perform well.

## Isolation Reactivity Anti-Patterns
- Applicability: not applicable (no isolation provider changes).
- Compliance: no provider/consumer API drift introduced.
