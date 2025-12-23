# Chat Navigation Pain Points (Proposal)

## Purpose
Define a chatbox experience that addresses top navigation pain points for non-technical users without changing panel layout or UI chrome. The focus is on opening and creating workspaces/notes quickly and safely.

## Scope (v1)
- Open workspace by name (including dashboard).
- Open note by title.
- Create workspace.
- Use clickable selection pills in chat for ambiguous results (Quick Links style).
- Truthful unsupported responses when a request is outside scope.

## Out of Scope
- Panel layout changes (hide/resize/move/reposition).
- Panel content manipulation (handled in a separate proposal).
- One-line SQL or arbitrary DB queries.
- Webview/iframe panels.

## Pain Points Addressed
- Users do not know exact workspace or note names.
- Multiple workspaces share similar names.
- Non-technical users struggle with navigation flows.
- Need to reduce friction to reach the right workspace/note.

## Supported Intents
### 1) Open Workspace by Name
User examples:
- "open workspace Research"
- "go to dashboard"
- "open workspace Marketing in Entry Alpha"

Behavior:
- Search workspaces in the current entry by default.
- Include the entry dashboard workspace as a valid target.
- If the user mentions an entry, search within that entry.
- If no match or multiple matches, present clickable pills and ask the user to pick.

### 2) Open Recent Workspace
User examples:
- "open my recent workspace"
- "go to last workspace"

Behavior:
- Use the most recent workspace for the current entry.
- If no recent workspace is available, show a brief message and offer to list workspaces.
- If multiple recent results are requested (e.g., \"show recent workspaces\"), present clickable pills.

### 2) Open Note by Title
User examples:
- "open note Project Plan"
- "find note Roadmap in this workspace"

Behavior:
- Default scope is the current workspace to avoid accidental jumps.
- If the user mentions an entry or workspace, use that scope.
- If multiple matches, show clickable pills and ask the user to select.
- If no matches, offer to broaden scope.

### 3) Create Workspace
User examples:
- "create workspace Sprint 12"
- "new workspace"

Behavior:
- Create the workspace in the current entry.
- If the user provides a name, create it directly.
- If the user does not provide a name, ask for one or suggest a default.
- After creation, optionally navigate to it (see Open Decisions).

## Disambiguation and Selection UI
When a prompt yields multiple matches, show clickable pills in the chatbox output.

Pill label rules:
- If the prompt mentions entry or dashboard, label each pill as `Entry / Workspace`.
- If the prompt mentions only workspace, label each pill as `Workspace`.
- If multiple entries share the same workspace name and the prompt mentions only workspace,
  show a small secondary entry label for disambiguation.

Each pill carries `entryId` and `workspaceId` and triggers the same navigation flow as Quick Links.

## Confirmation and Safety
Confirmations are most useful when there is no recent conversation context tied to the request.

Recommended rules:
- Always confirm destructive or layout-changing actions (not in v1).
- For create actions:
  - If the user provided an explicit name, proceed without confirmation.
  - If no name was provided or the request is ambiguous, ask for confirmation.
- If multiple matches exist, require explicit selection.

## Unsupported Requests
If a prompt does not map to supported intents, respond with:
"That request is not supported yet. I can help with: open workspace, open note, create workspace."
Do not change any UI state.

## Data and API Notes
- All DB reads and writes must go through API routes.
- Use existing navigation flows for workspace switching.
- Any new search endpoints must be read-only, parameterized, and allowlisted.

## Open Decisions
- Note search scope default: current workspace only, or allow current entry by default?
- After create workspace: auto-switch to the new workspace or stay?
- Should "dashboard" always map to the current entry dashboard, or allow other entries when named?
