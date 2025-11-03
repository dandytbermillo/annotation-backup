# Organization Workspace Tab — Implementation Plan

## 1. Goals & Scope
- Add a centered workspace toggle to the overlay canvas (mirroring the note canvas) that lists and loads saved workspaces.
- Reuse the popup overlay canvas to render workspace layouts; no new canvas mode required.
- Persist named workspaces in Postgres via the overlay layout adapter, prompting for a custom label with a `Workspace N` fallback.
- Keep Constellation integration untouched; workspaces are scoped to the Organization/overlay experience.

## 2. Architectural Updates
1. **Workspace Registry**
   - Extend `overlay-layout-adapter` with workspace CRUD helpers (`listWorkspaces()`, `createWorkspace()`, `deleteWorkspace()`), while reusing the existing layout endpoint for load/save operations.
   - Track `nextIndex` server-side so auto-generated names (“Workspace N”) remain stable across sessions.
2. **Mode Coordination**
   - Wrap `showConstellationPanel` + `layerContext.activeLayer` in a dedicated `useCanvasMode` hook to manage a single `mode: 'notes' | 'overlay' | 'constellation'` state.
   - Workspace selection simply calls `setMode('overlay')`; constellation off, notes hidden.
3. **State Loading**
   - On app boot, preload workspace metadata (`workspaceList`) and Knowledge Base children (for the organization list).
   - Clicking a workspace row loads the saved layout and swaps `overlayPopups` accordingly.

## 3. UI Behaviour
- Sidebar tabs: Constellation / Organization / Workspace. Workspace tab lists saved layouts with timestamps + author.
- Canvas chrome: center-aligned chip showing `Workspace: {name}` plus a `+` button. Clicking the label opens a dropdown; clicking `+` snapshots the current overlay layout (prompting for a name, defaulting to “Workspace N”).
- Both the sidebar list and chip dropdown expose a delete control (disabled for the default workspace) alongside last-updated metadata.
- Knowledge Base entry remains disabled; child folders spawn overlay popups as quick shortcuts.
- Workspace chip updates as you switch layouts; the sidebar still reflects the active workspace’s folders.

## 4. Data Flow
1. **Loading Workspaces**
   ```ts
   const descriptors = await overlayAdapter.loadWorkspace(name)
   setMode('overlay')
   setOverlayPopups(descriptors)
   ```
   - Store `currentWorkspace` in state to highlight the chip / dropdown selection.
2. **Saving Workspaces**
   - Determine name: prompt for custom label or default to `Workspace {nextIndex}` (auto-incremented via adapter).
   ```ts
   const descriptors = serializeOverlayPopups(overlayPopups)
   const name = await overlayAdapter.saveWorkspace({ nameHint })
   refreshWorkspaceList()
   setCurrentWorkspace(name)
   ```
3. **Sidebar Folder Click**
   - If popup exists, highlight/focus it; otherwise fetch metadata + children and instantiate overlay popup via existing creation logic.

## 5. Edge Cases & Resilience
- Workspace load failure ⇒ toast (layout remains on the last successful workspace until a retry succeeds).
- Missing folders in saved layout ⇒ skip with warning; do not block others.
- Concurrency: serialize save/load through adapter locks to prevent partial states.
- Plain-mode detection (`isOverlayPersistenceEnabled`) keeps the UI hidden unless overlay persistence is active; no explicit feature flag is required.

## 6. Testing Strategy
- Adapter unit tests for workspace CRUD + index incrementing (existing coverage via integration).
- Integration test suite exercises create/list/delete flows (ensuring non-default workspaces drop out of the catalog after deletion).
- Regression: constellation toggle hides overlay; organization still shows live session popups.
- Storybook or screenshot for workspace chip/dropdown.

## 7. Rollout Checklist
- ✅ DB migration: add workspace table/columns (name, metadata) and seed default/workspace overlay snapshot.
- ✅ Backfill script: snapshot current overlay layout into “Workspace 1”.
- Update documentation (include `demo.html` visuals) and release notes for workspace feature.
- Monitor `loadWorkspace`/`saveWorkspace` logs after launch for early errors.
