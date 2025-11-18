# Missing Default Workspace (Note Workspaces)

## Summary
When the Note Workspace feature flag (`NEXT_PUBLIC_NOTE_WORKSPACES[_V2]`) was enabled in development, the UI occasionally showed an empty workspace list ("No saved workspaces yet") even though the backend still contained the seeded "Default Workspace" row. Because the toggle state was empty, the "Default Workspace" name disappeared and users could not switch to it.

## Root Cause
React Strict Mode runs `useEffect` twice on mount: once to execute and once to immediately clean up. In `useNoteWorkspaces`, the listing effect (`lib/hooks/annotation/use-note-workspaces.ts:746-804`) set `listedOnceRef.current = true` before starting the async fetch. During Strict Mode, the first run scheduled the fetch and then ran the cleanup, setting `cancelled = true`. When the fetch resolved, the `if (cancelled) return` guard prevented `setWorkspaces(list)`, so no workspaces were stored and no `list_success` debug log was emitted. On the second Strict pass the early `listedOnceRef` guard prevented the effect from running again, leaving the workspace list forever empty even though `/api/note-workspaces` responded with the default entry.

## Fix
Delay toggling `listedOnceRef` until the async list request has either succeeded or failed. We now:

1. Start the fetch without touching `listedOnceRef`.
2. When the request resolves (success or handled error) and `cancelled` is false, set `listedOnceRef.current = true` right before mutating state (`setWorkspaces(...)` or `setWorkspaces([])`).
3. If the cleanup fires first, `listedOnceRef` stays false, so the Strict Mode re-run can issue another fetch.

With this change, the hook survives the double-mount behavior, `workspaces` is populated from the backend, and the Note Workspace toggle shows "Default Workspace" again.

## File References
- `lib/hooks/annotation/use-note-workspaces.ts` – listing effect lines 746-793 now set `listedOnceRef` only after the fetch settles.
- `lib/adapters/note-workspace-adapter.ts` & `app/api/note-workspaces/seed-default/route.ts` – supporting seeding endpoint remains, but the Strict Mode guard was the blocker.

## Verification
1. Restart `npm run dev`.
2. Reload the app with the Note Workspace toggle enabled.
3. Observe `/api/note-workspaces` returning the default workspace and the UI showing "Default Workspace" in the toggle, without showing the empty-state message.
