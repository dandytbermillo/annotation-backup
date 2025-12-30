# Chat Navigation Plan: Home vs Dashboard Intent

## Scope
Add a new intent that routes "home" navigation to the global Home entry, while
preserving the existing "go to dashboard" behavior for the current entry.

## Definitions (Canonical)
- **Home entry**: the single global root entry (one per user).
- **Current entry**: the entry the user is currently viewing (e.g., "summary14").
- **Dashboard view**: the panel grid view for the current entry.
- **Workspace view**: canvas/notes view inside a specific workspace.

## Goals
- Remove confusion between "dashboard" (view mode) and "home" (global entry).
- Make "go home" always navigate to the Home entry's dashboard.
- Keep "go to dashboard" scoped to the current entry.
- Provide clear feedback when user is already at the target.

## Non-Goals
- No changes to workspace/entry creation.
- No changes to Quick Links parsing or storage.
- No changes to panel layout or rendering.

## Intent Changes

### 1) New intent: `go_home`
Examples:
- "go home"
- "back home"
- "home"
- "take me home"
- "return home"
- "main dashboard"
- "home dashboard"

### 2) Existing intent: `go_to_dashboard`
Examples (unchanged meaning, but remove "home"):
- "go to dashboard"
- "back"
- "exit workspace"
- "return to dashboard"

## Routing Rules (Prompt)

- If the message includes "home" or "main dashboard" with no qualifier
  → `go_home`
- If the message includes "dashboard", "back", or "exit workspace"
  → `go_to_dashboard`
- If the message explicitly says "home of this entry" or "dashboard for this entry"
  → `go_to_dashboard`
- If both "home" and "dashboard" appear but the user intent is unclear,
  ask a clarification question:
  "Do you mean the Home entry, or the current entry's dashboard?"

## Resolver Behavior

### `go_home`
1) Resolve Home entry + dashboard workspace:
   - Prefer cached values (from DashboardInitializer state/context).
   - Fallback: GET `/api/dashboard/info` to obtain:
     - `homeEntryId`
     - `dashboardWorkspaceId`
2) If already on Home dashboard, return:
   - "You're already on the Home dashboard."
3) Otherwise navigate:
   - Dispatch `chat-navigate-entry` with `{ entryId: homeEntryId, dashboardId }`.

### `go_to_dashboard` (existing)
1) If already in dashboard view for current entry:
   - "You're already on <entryName>'s dashboard."
2) Otherwise, dispatch `chat-navigate-dashboard` (existing behavior).

## Data Requirements
- `homeEntryId` and `dashboardWorkspaceId` from `/api/dashboard/info`.
- `currentEntryId` and `currentEntryName` from existing chat context.
- View mode (`dashboard` vs `workspace`) from existing context.

## API Dependencies
- GET `/api/dashboard/info` (already exists).

## UI/Copy Updates
Replace generic responses like "You're already on the dashboard" with:
- "You're already on summary14's dashboard."
- "You're already on the Home dashboard."

## Anti-Pattern Compliance
Isolation/reactivity anti-patterns are **not applicable** here. This plan does
not introduce new provider APIs or UI gating in the isolation subsystem.

## Testing Checklist
1) From workspace view, "go to dashboard" → current entry dashboard.
2) From summary14 dashboard, "go to dashboard" → "already on summary14's dashboard."
3) From summary14 dashboard, "go home" → Home entry dashboard.
4) From Home dashboard, "go home" → "already on the Home dashboard."
5) Ambiguous phrasing ("home dashboard here") → clarification prompt.

## Implementation Steps
1) Update intent schema to include `go_home`.
2) Update prompt routing rules:
   - Remove "home" from `go_to_dashboard`.
   - Add examples for `go_home`.
3) Add resolver handler for `go_home`:
   - Resolve Home entry and dashboard workspace.
   - Dispatch `chat-navigate-entry`.
4) Update response copy to include entry name.
5) Manual testing per checklist.
