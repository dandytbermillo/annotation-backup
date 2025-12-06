# Merge Dashboard & Workspace — Implementation Addendum

Operational notes, migration safety, and follow‑up tasks related to `merge_dashboard_workspace/IMPLEMENTATION_PLAN.md`.

Use this as a living checklist while executing or auditing the plan.

---

## Status Legend

- [ ] Not started
- [~] In progress
- [x] Complete
- [N/A] Not applicable / deferred

---

## What This Addendum Covers

| Plan Area | Covered in Addendum | Notes |
|-----------|---------------------|-------|
| Dashboard/workspace UX | ✅ | view mode persistence, URL sync |
| Entry/workspace context | ✅ | entry context must update before workspace mounts |
| Runtime isolation | ✅ | runtime ledger is sole source |
| Database schema | ❌ | see `entry-workspace-hierarchy-addendum.md` instead |

---

## Operational Checklist

### Context & Shell Behavior

- [x] `DashboardView` calls `setActiveWorkspaceContext` before rendering embedded shell.
- [x] `AnnotationAppShell` exposes `isHidden`, `hideHomeButton`, `hideWorkspaceToggle` props to prevent duplicate chrome.
- [x] Portal components (`FloatingToolbar`, `CanvasAwareFloatingToolbar`, `WorkspacePreviewPortal`) respect `isHidden` to avoid double UI in embedded mode. *(Implemented: `isHidden` controls `workspaceToolbarStripProps.isVisible` and is passed to child components)*
- [x] `NavigationEntry` stores `viewMode` and `activeWorkspaceId`.
- [x] URL reflects view mode: `?view=dashboard` or `?view=workspace&ws=...`.

### Runtime / Persistence

- [x] Open-note/provider effect skips when live-state is enabled (runtime is authoritative). *(FIX 20: use-note-workspaces.ts)*
- [x] `CanvasWorkspaceV2` always reads runtime ledger first; doesn't write ref cache data back when runtime empty. *(FIX 20: canvas-workspace-context.tsx)*
- [x] Notes and components both use per-workspace runtime ledger for persistence.
- [x] Global `activeNoteId` state resets when entry changes to prevent cross-entry contamination. *(FIX 21: annotation-app-shell.tsx lines 1285-1360 — clears activeNoteId, localStorage, and resets initialWorkspaceSyncRef)*

### Quick Links / Entry Navigation

- [x] Quick Link creation: creates entry, dashboard workspace, default workspace.
- [x] Clicking Quick Link sets both entry context and workspace context before shell mounts.
- [x] Workspace dropdown only lists workspaces for current entry.
- [x] Home button returns to entry dashboard without leaving stale workspace context. *(Phase 4 complete — HomeNavigationButton has embedded mode awareness)*

### Telemetry & Observability

- [x] Log entry/workspace context changes for debugging. *(Implemented: `clearing_active_note_on_entry_change`, `entry_change_cleanup_complete`, `entry_initial_load` debug log events)*
- [ ] Emit `dashboard_embedded_shell_mount/unmount` events for debugging.
- [ ] Alert if URL/viewMode state ever desynchronizes (e.g., workspace renders but URL still shows dashboard).

### Testing / Scenarios

- [ ] Starting app: URL `/?view=workspace&ws=<id>` loads correct entry + workspace.
- [x] Switching entry via Quick Link: default workspace shows only its own notes/components. *(Verified 2025-12-06 after FIX 21)*
- [ ] Adding new workspace inside entry: appears in dropdown and dashboard tabs immediately.
- [ ] Opening same entry in multiple tabs: contexts stay isolated.
- [x] Rapid entry switching (Home → Entry A → Home → Entry B): no stale notes/components. *(Verified 2025-12-06 — FIX 21 clears activeNoteId on entry change)*

### Rollback Considerations

No schema migrations for this plan, but be mindful of:

- Feature flag to disable embedded shell and fall back to legacy navigation.
- Ability to reset `viewMode` URL logic if bugs surface (e.g., remove query param parsing).
- Logging to trace entry/workspace context transitions for diagnosing cross-entry contamination.

---

## Follow-up / Future Tasks

- [ ] Shortcut (e.g., `Cmd+K`) to open workspace picker without mouse.
- [ ] Optional hover preview before switching (needs UX validation).
- [ ] Persist dashboard layout per entry.
- [ ] Integrate entry hierarchy migrations (see other addendum) if backend ownership enforcement is required.

---

_Last updated: 2025‑12‑06 (Updated after FIX 20 & FIX 21 implementation)_
