# Pinned Entries – State Preservation Plan

> Builds on `merge_dashboard_workspace/IMPLEMENTATION_PLAN.md` (unified dashboard/workspace embed). Goal: allow users to “pin” entry dashboards so their operations continue running while the user switches to other entries.

## Objectives
1. Let a dashboard/workspace pair remain mounted (hidden) when user switches entries.
2. Preserve all in-memory operations inside pinned entries (timers, queued Quick Links, panel scroll positions, etc.).
3. Provide pin controls at both entry and workspace level: users can pin a whole entry but only keep selected workspaces inside it alive (e.g., 1 or 3 out of 10), to control memory usage.
4. Include the Home (main) dashboard in the same pinning system so users can preserve their Home context just like any other entry.
5. Integrate with existing navigation context, runtime ledger, and Quick Links so pinned entries don’t break live-state guarantees.

## Architecture Overview
```
DashboardInitializer
├── PinnedEntryView (Entry A) – hidden when not active
│   ├── DashboardView
│   │   └── AnnotationAppShell (workspace canvas)
├── PinnedEntryView (Entry B) – can keep selected workspaces alive
└── ActiveEntryView (Entry C) – the entry currently visible
```
- Each pinned entry keeps its own `DashboardView + AnnotationAppShell` instance mounted.
- Visibility toggled via CSS (`display:none`, `opacity:0`).
- Active entry is either a pinned entry (if currently selected) or an ephemeral view (for unpinned entries).

- `PinnedEntryManager` service storing pinned entries:
  ```ts
  interface PinnedEntry {
    entryId: string
    dashboardWorkspaceId: string
    entryName: string
    pinnedWorkspaceIds: string[]   // workspaces to keep mounted
    pinnedAt: number
  }
  ```
  Example state: `[{ entryId: 'entry-work', pinnedWorkspaceIds: ['work-dashboard','work-clients'] }]`
- DashboardInitializer updates:
  - Renders pinned dashboards plus the active dashboard.
  - Tracks active entry ID, pin/unpin state, pinned limit.
- UI elements:
  - Pin button in breadcrumb/header.
  - Pinned tabs or chip list for quick switching/unpinning.
  - Resource indicator (e.g., “Pinned 2/3”).
- Telemetry + warnings when pinned limit reached (auto unpin oldest).

## Phases

### Phase 1 – State Management Layer
1. `PinnedEntryManager` (maybe under `lib/navigation`) implementing the interface above: functions to pin/unpin entries and per-entry workspace pins, retrieve pinned list, enforce max counts.
2. Extend navigation context to store `activeEntryId` + pinned entries; update `updateViewMode()` to respect pinned state.
3. Add persistence to localStorage (optional) so pinned state survives reload.

### Phase 2 – DashboardInitializer Rendering
**Mounting rules**
  - Pinned entry dashboard stays mounted; we toggle `display:none/opacity` when inactive.
  - Pinned workspace within that entry keeps its `AnnotationAppShell` mounted.
  - Unpinned workspace within pinned entry loads fresh each time (only the dashboard remains hot).
1. Update initializer to render all pinned entries plus the active entry:
   - Each pinned entry renders `<DashboardView isHidden={entryId !== activeEntryId} .../>`.
   - Non-pinned active entry uses existing single-view logic.
2. Hide the embedded `AnnotationAppShell` via `isHidden` prop when not active to suppress portals/toolbars.
3. Manage mounting/unmounting to avoid extra network requests (lazy load when pinned).

### Phase 3 – UI/UX
1. Add “Pin Entry” button near breadcrumb or workspace tabs.
2. Add per-workspace pin toggles in the workspace dropdown/list so users can pick which canvases in a pinned entry stay alive.
3. Pinned tabs component showing pinned entries with nested indicators for pinned workspaces (e.g., `📌 Work [Clients, Reports]`).
4. Ensure the Home dashboard (system entry) has the same pin controls so users can keep their main dashboard alive.
5. Visual cues: pinned entries/workspaces show 📌 icon, active items highlighted.
5. Show toast or tooltip when auto-unpin occurs (limit reached).

### Phase 4 – Persistence & Limits
1. Decide global limit (3–5 pinned entries) AND per-entry workspace limits (e.g., max 2 pinned workspaces per entry). Enforce by unpinning least-recently-used workspace when limit exceeded.
2. Ensure pinned entries still obey per-workspace runtime ledger; only pinned workspaces stay mounted.
3. Treat the Home dashboard as an entry within these limits (e.g., it counts toward the pinned entry total if pinned).
4. Handle quick links / external navigation: if user opens pinned entry/workspace via Quick Link, just switch active IDs without remounting.

### Phase 5 – Testing & Rollout
1. Feature flag `PINNED_ENTRIES`.
2. Unit tests: PinnedEntryManager, pin/unpin flows, limit handling.
3. Integration tests: switch between pinned entries, navigate to unpinned entry, reload app (ensure pinned entries remount correctly).
4. Telemetry: log `entry_pinned`, `entry_unpinned`, `pinned_limit_reached` events.

## Considerations
- Memory budget (estimates): DashboardView ≈ 5–10 MB, AnnotationAppShell ≈ 15–30 MB, TipTap editor ≈ 2–5 MB. Recommended caps: max 3 pinned entries, max 2 pinned workspaces per entry (≈6 mounted workspaces total).
- Background work: pinned entries keep timers/components running; if user wants full pause, unpin.
- Quick Links/Recent panels must detect active entry to highlight the correct context even when pinned.

## Dependencies
- Runtime ledger & dashboard embed from `merge_dashboard_workspace/IMPLEMENTATION_PLAN.md`.
- Entry context & navigation context from Knowledge Base hierarchy work.

## Next Steps
1. Approve pinning UX (tab vs chips, limit value, persistence rules).
2. Implement Phase 1 (PinnedEntryManager + context) behind flag.
3. Implement Phase 2 + Phase 3 iteratively, QA with flag enabled.
4. Measure memory/CPU impact; tweak limits as needed before rollout.

## Edge Cases
1. **Pinned workspace deleted**: auto-unpin the workspace, notify user.
2. **Pinned entry deleted**: remove entry and all pinned workspaces from manager, clean up mounted components.
3. **Remote edits while pinned**: show “changes available” banner when returning to a pinned workspace if background data changed.
4. **Browser refresh**: restore pinned list from localStorage but re-mount canvases fresh (timers reset to 0).
5. **Memory pressure**: if the browser signals low memory, unpin oldest workspace/entry and inform the user.

## Navigation Scenarios
### Pinned workspace quick-link
User on Entry B clicks “Notes A” (pinned). Flow: detect entry pinned → workspace pinned → just switch active IDs. No remount, instant.
### Unpinned workspace within pinned entry
User on Entry B clicks “Notes C” (Entry A pinned but workspace isn’t). Flow: switch entry context → mount new AnnotationAppShell for Notes C (fresh load) → dashboard remains hot.
