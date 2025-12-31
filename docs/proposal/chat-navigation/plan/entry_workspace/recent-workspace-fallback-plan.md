# Plan: Recent Workspace Fallback (Entry → Global)

## Goal
Fix “open the last workspace I opened” when the user is on a different entry than the most recently opened workspace.

## Problem
Current behavior searches only within `currentEntryId`. If the last opened workspace belongs to another entry, the query returns none and the assistant says “No recent workspace found.”

## Proposed Behavior (3‑Step Resolution)
1) **SessionState lastAction** (highest accuracy)
   - If `lastAction.type === 'open_workspace'`, return that workspace immediately.

2) **Entry‑scoped recent** (current behavior)
   - Query recent workspaces within the current entry.

3) **Global fallback** (new)
   - If step 2 returns 0 results, query the most recent workspace across all entries.

---

## Why This Is Safe
- Preserves existing entry‑scoped behavior when it works.
- Global fallback only triggers when entry‑scoped is empty.
- No schema changes needed if `updated_at` already reflects “open”.

## Important Assumption
`note_workspaces.updated_at` must reflect “last opened.”
- If it is updated on **edit**, this can return a workspace that was edited most recently, not opened.
- If that’s the case, use sessionState lastAction (step 1) as the primary source of truth.

---

## Implementation Details
### Resolver flow (resolveRecentWorkspace)
- Add a fast path:
  - If `context.sessionState.lastAction?.type === 'open_workspace'`, return that workspace if it still exists.
- Keep existing entry‑scoped query.
- If entry‑scoped returns empty, run a global query:
  - Same filters (exclude defaults), no `item_id = currentEntryId`.
  - `ORDER BY updated_at DESC LIMIT 1`

---

## Edge Cases
- User has never opened a non‑default workspace → return “No recent workspace found.”
- Workspace was deleted → skip or return not found.
- Multiple entries → global fallback returns most recently opened overall.

---

## Testing Checklist
1) Open workspace in Entry A → go to Home → “open the last workspace I opened” → returns Entry A workspace.
2) No workspace in current entry → fallback works.
3) Entry‑scoped hit exists → fallback not used.
4) lastAction open_workspace exists → returns lastAction without DB query.

---

## Rollback
Remove the global fallback branch and lastAction fast‑path.

---

## Success Criteria
- “open the last workspace I opened” works across entries.
- No regressions for entry‑scoped recent behavior.
