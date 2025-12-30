# Chat Navigate: Conditional Context Fetch Optimization

## Summary

The `/api/chat/navigate` route currently fetches `homeEntryId` and
`currentEntryName` on every request. These lookups are only needed for
`go_home` and `go_to_dashboard` ("already on X" detection), so we can
avoid unnecessary DB work for other intents.

## Goals

- Reduce per-request DB queries for unrelated intents.
- Preserve existing behavior for `go_home` and `go_to_dashboard`.
- Keep implementation small and safe (no new endpoints).

## Non-Goals

- No semantic changes to intent routing.
- No caching or persistence changes.
- No UI changes.

## Proposed Behavior

After the LLM intent is parsed:

- **If intent is `go_home`:**
  - Fetch `homeEntryId` (needed to detect "already on Home").
  - `currentEntryName` not required.

- **If intent is `go_to_dashboard`:**
  - Use `sessionState.currentEntryName` if available.
  - Otherwise fetch `currentEntryName` by `currentEntryId`.
  - `homeEntryId` not required.

- **All other intents:**
  - Skip both lookups.

## Implementation Outline

1) Parse intent with LLM (unchanged).
2) Determine required context:
   - `needsHomeEntry = intent.intent === 'go_home'`
   - `needsEntryName = intent.intent === 'go_to_dashboard'`
3) Resolve context values:
   - `currentEntryName = sessionState.currentEntryName || (needsEntryName ? fetchEntryName(currentEntryId) : undefined)`
   - `homeEntryId = needsHomeEntry ? fetchHomeEntryId(userId) : undefined`
4) Build `resolutionContext` with only required values.
5) Resolve intent (unchanged).

## Safety Notes

- Queries remain parameterized and user-scoped.
- For missing IDs, behavior stays consistent (no-op with clear messaging).
- This optimization is strictly additive: it skips work, does not alter
  returned data for the two affected intents.

## Anti-Pattern Compliance

Isolation/reactivity anti-patterns are not applicable. No provider or
UI subscription changes are introduced.

## Minimal Test Checklist

1) `go_home` from non-Home entry:
   - Still navigates to Home dashboard.
2) `go_home` while already on Home:
   - "You're already on the Home dashboard."
3) `go_to_dashboard` while already on dashboard:
   - "You're already on <entryName>'s dashboard."
4) Other intents (e.g., open workspace):
   - No change in behavior; no extra DB fetch required.
