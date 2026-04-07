# Chat Navigation Plan: Workspace Name Matching Priorities

## Problem

Workspace lookup currently uses `ILIKE '%term%'`, which over-matches.
Example: query `workspace 4` matches `summary14` because `14` contains `4`.
This leads to noisy disambiguation and poor UX.

## Goal

Prioritize exact and word-boundary matches first, and only fall back to
substring matches when no stronger match exists.

## Non-Goals

- No schema changes.
- No new indexes required.
- No changes to disambiguation UI beyond better match ordering/filtering.

## Proposed Matching Priority

1) **Exact match** (case-insensitive)
2) **Word-boundary match** (whole token match)
3) **Prefix match** (starts with term)
4) **Substring match** (current behavior, last resort)

Special case: numeric-only input should prefer whole-number matches
(`Workspace 4` beats `summary14`).

## SQL Ranking Strategy

Add a `match_rank` column in the resolver query:

```
CASE
  WHEN LOWER(nw.name) = $term THEN 0
  WHEN LOWER(nw.name) ~ $wordBoundary THEN 1
  WHEN LOWER(nw.name) LIKE $prefix THEN 2
  ELSE 3
END AS match_rank
```

Order by:
```
ORDER BY match_rank ASC, nw.updated_at DESC NULLS LAST
```

## Filtering Rule (Reduce Noise)

After fetching results, compute `bestRank = min(match_rank)` and
**filter to only results with that rank**.

Examples:
- If a word-boundary match exists (rank 1), discard prefix/substring matches.
- If only prefix matches exist (rank 2), discard substring matches.

This prevents `summary14` from appearing when `Workspace 4` is present.

## Query Parameter Details

For a search term `term`:

- `$term` = lowercased term (e.g., `4`, `workspace 4`)
- `$wordBoundary` = `\\y${safeTerm}\\y`
  - For numeric-only input, `\\y` ensures `4` does not match `14`.
- `$prefix` = `${term}%`

All patterns should be parameterized (no string interpolation).

### Regex Escaping (Required)

If `term` includes regex meta-characters (., *, +, ?, (, ), [, ], etc.),
escape before building `$wordBoundary`:

```
function escapeRegex(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}
const safeTerm = escapeRegex(term)
const wordBoundary = `\\\\y${safeTerm}\\\\y`
```

## Where to Apply

Update `buildQuery()` inside:
`lib/chat/workspace-resolver.ts`

Apply the same ranking to:
- entry-scoped search
- current-entry search
- global search

Also apply to `altSearchTerm` queries.

## Expected Behavior

| Input         | Matches Before         | Matches After (priority filter) |
|--------------|------------------------|----------------------------------|
| "4"          | Workspace 4, summary14 | Workspace 4 only                |
| "Sprint"     | Sprint 66, summary14   | Sprint 66 (prefix)              |
| "summary"    | summary14              | summary14                       |

## Anti-Pattern Compliance

Isolation/reactivity anti-patterns are **not applicable**. This change is
isolated to workspace name resolution queries.

## Manual Test Checklist

1) `workspace 4` → only “Workspace 4” appears in disambiguation.
2) `workspace 66` → matches “Sprint 66” over unrelated substrings.
3) `workspace summary` → matches workspaces starting with “summary”.
4) No match → unchanged “No workspace found.”

---

## Addendum: Persist Last Action Across Reloads

### Rationale

Today, `lastAction` is session-only. After a reload, queries like
"what is the last workspace I opened" return "no record." Persisting the most
recent action improves continuity without storing full activity logs.

### Scope

- Persist only the **latest action** (type, workspaceId/name, timestamp).
- User-scoped (single-user or user_id filtered).
- No change to UI or navigation logic.

### Safe Storage Options

Option A (preferred): Extend existing chat persistence:
- Add `last_action` JSON column to `chat_conversations` (migration).
- Update on every action (open/rename/delete/create/go_to_dashboard).
- Load into `sessionState.lastAction` on chat initialization.

Option B (alternate): Small dedicated table:
- `chat_last_action(user_id, last_action_json, updated_at)`
- Update on action; load at startup.

Future-proof (near future):
- If you decide to persist more than just the last action, migrate to a single
  `session_state` JSON column on `chat_conversations` and store additional
  ephemeral fields there (e.g., `openCounts`, `currentLocation`).

### Persistence Implementation Details (Last Action)

#### Migration
- Add migration file:
  - `migrations/055_add_last_action_to_conversations.up.sql`
  - `migrations/055_add_last_action_to_conversations.down.sql`
- SQL:
  - `ALTER TABLE chat_conversations ADD COLUMN last_action jsonb NULL;`

#### API Updates
- Extend existing conversation endpoint:
  - `app/api/chat/conversations/route.ts`
  - Include `last_action` in responses for POST/GET.
- Add update path (recommended):
  - New PATCH handler in `app/api/chat/conversations/[conversationId]/route.ts`
  - Body: `{ lastAction: {...} }`

#### Client Hook
- After `setLastAction(...)` in `components/chat/chat-navigation-panel.tsx`,
  call the PATCH endpoint to persist `last_action`.
- On chat init, load `last_action` from the conversation record and hydrate
  `sessionState.lastAction`.

#### Data Shape (JSON)
```
{
  "type": "open_workspace",
  "workspaceId": "uuid",
  "workspaceName": "Sprint 66",
  "timestamp": 1700000000000
}
```

### Restore Behavior

On app load:
- Read stored lastAction.
- Initialize `sessionState.lastAction` if present.

### Safety Notes

- Store only minimal fields already visible in the UI.
- Do not persist full action history unless explicitly needed.
