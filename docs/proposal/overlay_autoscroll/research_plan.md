# Overlay Autoscroll Refactor — Research & Plan

## Background

- **Current behaviour:** The popup overlay runs in a “canvas” mindset, but the explorer still stores both *screen* and *canvas* coordinates inside `hoverPopovers`. Auto-scroll and edge panning mutate those coordinates directly. When the layer camera moves, these stored screen positions desynchronise from the DOM, causing popups to disappear or snap.
- **Recent attempts:** Switching auto-scroll to `LayerProvider.updateTransformByDelta('popups', …)` exposed the mismatch. `PopupOverlay` still owns its own transform state, connection lines read stale positions, and persistence mixes reference frames. The result was vanishing popups and jittery canvas panning.

## Goals

1. Treat `canvasPosition` as the single source of truth for every popup/inspector.
2. Render popups by combining `canvasPosition` with the active layer transform; never cache screen coordinates.
3. Drive auto-scroll (edge panning) exclusively via the shared `LayerProvider` camera so the overlay moves like a true infinite canvas.
4. Keep legacy/Option-A (no `LayerProvider`) behaviour intact.
5. Preserve persistence and connection lines without double transforms.

## Key Observations

- `components/notes-explorer-phase1.tsx` currently mutates `hoverPopovers.position` and `hoverPopovers.canvasPosition` each drag tick. This works only while the overlay doesn’t pan.
- `components/canvas/popup-overlay.tsx` maintains an internal `transform` state even when `LayerProvider` is present. The overlay container never re-renders against `layerContext.transforms.popups`, so camera updates are invisible to the React tree.
- Connection lines (`lib/rendering/connection-line-adapter.ts`) assume `canvasPosition` may be undefined and fall back to screen coordinates, reinforcing the mixed-state issue.
- Persistence (`buildLayoutPayload`, `OverlayLayoutAdapter`) serialises whatever positions are stored in `hoverPopovers`, so any drift persists across reloads.

## Proposed Refactor

### 1. Coordinate Source of Truth

- Normalise `hoverPopovers` so every entry always owns a `canvasPosition` (never `undefined`).
- Remove direct writes to `position` during drag; instead, update a lightweight `screenPosition` ref for the currently dragged popup to keep DOM feedback smooth.
- Migrate connection-line logic to assume canvas-space input only.

### 2. Overlay Rendering

- Update `PopupOverlay` to read the shared transform when `LayerProvider` exists. The container’s CSS transform should be `CoordinateBridge.containerTransformStyle(layerCtx.transforms.popups)`.
- Derive each popup’s `left/top` by applying `CoordinateBridge.canvasToScreen` inside `PopupOverlay` immediately before render. This guarantees DOM alignment with the camera.
- Keep the existing local-transform code path for plain legacy scenarios (no `LayerProvider`).

### 3. Drag & Auto-Scroll Flow

- On drag start, cache the popup’s original canvas coordinate and the pointer offset (canvas space).
- During pointer move:
  - Convert pointer deltas into canvas deltas using the current transform.
  - Update a transient DOM transform (via `requestAnimationFrame`) for visual feedback.
  - Defer state writes until drop, avoiding per-frame React churn.
- Auto-scroll handler:
  - Call `layerContext.updateTransformByDelta('popups', { dx, dy })` for camera motion.
  - Adjust the local drag offset by the opposite delta so the dragged popup stays under the cursor.
  - Skip mutating `hoverPopovers`; let the shared camera dictate screen movement.
- On drop:
  - Compute the final `canvasPosition` via `CoordinateBridge.screenToCanvas(finalScreenPos, currentTransform)`.
  - Persist once, then rebuild screen coordinates from state + transform on the next render.

### 4. Persistence & API

- Serialise only `{ canvasPosition, schemaVersion, … }`.
- On load, assume overlay transform `(0,0,1)` and let `PopupOverlay` place elements via the active transform.
- Add a migration to clean legacy layouts that still carry screen coordinates (optional but recommended).

### 5. Testing Strategy

- **Interaction tests:**
  - Drag a popup to all four edges, ensuring it stays visible as auto-scroll pans the camera.
  - Reload after dragging; confirm popups reappear in the correct location.
- **Unit tests:**
  - Verify coordinate conversions (screen ↔ canvas) via `CoordinateBridge` with mocked transforms.
  - Ensure `ConnectionLineAdapter` still produces correct paths with canvas-only data.
- **Perf regression:** Drag many popups simultaneously to confirm no extra React renders compared to today.

## Suggested Implementation Phases

1. **Scaffolding & Contracts**
   - Introduce utility helpers for canvas ↔ screen conversion.
   - Update types to require `canvasPosition` (ts compile-time guard).
2. **Overlay Rendering Refactor**
   - Switch `PopupOverlay` to shared transform + derived screen coords.
   - Adjust connection lines and visibility/culling to consume the new structure.
3. **Drag/Auto-Scroll Rewrite**
   - Move per-frame mutations into refs.
   - Rewire auto-scroll to camera-only updates.
4. **Persistence Cleanup**
   - Update layout payloads, migrations, and loader to rely strictly on canvas coordinates.
5. **QA & Hardening**
   - Run manual + automated tests, watch for jitter or dropped frames.

## Affected Files

- `components/notes-explorer-phase1.tsx`
- `components/canvas/popup-overlay.tsx`
- `components/canvas/use-auto-scroll.ts`
- `lib/rendering/connection-line-adapter.ts`
- `lib/utils/coordinate-bridge.ts`
- `lib/adapters/overlay-layout-adapter.ts`
- `app/api/overlay/layout/[workspaceId]/route.ts` (layout normalisation)
- Tests under `__tests__/` or `components/__tests__/` (to be authored)

## Patch Requests to Line Up

1. **Canvas-first hover state patch** — enforce `canvasPosition`, remove screen-position writes except for drag refs.
2. **Overlay camera integration patch** — wire `PopupOverlay` to `LayerProvider` transforms and legacy fallback.
3. **Drag/auto-scroll rework patch** — pointer-to-canvas conversion, camera-driven auto-scroll.
4. **Persistence cleanup patch** — serialize/load canvas-only layouts and guard against legacy payloads.
5. **Connection line adjustment patch** — consume canvas coordinates exclusively.
6. **Test harness patch** — add interaction coverage for edge auto-scroll and persistence round-trip.

Each patch should be reviewed independently to keep regressions contained and simplify rollbacks if needed.

