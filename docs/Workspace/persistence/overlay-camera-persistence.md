# Overlay Workspace Camera Persistence Plan

## Goal
Let each overlay workspace remember its own canvas transform (pan/zoom) in addition to popup positions so reopening a workspace restores the exact viewport, mirroring the note canvas behavior.

## Current State
- `overlayPopups` serialize per workspace via `OverlayLayoutAdapter`.
- The popups layer transform (`layerContext.transforms.popups`) is runtime-only; switching workspaces keeps the last active transform.
- Note canvas already persists per-workspace camera via its workspace context.

## Implementation Steps
1. **Schema/Adapter Update**
   - Extend the layout payload (`OverlayLayoutPayload`) with a `camera` object: `{ x: number; y: number; scale: number }`.
   - Default to `{ x: 0, y: 0, scale: 1 }` when absent for backward compatibility.
   - Update `OverlayLayoutAdapter.saveLayout`/`loadWorkspace` to read/write the camera block.

2. **State Tracking in AnnotationApp**
   - Track the current popups layer transform in React state (subscribe to `layerContext.transforms.popups` or reuse existing refs).
   - Whenever the transform changes (pan/zoom events), update a `currentCamera` ref and mark layout dirty, similar to how popup drags trigger saves.

3. **Hydration**
   - After loading a workspace, apply the saved camera transform via `layerContext.setTransform('popups', savedCamera)`.
   - Ensure this runs before rendering `PopupOverlay` to avoid flicker; may require deferring until `layerContext` is ready.

4. **Save Flow**
   - When building the layout payload (`buildLayoutPayload`), include `camera: currentCamera`.
   - Trigger a save when the user stops panning/zooming (debounce to avoid excessive writes). The existing save timer can listen for camera changes similar to popup changes.

5. **Migration & Compatibility**
   - No DB migration necessary if `overlay_layouts.layout` accepts new JSON keys.
   - On load, fallback to identity transform when `camera` is missing (legacy data).

6. **Testing**
   - Manual: switch between workspaces with distinct zoom/pan settings; ensure each restores its own viewport.
   - Automated: add a unit/integration test (if feasible) that mocks two workspace payloads and verifies `layerContext` receives the correct transform per workspace.
   - Regression: ensure saving popups without moving the camera still persists camera state so the payload stays consistent.

## Rollout Considerations
- Update docs (`docs/Workspace/overlay-architecture.md`) once implemented.
- Communicate that users can rely on workspace camera persistence similar to note canvas.
- Monitor payload size; camera state is small but ensure existing consumers ignore unknown keys.
