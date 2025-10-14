# Research Plan: Connection Lines Missing After Reload

**Status:** Draft 1.0  
**Owner:** Codex Agent  
**Date:** 2025-10-14

## Problem Statement

In plain/offline mode (no Yjs), branch connection lines render correctly right after a panel is opened, but disappear after reloading the app. Panels themselves hydrate and display at the expected positions, yet the connection SVG never reappears until a user reopens each panel. We need to determine why `WidgetStudioConnections` fails to draw lines on initial hydration.

## Observed Symptoms

- Panels hydrate from the database and appear in their prior locations.
- Branch data (`dataStore`) contains entries with `parentId`, `branches`, `position`, and `worldPosition` after the branch loader runs.
- `WidgetStudioConnections` renders once on initial load, but its computed `connections` array is empty; connection lines remain missing until a subsequent interaction forces rerender.
- Console shows “connections computed” debug logging with `count: 0` post-reload, or errors about setState while rendering when attempting to listen to data store events synchronously.

## Working Hypotheses

1. **Stale Memo Dependencies** – `useMemo` in `WidgetStudioConnections` may rely on references (`branches`, `canvasItems`, `panelMap`) that do not change when the loader finishes, preventing recomputation.
2. **Render Timing** – `WidgetStudioConnections` renders before the branch loader populates the parent-child relationships, so no connections exist at first render; later updates occur after initial render cycle without triggering a state change in the component.
3. **Data Mutation Without React Awareness** – `dataStore.update()` mutates underlying data without notifying React; connection component needs an explicit version signal (e.g., via `lastUpdate`, dataStore events, or loader dispatch) to recompute.
4. **Missing Relationship Data** – Hydrated branch records might not contain `parentId` or `branches` on first load; loader may populate one but not both, or fail to patch them into existing entries.
5. **World vs Screen Coordinates** – Connections use `worldPosition`/`position`; if hydration only sets screen-space values, offsets passed to the SVG may be incorrect or zeroed, producing lines off-screen.
6. **Canvas Items vs Branch Store Drift** – `canvasItems` derive from hydration results but may not include all branch panels present in `dataStore`; missing parent or child panels prevent linking.

## Research Tasks

1. **Capture Hydration Timeline**
   - Instrument `useCanvasHydration` and branch loader for precise timestamps (hydration start/end, loader loops, `dataStore.update` events).
   - Verify whether `WidgetStudioConnections` renders before or after loader completion.

2. **Inspect Branch Data After Reload**
   - Log `dataStore.get(id)` snapshots for parent/child branches post-hydration to confirm presence of `parentId`, `branches`, `position`, and `worldPosition`.
   - Compare with snapshots taken immediately after re-opening panels (when lines do render) to find discrepancies.

3. **Trace Canvas Items Generation**
   - Review `useCanvasHydration` → `setCanvasItems` pipeline to ensure every branch panel becomes a canvas item.
   - Confirm `PanelsRenderer` and `WidgetStudioConnections` share the same set of panel IDs.

4. **Evaluate React Dependency Signals**
   - Determine whether `canvasContextState.lastUpdate` increments during branch loader updates and whether it flows into `WidgetStudioConnections` via props.
   - Experiment with different invalidation strategies: prop version number, context subscription, explicit state setter, or manual re-render after loader dispatch.

5. **Check Coordinate Conversion**
   - Validate that stored `worldPosition` values are sensible (i.e., align with panel DOM positions). If not, connection lines might be drawn off-canvas.

6. **Audit Renderer Conditions**
   - Ensure `WidgetStudioConnections` respects `canvasState.showConnections` and `canvasItems` state without early exit due to zoom or visibility toggles.

## Affected Files (Copied to `docs/proposal/canvas_state_persistence/affected_files/`)

- `components/annotation-canvas-modern.tsx`
- `components/canvas/widget-studio-connections.tsx`
- `components/canvas/canvas-panel.tsx`
- `components/canvas/canvas-context.tsx`
- `lib/hooks/use-canvas-hydration.ts`
- `lib/data-store.ts`

## Deliverables

- **Root Cause Analysis:** Document the exact sequence leading to an empty `connections` array after initial hydration.
- **Fix Proposal:** Outline code changes required to ensure connection builder recomputes with correct data post-reload.
- **Verification Plan:** Specify manual/automated tests to confirm lines render immediately after reload across plain/Yjs modes.

## Open Questions

1. Should connection rendering subscribe directly to branch loader events (`BRANCH_UPDATED`) instead of relying on implicit store changes?
2. Do we need a canonical parent-child source (favoring `branches[]` vs `parentId`) to avoid partial data scenarios?
3. Is there existing UI state (e.g., `canvasItems` snapshot) that should serve as the single source of truth for connections to avoid cross-store drift?
