# Chat Navigation Pain Points — Implementation Plan

## Goal
Implement LLM-driven, low-risk navigation commands that reduce friction for non-technical users without changing panel layout or UI chrome.

Primary intents (v1):
- Open workspace by name (including dashboard)
- Open recent workspace
- Open note by title
- Create workspace

All unsupported requests must return a truthful “not supported yet” response with the list of supported actions.

## Constraints
- No panel layout changes (hide/resize/move).
- No panel content manipulation in this phase.
- No one-line SQL or arbitrary DB queries.
- All DB access via API routes only.
- Actions are allowlisted and validated; LLM is for intent parsing only.

## Checklist (Decided)
| Item              | Decision                                  |
|-------------------|-------------------------------------------|
| LLM required      | Yes (not pattern matching)                |
| Provider          | gpt-4.1-mini or gpt-4o-mini (default)      |
| Temperature       | 0                                         |
| Max tokens        | ~200                                      |
| Schema validation | Strict, server-side (Zod)                 |
| Response format   | JSON schema mode (fallback to JSON mode)  |

## Checklist (Open Decisions)
| Decision                  | Options                                 | Recommendation     |
|---------------------------|-----------------------------------------|--------------------|
| Note search scope default | Current workspace vs current entry      | Current workspace  |
| Auto-switch after create  | Yes vs No                               | Yes                |
| Dashboard mapping         | Current entry only vs allow cross-entry | Current entry only |

## Feature Flag Policy
- New features ship enabled by default.
- Temporary gating is allowed only for short verification windows with a documented removal timeline.

## Phase 0 — Prep and Discovery
1) Inventory current navigation paths and APIs
   - Workspace list for entry (exists: `/api/entries/:id/workspaces`)
   - Dashboard info (exists: `/api/dashboard/info`)
   - Recent workspaces endpoint (exists: `/api/dashboard/recent`)
   - Workspace creation endpoint (exists: `/api/note-workspaces`)
   - Note search endpoint (unknown; add if missing)
   - Existing LLM integration (unknown; confirm)

2) Confirm UX rules
   - Label rules for clickable pills in chat
   - Confirmation rules for ambiguous or unsafe actions
   - Default note search scope (current workspace vs entry)
   - Auto-switch after create workspace (yes/no)

3) Provider check (before commit)
   - Run a small latency/cost eval on the chosen model with the intent prompt.
   - If gpt-4.1-mini is available, compare against gpt-4o-mini.

## Phase 1 — LLM Intent Interface
### 1.1 Intent schema (allowlist)
Define a strict JSON schema for the LLM to return. Example:
```
{
  intent: "open_workspace" | "open_recent_workspace" | "open_note" | "create_workspace" | "unsupported",
  args: {
    workspaceName?: string,
    entryName?: string,
    noteTitle?: string,
    workspaceNameHint?: string,
    explicitName?: string
  }
}
```
Rules:
- Any output not matching schema becomes `unsupported`.
- LLM is not allowed to select IDs or run queries.
- LLM may supply name hints only.

### 1.2 LLM prompt contract
- System prompt: list the supported intents and what fields are allowed.
- Return JSON only.
- If the user asks for anything else, return `unsupported` with a short reason.

### 1.3 Server-side validation
- Validate schema with Zod (or existing validation utilities).
- Reject or downgrade to `unsupported` on any mismatch.

## Phase 2 — Data Resolution Layer
### 2.1 Workspace resolution
Inputs:
- workspaceName, entryName (optional)
- currentEntryId, currentWorkspaceId

Behavior:
- Default scope: current entry.
- If entryName is provided, resolve it to entryId; if ambiguous, return selection list.
- Include “Dashboard” as a valid workspace target for the entry.
- If multiple matches, return list for user selection.

### 2.2 Recent workspace
- Use existing recent endpoint for the current entry.
- If empty, respond with “no recent workspace” and offer to list workspaces.

### 2.3 Note resolution
Inputs:
- noteTitle, optional entry/workspace hints

Behavior:
- Default scope: current workspace (unless user specifies otherwise).
- If multiple matches, return selection list.
- If no match, offer to broaden scope.

If no note search API exists:
- Add a read-only endpoint with allowlisted search parameters.
- Return note id, title, workspace id, entry id.

## Phase 3 — Action Execution
### 3.1 Open workspace
- Use existing navigation flow (same as Quick Links navigation):
  - Set active entry context (if needed)
  - Navigate to dashboard/workspace via existing hooks

### 3.2 Open note
- Navigate to its workspace first
- Then open the note in that workspace (existing note opening mechanism)

### 3.3 Create workspace
- Call existing POST `/api/note-workspaces` with the resolved entry id and name
- If no explicit name given, ask for confirmation or provide a suggestion
- Optionally auto-switch to the newly created workspace (decision)

## Phase 4 — Chat UI Integration
### 4.1 Chatbox placement
- Place on the entry dashboard (top-left area as requested)
- Input is controlled; submit triggers intent parsing
- No new UI design required; reuse existing styling

### 4.2 Clickable selection pills
- Render Quick Links style pills in chat when multiple matches
- Label rules:
  - If prompt mentions entry/dashboard: `Entry / Workspace`
  - If prompt mentions only workspace: `Workspace`
  - If workspace name collides across entries: show a small secondary entry label
- Each pill carries `entryId` + `workspaceId` and triggers navigation

### 4.3 Response messaging
- Unsupported: “Not supported yet…” + list supported actions
- Ambiguous: “Multiple matches. Choose one:” + pills
- Success: short confirmation text (optional)

## Phase 5 — Safeguards and Confirmation
- If no recent context and the request is ambiguous, require user selection
- If multiple matches, require explicit selection
- For create workspace:
  - If name was explicitly provided, proceed
  - If missing or inferred, confirm first

## Phase 6 — Testing & Verification
- Manual tests:
  - Open workspace by name (unique, ambiguous, not found)
  - Open dashboard
  - Open recent workspace
  - Open note by title (unique, ambiguous, not found)
  - Create workspace (explicit name, no name)

- API tests (if present):
  - Validate intent schema parsing
  - Note search endpoint (if added)

## Deliverables
- LLM intent handler (API route + schema validation)
- Resolution layer for workspace/note lookup
- Chatbox UI with selection pills
- Documentation updates

## Open Decisions (Must Confirm)
- Default note search scope: current workspace or current entry?
- Auto-switch after create workspace: yes/no?
- Use existing recent endpoint only, or add a lightweight “recent by entry” helper?
