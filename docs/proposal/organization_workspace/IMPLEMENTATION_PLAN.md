# Organization Workspace Tab — Implementation Plan

## 1. Goals & Scope
- Add a centered workspace toggle to the overlay canvas (mirroring the note canvas) that lists and loads saved workspaces.
- Reuse the existing popup overlay canvas to render workspace layouts; no new canvas mode required.
- Persist named workspaces in Postgres via the overlay layout adapter.
- Keep Constellation integration untouched; workspaces are scoped to the Organization/overlay experience.

## 2. Architectural Updates
1. **Workspace Registry**
   - Extend `overlay-layout-adapter` with workspace CRUD: `listWorkspaces()`, `loadWorkspace(name)`, `saveWorkspace(name, layout)`, `deleteWorkspace(name)`.
   - Store layouts as the existing descriptor array with an added workspace key/timestamp/author.
2. **Mode Coordination**
   - Wrap `showConstellationPanel` + `layerContext.activeLayer` in a small hook (`useCanvasMode`) so we have a single `mode: 'notes' | 'overlay' | 'constellation'` source of truth.
   - Workspace selection simply calls `setMode('overlay')`; constellation off, notes hidden.
3. **State Loading**
   - On app boot, preload workspace metadata (`workspaceList`) and the Knowledge Base children (for organization list).
   - Clicking a workspace row loads the saved layout and swaps `overlayPopups` in one step.

## 3. UI Behaviour
- Sidebar tabs: Constellation / Organization / Workspace. Workspace tab shows saved layouts with last-updated metadata.
- Canvas chrome: center-aligned chip reading “Workspace: {name}” with a `+` button used to create/overwrite workspaces. Dropdown interaction (click label) opens workspace list; `+` opens save dialog.
- Knowledge Base entry stays disabled (non-interactive), children behave as quick “open folder” shortcuts.
- When a workspace is active, sidebar still lists folders; selecting one spawns a popup using the workspace’s overlay canvas.

## 4. Data Flow
1. **Loading Workspaces**
   ```ts
   const descriptors = await overlayAdapter.loadWorkspace(name)
   setMode('overlay')
   setOverlayPopups(descriptors)
   ```
   - Optional: store workspace metadata (last loaded) to highlight current selection in the chip.
2. **Saving Workspaces**
   ```ts
   const descriptors = serializeOverlayPopups(overlayPopups)
   await overlayAdapter.saveWorkspace(name, descriptors, transform)
   refreshWorkspaceList()
   ```
   - If `name` exists, prompt overwrite confirmation; else create new entry.
3. **Sidebar Folder Click**
   - If popup already open, highlight it.
   - Else fetch `/api/items/{folderId}` + children and instantiate overlay popup at default position (reusing current overlay creation code).

## 5. Edge Cases & Resilience
- Workspace load failure ⇒ toast + leave previous overlay intact.
- Missing folders in saved layout ⇒ skip with warning; do not block others.
- Concurrency: serialize save/load via adapter lock to prevent partial writes.
- Feature flag `NEXT_PUBLIC_ORG_WORKSPACES` guards new UI until DB migration is deployed.

## 6. Testing Strategy
- Adapter unit tests for workspace CRUD.
- Sidebar integration test: selecting workspace transitions overlay state + highlights chip.
- Regression: constellation toggle still hides notes/overlay; organization tab still lists live popups.
- Snapshot new workspace chip in Storybook (optional) for visual regression.

## 7. Rollout Checklist
- DB migration: add workspace table or extend existing overlay layout store with workspace column + unique index.
- Backfill script to seed a default workspace from current overlay layout.
- Update user docs onboarding; add “Workspace” section with screenshot (use `demo.html` as reference).
- Monitor error logs for `loadWorkspace` / `saveWorkspace` operations post-release.
