# Chat Navigation Phase 1 Plan: Workspace Operations (Current Entry Only)

## Scope
Implement four commands that operate only within the current entry (dashboard + workspace views):
- list_workspaces
- go_to_dashboard
- rename_workspace
- delete_workspace (with explicit confirmation)

## Decisions (Confirmed)
- Confirmation required for delete.
- Delete is permanent (hard delete from DB).
- Default workspace cannot be deleted.
- Confirmation via clickable pill only (not typing).
- Workspace list ordering: most recently updated first.
- Disambiguation required when multiple matches exist (force user selection).

## Goals
- Make workspace navigation and management easy for non-technical users.
- Keep LLM actions deterministic and safe.
- Avoid UI or panel behavior changes.

## Non-Goals
- No cross-entry operations.
- No panel hide/resize/move behavior changes.
- No persistence of chat history across reloads.

## User Experience Behavior
- List requests show clickable workspace pills (Quick Links style) with clear sublabels.
- Rename and delete requests with ambiguous matches show a list and require explicit selection.
- Delete always requires confirmation via clickable pill.
- go_to_dashboard only acts when the user is currently in workspace view; otherwise returns "not supported yet".

## Intent Additions
Add these intents and examples:
- list_workspaces
  - "list workspaces"
  - "show all workspaces"
  - "what workspaces do I have?"
- go_to_dashboard
  - "go to dashboard"
  - "back"
  - "exit workspace"
- rename_workspace
  - "rename workspace X to Y"
  - "change workspace name to Y"
- delete_workspace
  - "delete workspace Sprint 5"
  - "remove workspace Old"

## Data Requirements
- Workspace list within current entry, ordered by updatedAt desc.
- Workspace lookup by name within current entry.
- Workspace rename by ID.
- Workspace delete by ID.

## API Strategy
- All DB reads/writes go through existing API routes.
- No direct SQL in client code.
- Prefer adding query params to existing endpoints where feasible.

## Resolver Behavior
### list_workspaces
- Resolve current entry context.
- Fetch workspaces ordered by updatedAt desc.
- Return selection options with labels + sublabels:
  - label: workspace name
  - sublabel: last updated time + note count (if available)

### go_to_dashboard
- If view mode is workspace, trigger navigation to entry dashboard.
- If already on dashboard, return "Not supported yet" with help text.

### rename_workspace
- Resolve name match within current entry.
- If multiple matches, return selection list.
- If single match, require new name from intent.
- Block rename if new name collides (exact match within entry).

### delete_workspace
- Resolve name match within current entry.
- **Block deletion of default workspace** with error: "Cannot delete the default workspace."
- If multiple matches, return selection list.
- If single match, return confirmation prompt with "🗑️ Confirm Delete" pill.
- Only perform deletion after user clicks confirmation pill.
- If deleting current workspace, navigate to dashboard after deletion.

## Confirmation Flow (Delete)
- Step 1: LLM returns intent "delete_workspace" with target name.
- Step 2: Resolver returns action "confirm_delete" with workspace info and "🗑️ Confirm Delete" pill.
- Step 3: User clicks the "🗑️ Confirm Delete" pill.
- Step 4: API performs permanent deletion and returns success message.
- Step 5: If deleted workspace was current, navigate to dashboard.

## Disambiguation Rules
- If multiple matches for workspace name, always show selectable options.
- Options must be scoped to current entry only.
- If selection is made, proceed without re-querying name.

## Error Handling
- If no match found: respond "Not found in this entry" and show list_workspaces suggestion.
- If rename conflict: respond "Name already exists" and show the list.
- If attempting to delete default workspace: respond "Cannot delete the default workspace."
- If delete fails: respond with error and suggest retry.

## Testing Checklist
- list_workspaces returns only current entry workspaces, ordered by updatedAt.
- rename_workspace works for unique match, blocked for duplicate name.
- delete_workspace requires confirmation pill click and never deletes without it.
- delete_workspace blocks default workspace with clear error message.
- After deleting current workspace, user is navigated to dashboard.
- go_to_dashboard works only from workspace view.
- Disambiguation shows a selection list when multiple matches.

## Implementation Steps
1) Update intent schema with 4 new intents and argument shapes.
2) Update intent prompt with examples and disambiguation rules.
3) Add resolver handlers for list, rename, delete, and dashboard nav.
4) Add workspace resolver functions for list, lookup, rename, delete (entry scoped).
5) Add action handlers and confirmation handling in use-chat-navigation.
6) Add tests for resolution logic (unit or integration).

## Isolation Reactivity Anti-Patterns
- Applicability: not applicable (no isolation provider changes).
- Compliance: no new provider/consumer API drift introduced in this phase.
