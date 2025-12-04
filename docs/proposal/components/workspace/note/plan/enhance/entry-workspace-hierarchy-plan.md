# Entry → Workspace Hierarchy Plan

Extend the live-state system so users can organize work into hierarchical "Entries" (folders/to-dos/knowledge items), each of which owns one or more workspaces. Clicking an entry loads its workspace tabs and the note canvas behaves exactly as today, but scoped to that entry.

## Goals

1. Provide an organizational layer (Entries) above workspaces without regressing the live-state guarantees.
2. Allow each entry to maintain multiple workspaces (Default, Research, Drafts, etc.).
3. Preserve all runtime/persistence work—switching entries is as seamless as switching workspaces.

> **Quick Links integration:** see `Entry_Workspace_Hierarchy/quick-links-guide.md` for the detailed wiring that makes each Quick Links item open its own entry dashboard + workspace set. That guide builds on the phases below.

## Phase 1 – Data Model & API

1. **Entry schema reuse**
   - Reuse the existing `items` table (hierarchical folders/notes) as the “Entry” model; in code we’ll refer to the foreign key as `entryId` but the column name is `item_id` for consistency with the database.
   - Add an `item_id` column to `note_workspaces` to associate each workspace with an item. Keep `user_id` for ownership/permissions.
   - Ensure every workspace has exactly one parent item (default workspace per entry).
   - Adjust the `is_default` constraint so that “one default per user per entry” is enforced via a partial unique index on `(user_id, item_id) WHERE is_default = true` and drop the existing per-user constraint once backfill completes.
2. **Adapter updates**
   - Expose `listEntries`, `listWorkspaces(entryId)`, `createEntry`, `deleteEntry`, `renameEntry`.
   - Update existing workspace list/create APIs to require `entryId`.
3. **Runtime metadata**
   - Track `currentEntryId` in `useNoteWorkspaces`; include `entryId` in runtime maps and save payloads.

## Phase 2 – UI/State Management

1. **Entry navigator**
   - Build sidebar/tree showing entries hierarchically (with search/filter).
   - Clicking an entry sets `currentEntryId` and fetches its workspaces.
2. **Workspace tabs/cards per entry**
   - Render tabs for workspaces belonging to `currentEntryId`.
   - Support add/delete/rename workspace actions scoped to the entry.
3. **Routing / context**
   - Update `AnnotationAppShell` to derive `currentWorkspaceId` from `(entryId, workspaceId)` pairs.
   - Ensure deep links reflect both (e.g. `/entries/{entryId}/workspaces/{workspaceId}`).

## Phase 3 – Runtime Lifecycle

1. **Entry-aware runtime lookup**
   - `WorkspaceRuntime` is keyed by workspace UUID, so no changes needed for ID uniqueness.
   - On entry switch, load that entry’s workspaces and rely on the existing runtime manager to keep the latest runtimes hot; LRU eviction handles capacity automatically.
2. **Entry switch persistence**
   - When switching entries, flush dirty workspaces in the previous entry (use existing scheduler). Background autosave (if implemented later) will cover idle ones.
3. **Permissions / isolation**
   - (Future) If entries imply different sharing rules, propagate those to workspace APIs.
4. **Runtime retention strategy**
   - Continue using the existing workspace-level LRU (`MAX_HOT_RUNTIMES`). Recently used workspaces stay hot, older ones evict naturally with pre-eviction persistence.
   - Optional: cache lightweight snapshots on eviction so returning to a recently evicted workspace feels instant before the DB rehydrate completes.

## Migration / Backward Compatibility

1. **Initial rollout**
   - Add nullable `item_id` column to `note_workspaces` (no FK/constraint changes yet).
   - Create a default “Workspace Root” item per user; backfill existing workspaces with that item.
   - Update APIs/clients to pass `item_id` for new workspaces while still supporting legacy rows.
   - Add the new “one default per user+entry” unique index; after it succeeds, drop the old `note_workspaces_unique_default_per_user` index.
2. **Stabilization**
   - Once all users have been upgraded, enforce `item_id NOT NULL` and add the FK constraint with the desired delete behavior (e.g., `ON DELETE CASCADE` so deleting an item removes its workspaces).
   - Provide tools to move legacy workspaces into newly created entries if needed.

## Phase 4 – Entry CRUD & UX polish

1. **Create entry**
   - Prompt for name/type, auto-create default workspace, focus canvas.
2. **Delete entry**
   - Soft-delete: mark entry and all child workspaces deleted; offer undo.
   - Hard delete only after retention window.
3. **Move/rename entry**
   - Support drag/drop in tree to reparent entries.
   - Renaming updates UI immediately; workspaces keep same IDs so runtimes stay valid.
4. **Indicators**
   - Show dot/badge on entries with unsaved workspaces (based on `workspaceDirtyRef`).
   - Display workspace status ("hot", "cold", syncing) in tabs.

## Phase 5 – Testing & Telemetry

1. **Unit**
   - Entry adapter methods, workspace CRUD scoped to entryId.
   - Runtime context ensures entry changes don’t leak workspaces.
2. **Integration**
   - Scenario: create Entry A with two workspaces + components, switch to Entry B, reload, ensure each entry restores its workspaces intact.
   - Scenario: exceed runtime cap with workspaces across multiple entries, verify pre-eviction persists the correct entry/workspace.
3. **Telemetry**
   - Log `entry_select`, `entry_create`, `entry_delete`, `workspace_switch` with entry metadata.
   - Monitor autosave/save_success per entry to catch drifts.

## Rollout

1. Ship behind feature flag (e.g., `NOTE_ENTRIES_MULTI_WORKSPACE`).
2. Dogfood internally with a small set of entries/workspaces.
3. Gradually migrate existing single-layer workspaces by seeding a default entry for each user.
4. Once stable, allow users to create arbitrary entries and manage their workspace collections.

This plan builds on the existing live-state foundation: entries are a purely organizational layer, while each workspace runtime continues to enjoy per-workspace persistence and hot-switch behavior.
