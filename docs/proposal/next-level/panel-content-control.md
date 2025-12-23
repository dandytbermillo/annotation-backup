# Panel Content Manipulation via Chatbox (Proposal)

## Purpose
Define how a chatbox can manipulate dashboard panel content (not layout) using predictable, allowed filters. Start with the Recent panel and expand later. This keeps UI consistent and avoids LLM-generated layouts.

## Scope (v1)
- Target panel: Recent panel only.
- Focus: content manipulation only (no hide/resize/move/reposition).
- UI: unchanged; use existing panel rendering and styles.
- Data: fetched via API routes (no direct DB access from the browser).

## Non-goals
- No changes to panel layout, size, or visibility.
- No webview/iframe panels.
- No one-line SQL query support.
- No exposing arbitrary DB fields as query params.

## Current System Context
- Entry dashboard renders panels as React components.
- Panels use API routes for data.
- Recent panel fetches from `/api/dashboard/recent` and reads `panel.config.limit`.
- Panel config updates are persisted via `/api/dashboard/panels/:id` (PATCH).

## Design Principles
1) Predictable UI
   - Panels are React components, not LLM-generated HTML.
   - Recent panel appearance remains consistent across sessions.

2) Content-only control
   - Chatbox can change what is shown, not the panel container.
   - All changes are done through panel config updates.

3) Allowlisted filters
   - Only explicit, supported filters are accepted.
   - Unsupported requests return a truthful "not supported yet" response.

4) Server-backed data
   - All DB reads go through API routes.
   - The chatbox does not execute SQL or access DB directly.

## Chatbox Behavior
### Supported request types (v1)
- Content-only adjustments for the Recent panel.
- Examples:
  - "show only three entries in the recent panel"
  - "recent for entry Alpha, last 7 days"
  - "sort recents alphabetically"

### Unsupported request handling
If a prompt does not map to supported filters:
- Reply: "That request is not supported yet. I can help with: limit, entry filter, time window, sort." (exact wording can vary).
- Do not change the panel state.

### Selection UI for ambiguous results
When a prompt yields multiple matches (e.g., workspace name collision), show clickable pills that follow the Quick Links panel pattern.

Label rules:
- If the prompt mentions entry or dashboard, label each pill as `Entry / Workspace`.
- If the prompt mentions only workspace, label each pill as `Workspace`.
- If multiple entries share the same workspace name and the prompt mentions only workspace, show a small secondary entry label for disambiguation.

Behavior:
- Each pill carries `entryId` and `workspaceId`.
- Clicking a pill navigates directly to that workspace.

## Interchangeable Filters (Order-Independent)
Filters are interchangeable in user phrasing. The chatbox accepts any order and normalizes to a canonical object.

Examples:
- "show 3 recent for Entry A last 7 days"
- "last 7 days, entry A, show 3"
Both should normalize to the same filter object.

## Canonical Filter Object (Recommended)
All supported filters are normalized to a stable object that the UI and API understand.

Canonical shape (Recent panel):
```
{
  limit: number,
  entryId: string,
  since: string, // ISO date
  until: string, // ISO date
  sort: "recent" | "alpha"
}
```

Normalization rules:
- Extract only allowlisted fields.
- Coerce types ("3" -> 3, "last 7 days" -> since/until or days -> since).
- Resolve conflicts:
  - If entryId and entryName both present, prefer entryId.
  - If both days and explicit since/until present, return "not supported yet".
- Apply defaults when missing (e.g., sort = "recent").
- Unknown fields trigger "not supported yet" response.

## API Contract (Recent panel)
Extend `/api/dashboard/recent` with optional query params:
- `limit` (number)
- `entryId` (string)
- `since` (ISO date)
- `until` (ISO date)
- `sort` ("recent" | "alpha")

Notes:
- Backward compatible with existing usage.
- Server must validate and clamp values.
- Use parameterized queries only.

## Panel Config Contract (Recent panel)
Persist supported filters in `panel.config`:
- `limit`
- `entryId`
- `since`
- `until`
- `sort`

Config updates use existing `/api/dashboard/panels/:id` PATCH flow.
The panel reads config and builds the query params for `/api/dashboard/recent`.

## Data Flow (v1)
1) User enters prompt in chatbox.
2) Chatbox parses intent and extracts filters.
3) Filters normalize to canonical object.
4) If supported: update panel config via `/api/dashboard/panels/:id`.
5) Recent panel fetches `/api/dashboard/recent` with query params.
6) UI updates with new content, no layout changes.

## Example Normalizations
Prompt:
- "show only three entries in the recent panel"
Normalized:
```
{ limit: 3, sort: "recent" }
```

Prompt:
- "recent for Entry Alpha, last 7 days"
Normalized:
```
{ entryId: "<resolved-id>", since: "<iso>", sort: "recent" }
```

Prompt:
- "sort recents alphabetically"
Normalized:
```
{ sort: "alpha" }
```

## Security and Stability
- Do not allow free-form SQL or arbitrary table/field selection.
- Only allow explicit, validated filters.
- Prefer read-only DB access in API routes.
- Keep API contracts stable and versioned via allowlist growth.

## Future Expansion (Post-v1)
- Add content-only controls for other panels using the same canonical pattern.
- Extend intent mapping with a strict allowlist per panel.
- Optional chat-only responses for cross-panel or summary queries (no panel change).

## Explicit Exclusions
- One-line SQL queries are not supported.
- Panel layout manipulation is out of scope.
- UI redesign is out of scope for this phase.
