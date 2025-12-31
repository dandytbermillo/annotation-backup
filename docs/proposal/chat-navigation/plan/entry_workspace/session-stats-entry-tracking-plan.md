# Plan: Session Stats for Entry + Workspace Opens

## Purpose
Ensure questions like “Did I open summary14?” return correct results when **summary14 is an entry**, not just a workspace. Use session state as the source of truth (never infer from chat transcript). Persist stats across reloads using a dedicated table.

## Outcomes
- Entry opens are tracked alongside workspace opens.
- “did I open X?” checks **entry + workspace**.
- “did I just open X?” checks **lastAction** regardless of type.
- Clear disambiguation when entry/workspace names collide.
- Session stats persist across reloads in a separate table.

---

## Scope
- Track entry opens in session state.
- Extend lastAction to include entry opens.
- Update session_stats + verify_action to consider entries.
- Persist session state in a dedicated table (not chat_conversations).

## Non‑Goals
- No inference from chat logs.

---

## Data Model Updates
### SessionState
Recommendation: unified counts with type.
```
openCounts: { [id]: { type: 'workspace' | 'entry', name, count } }
```

### lastAction
Extend with entry opens:
```
lastAction.type: 'open_entry' | 'open_workspace' | ...
lastAction.entryId?, lastAction.entryName?
```

---

## Persistence (Dedicated Table)
Create a new table to store session state per conversation/user.

### Proposed Table: chat_session_state
Columns:
- id (pk)
- conversation_id (fk -> chat_conversations.id)
- user_id
- session_state JSONB
- updated_at

### Migration
- `migrations/056_create_chat_session_state.up.sql`
- `migrations/056_create_chat_session_state.down.sql`

### Behavior
- On load: fetch session_state for current conversation → hydrate in client context.
- On update: persist when lastAction or openCounts change (debounced, ~1s).
- On unload: flush pending updates.
- On reset/clear: delete or reset session_state row for the conversation.

---

## API Endpoints
- `GET /api/chat/session-state?conversationId=...` → load on mount
- `PATCH /api/chat/session-state/:conversationId` → save updates (debounced)

Notes:
- Use PATCH to avoid overwriting if fields expand later.
- Server trusts user_id from auth, never from client payload.

---

## Tracking Entry Opens (Single Source of Truth)
### Where to increment
- Centralize in the entry navigation handler that **actually switches entries** (e.g., the place that handles `chat-navigate-entry` and/or the entry selection handler used by UI clicks).
- This ensures both chat‑initiated navigation and UI clicks increment the same counter.

### When to increment
- After the entry change is confirmed (e.g., entryId is set and dashboard/workspace view updates).
- Avoid double counting by ensuring only one handler increments per navigation.

### Home Entry
- Navigating to Home counts as opening the Home entry.

---

## Resolver Behavior
### session_stats
When the user asks “did I open X?” or “how many times did I open X?”

Steps:
1) Match X against entry names + workspace names (case‑insensitive).
2) If only entry matches → report entry count
3) If only workspace matches → report workspace count
4) If both match → ask clarification: “Entry or workspace?”

Examples:
- “Yes, you opened entry ‘summary14’ 1 time this session.”
- “Yes, you opened workspace ‘summary14’ 2 times this session.”

### verify_action
When user asks “did I just open X?”
- Check lastAction type:
  - open_entry → respond with entry context
  - open_workspace → respond with workspace context

---

## Prompt Updates
Add explicit guidance:
- “did I open X?” should check **entries and workspaces**
- “did I just open X?” should check **lastAction** regardless of type

Add examples:
- “did I open summary14?” → session_stats (entry/workspace)
- “did I just open summary14?” → verify_action

---

## UI/UX Messages
- Ambiguity: “Do you mean the entry ‘summary14’ or the workspace ‘summary14’?”
- No record: “I don’t have a record of opening entry ‘summary14’ this session.”

---

## Testing Checklist
- Open entry “summary14” → “did I open summary14?” → yes (entry).
- Open workspace “Sprint 66” → “did I open Sprint 66?” → yes (workspace).
- Entry + workspace share name → clarification question.
- “did I just open summary14?” → verify_action returns last action type.
- UI click to entry (not chat) still increments entry count.
- Reload app → stats still available (via chat_session_state).
- Open Home → “did I open Home?” → yes (entry).

---

## Rollback
- Remove entry tracking fields and persistence; fall back to workspace‑only stats.

---

## Success Criteria
- Entry opens are recorded and reported correctly.
- No reliance on chat transcript for action verification.
- Stats survive reloads via dedicated table.
- Clear disambiguation when entry and workspace names collide.
