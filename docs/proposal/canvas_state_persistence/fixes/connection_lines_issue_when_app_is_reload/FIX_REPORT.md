# Connection Lines Hydration Fix

## Root Cause
- Postgres still stored legacy branch panel rows under raw UUID panel IDs (e.g. `ea0ec3a5-c258-…`) while the renderer expects `branch-…` keys.
- The workspace hydrator and the plain-mode localStorage replay each wrote those raw IDs back into the shared `dataStore` during initial load.
- `WidgetStudioConnections`/`ConnectionLines` build composite keys with `branch-<uuid>` (`noteId::branch-…`). When the stores only contained the raw UUID entries, the lookup failed and the SVG connections were skipped.
- On reloads where a cached snapshot happened to run first (already prefixed IDs), connections appeared; otherwise, they disappeared. This produced the alternating “visible / missing” behavior.

## Fix
1. **Normalize panel IDs whenever we hydrate from the workspace API** (`components/canvas/canvas-workspace-context.tsx`):
   - Added helpers to coerce both `panelId` and `parentId` into UI format (`branch-…` / `main`).
   - Migrated any legacy entries in the shared `dataStore` to the normalized composite key and rewrote branch lists so child panels reference the normalized IDs.
2. **Normalize IDs when replaying the plain-mode localStorage snapshot** (`components/canvas/canvas-context.tsx`):
   - Parsed stored keys, re-keyed panels with `ensurePanelKey` + normalization, updated `parentId`, branch arrays, and metadata, and removed the old entries.
3. **Normalize IDs during server-driven canvas hydration** (`lib/hooks/use-canvas-hydration.ts`):
   - Rewrote panel/parent IDs before merging into the runtime stores and migrated any lingering legacy entries in `dataStore`, `branchesMap`, and `LayerManager`.

Together these changes ensure every branch panel exists under a `branch-…` composite key before the connection renderer runs, so both endpoints resolve correctly on every reload.

## Affected Files
- `components/canvas/canvas-workspace-context.tsx`
- `components/canvas/canvas-context.tsx`
- `lib/hooks/use-canvas-hydration.ts`
- `lib/canvas/dedupe-canvas-items.ts` *(2025-10-23 hardening update to backfill `noteId`)*

## Verification
- Ran `SELECT … FROM debug_logs WHERE action='branch_not_found'` and confirmed no new records with raw UUID panel IDs after reloads.
- Manual reloads now consistently keep the branch connection lines visible without requiring reopen/drag actions.

## Follow-up Hardening (2025-10-23)
- **Gap observed:** Some branch panels restored from snapshots still lacked `noteId` even after ID normalization. `WidgetStudioConnections` falls back to the active note when `panel.noteId` is missing, so newly loaded branch panels briefly pointed to the wrong main panel until another interaction (drag) rehydrated them.
- **Fix:** Update `lib/canvas/dedupe-canvas-items.ts` to parse the existing composite `storeKey` and repopulate `item.noteId` whenever the key already encodes it.
- **Result:** Panels now arrive with both `storeKey` and `noteId` populated before the connection overlay runs, eliminating transient misrouting and ensuring connection lines render immediately after reload.
