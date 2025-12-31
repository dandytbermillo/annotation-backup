# Plan: Full Session Stats Compliance (Dedicated Table + Endpoints + Debounce + UI Tracking)

## Goal
Make session stats accurate and durable for a knowledge‑base app by implementing the full persistence plan:
- Dedicated `chat_session_state` table
- New session-state endpoints
- Debounced writes
- UI‑level entry + workspace tracking

## Summary of What This Enables
- “Did I open X?” works for entries and workspaces
- Stats survive reloads
- Counts are correct whether navigation happens via chat or UI

---

## 1) Database Schema (Dedicated Table)
Create a new table for session state.

### Migration
- `migrations/057_create_chat_session_state.up.sql`
- `migrations/057_create_chat_session_state.down.sql`

### Table Definition (proposed)
```
chat_session_state
- id (pk)
- conversation_id (fk -> chat_conversations.id)
- user_id
- session_state JSONB
- updated_at

Indexes:
- UNIQUE (conversation_id, user_id)
```

---

## 1.5) Migration from Current State
Because `chat_conversations.session_state` already exists (056), include a one‑time migration path:

Option A (preferred):
- Copy existing rows into the new table:
  - INSERT INTO chat_session_state (conversation_id, user_id, session_state, updated_at)
    SELECT id, user_id, session_state, NOW() FROM chat_conversations WHERE session_state IS NOT NULL;
- Keep `chat_conversations.session_state` for one release (backwards compat), then remove later.

Option B (clean):
- Copy existing rows, then drop the column in a follow‑up migration.

---

## 2) API Endpoints
Add dedicated endpoints for session state (separate from chat messages).

### GET
`GET /api/chat/session-state?conversationId=...`
- Returns session_state for conversation + user

### PATCH
`PATCH /api/chat/session-state/:conversationId`
- Body: { sessionState }
- Updates JSONB column and updated_at

Notes:
- Always use user_id from auth
- Return 404 if conversation/session row missing

---

## 3) Client: Hydration + Persistence
Update `ChatNavigationProvider` to use new endpoints.

### On init
- Load conversation ID (existing flow)
- Fetch session_state via new GET endpoint
- Hydrate:
  - openCounts
  - lastAction

### On update
- Persist session_state (debounced)
- Debounce interval: ~1s
- Flush pending writes on unload

---

## 4) Tracking (Single Source of Truth)
Ensure entry + workspace opens are counted consistently across chat and UI.

### Entry opens
- Centralize in entry navigation handler:
  - `components/dashboard/DashboardInitializer.tsx` (chat‑navigate‑entry handler)
- Increment openCounts(type='entry') on successful entry switch
- Set lastAction(type='open_entry')

### Workspace opens
- Centralize in workspace selection handler:
  - `components/dashboard/DashboardView.tsx` → `handleWorkspaceSelectById`
- Increment openCounts(type='workspace') on successful workspace switch
- Set lastAction(type='open_workspace')

### Chat vs UI
- Chat‑initiated navigation should flow through these same handlers
- Avoid double counting (only one increment per navigation)

### Home entry tracking
Decision: **Count go_home as opening Home entry**
- When go_home is executed, also increment openCounts(Home entry)

---

## 5) Resolver Updates (if not already complete)
- session_stats: match entry + workspace names (case‑insensitive)
- verify_action: handle open_entry + go_home
- last_action: format entry + workspace actions

---

## 6) Prompt Updates (if not already complete)
- “did I open X?” should check entries + workspaces
- “did I just open X?” should check lastAction
- Examples for entry names

---

## 7) Testing Checklist
1) Open entry (UI) → “did I open <entry>?” → yes
2) Open workspace (UI) → “did I open <workspace>?” → yes
3) Open entry via chat → counts increment once
4) Reload app → stats preserved
5) Entry + workspace same name → clarification
6) go home → counts as open_entry (Home)

---

## Rollback
- Disable session_state endpoints
- Remove dedicated table usage
- Fall back to in‑memory session state

---

## Success Criteria
- Durable stats across reloads
- Accurate counts from both chat and UI navigation
- No double counting
