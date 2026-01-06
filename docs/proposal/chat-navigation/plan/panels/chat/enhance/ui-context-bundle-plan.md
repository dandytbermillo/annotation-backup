# UI Context Bundle Plan

## Goal
Make the LLM aware of what the user can see and act on right now in the current dashboard/workspace (widgets, drawers, floating docks, open notes/components) so conversational questions reference the actual UI state.

## Non-Goals
- Do not send full content bodies (note text, large lists, HTML).
- Do not introduce new global state storage; use existing in-memory UI state.
- Do not change navigation behavior or selection logic (this plan is context-only).

## Core Idea
Add a **UIContext** bundle to the existing conversation context sent to the LLM. The bundle is a structured, minimal snapshot of current dashboard/workspace state.

This should be **metadata-only** (IDs, titles, types, counts) so it is safe, fast, and stable.

## UIContext Shape (Draft)
```json
{
  "uiContext": {
    "mode": "dashboard" | "workspace",
    "dashboard": {
      "entryId": "...",
      "entryName": "...",
      "visibleWidgets": [
        { "id": "quick-links-d", "title": "Quick Links D", "type": "quick_links" },
        { "id": "recent", "title": "Recent", "type": "recent" }
      ],
      "openDrawer": { "panelId": "quick-links-d", "title": "Quick Links D" },
      "floatingDock": { "open": true, "items": ["Navigator", "Capture"] }
    },
    "workspace": {
      "workspaceId": "...",
      "workspaceName": "...",
      "openNotes": [
        { "id": "note-1", "title": "Project Plan", "active": true },
        { "id": "note-2", "title": "Meeting Notes", "active": false }
      ],
      "activePanelId": "note-1"
    }
  }
}
```

## Data Sources
- **Dashboard state**: `DashboardView` widget list, open drawer panel, current entry, focused panel.
- **Workspace state**: workspace toolbar/dock, open note list, active note/panel.
- **Floating dock state**: minimal open/closed + visible item labels.

## How It Is Built
- Build UIContext during chat request (client-side) using current React state.
- Send in `conversationContext.uiContext` with the existing chat request payload.
- Keep payload small (IDs, titles, counts, booleans).

## Recency / Staleness
- UIContext is **live**, not historical. No decay window needed.
- ChatContext remains the source for historical questions (“what did you show earlier?”).

## Prompt Guidance (LLM)
Add a short rule in the prompt:
- If the user asks about what is currently visible or open, use `uiContext`.
- If the user asks about previously shown items, use `chatContext`.
- If neither contains the answer, use `need_context` or `retrieve_from_app`.

## Safety / Privacy
- Do not include raw note content.
- Do not include full lists for large widgets (only counts or first N names).
- Keep `openNotes` titles only, capped to last 5.

## Implementation Checklist
- Identify UI state sources for dashboard and workspace (single place for each field).
- Enforce caps (visibleWidgets max 10, openNotes max 5, floatingDock items max 5).
- Populate only the active mode branch (dashboard OR workspace).
- Include open drawer metadata when a drawer is visible.
- Add `uiContext` to the chat request payload.
- Add prompt guidance for UIContext priority.
- Validate payload size stays small (no content bodies).

## Acceptance Tests
1. Dashboard: open Quick Links D drawer → ask “what’s open on the right?” → answer uses `uiContext.openDrawer`.
2. Dashboard: visible widgets include Recent + Quick Links D → ask “which widgets are here?” → answer lists those titles.
3. Workspace: open notes list contains “Project Plan” → ask “what notes are open?” → answer lists open notes.
4. Workspace: active note is “Project Plan” → ask “what note am I in?” → answer uses `uiContext.workspace.activePanelId` mapping.

## Rollout Plan
1. Add `uiContext` to conversation payload in chat request.
2. Add prompt rules for UIContext usage.
3. Keep strict size limits to avoid token bloat.
4. Test with dashboard and workspace flows.

## Notes
- This does **not** replace ChatContext; both are needed.
- UIContext is strictly about **current visibility**, not history.
