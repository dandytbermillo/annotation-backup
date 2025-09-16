# Unified Canvas Nodes & Camera Pan — Updated Implementation Plan (2025-09-16)

> **Status:** Proposal only. No code applied.
>
> Goal: bring Option A’s canvas closer to Figma/Miro behavior without breaking the current plain-mode flow. Plan reflects the repository after the recent revert (e.g. `lib/constants/z-index.ts` reintroduced legacy tokens, `components/canvas/canvas-panel.tsx` still moves DOM nodes directly).

---

## 0) Current Baseline (Confirmed 2025-09-16)

- `components/canvas/canvas-panel.tsx` and `component-panel.tsx` call `useAutoScroll` and, on every edge scroll tick, manually offset **all** DOM nodes (panels/components). This simulates camera movement but desynchronizes positions and makes future zoom logic brittle.
- `lib/constants/z-index.ts` exposes `NOTES_CANVAS`, `POPUP_OVERLAY`, `POPUP_BASE`, etc. Component panels hardcode `zIndex = 1000` while canvas panels use the `PANEL_Z_INDEX` helper.
- Overlay focus/hover logic is still mouse-based; the LayerProvider toggles between `notes` and `popups` immediately when popup count changes, leading to flicker.

---

## 1) Z-Index Tokens That Coexist With Today’s Values

**Objective:** introduce reusable node/UI tokens without disrupting existing consumers.

1. Extend `lib/constants/z-index.ts` instead of mutating existing keys. Example:
   ```ts
   export const Z_INDEX = {
     ...,
     CANVAS_NODE_BASE: 110,
     CANVAS_NODE_ACTIVE: 160,
     CANVAS_UI: 300,
   } as const
   ```
   - Keep `NOTES_CANVAS`, `POPUP_OVERLAY`, etc. untouched for backward compatibility.
2. Update `components/canvas/canvas-panel.tsx` and `component-panel.tsx` to derive `style.zIndex` from the new constants (fallback to old logic via feature flag, see §5).
3. Adjust `EnhancedMinimap`/`CanvasControls` only if necessary (they already sit above 100, verify with a quick audit).

**Safety:** extending the enum avoids breaking imports; feature flag ensures we can disable new z-order without reverting files.

---

## 2) Camera-Based Edge Pan (Incremental Refactor)

**Objective:** stop moving every DOM node during auto-scroll and update the shared camera instead.

1. Introduce a helper in `components/canvas/canvas-context.tsx` (or a new `useCameraPan` hook) that exposes `panCameraBy({ dx, dy })`, internally dispatching `SET_CANVAS_STATE` with translated values using the current zoom:
   ```ts
   const worldDX = screenDX / state.canvasState.zoom
   dispatch({ type: 'SET_CANVAS_STATE', payload: {
     translateX: state.canvasState.translateX + worldDX,
     translateY: state.canvasState.translateY + worldDX,
   }})
   ```
2. In `canvas-panel.tsx` edge-scroll handler, replace the “move every panel” loop with `panCameraBy`. Track the accumulated camera movement in a `useRef` so drop coordinates account for the pan offset (`final = initial + delta - cameraAccum`).
3. Mirror the same change in `component-panel.tsx` so components reuse the camera (no separate DOM shifting).
4. Keep the legacy behavior behind a runtime flag: when `NEXT_PUBLIC_CANVAS_CAMERA !== '1'`, fall back to the existing DOM adjustments.

**Dependencies:** ensure `useAutoScroll` continues to fire. Verify we don’t break the plain-mode provider, which still expects panels positioned via inline styles.

---

## 3) Pointer-Friendly Overlay Triggers

**Objective:** switch hover triggers to pointer events while preserving existing mouse behavior.

1. Update `handleFolderHover` / `handleFolderHoverLeave` (`components/notes-explorer-phase1.tsx`) to accept `React.PointerEvent`.
2. Swap `onMouseEnter/onMouseLeave` to `onPointerEnter/onPointerLeave` for tree items and popup overlay children. Cast only where necessary (`as React.PointerEvent<HTMLDivElement>`) to keep TypeScript happy.
3. Ensure legacy browsers (Safari) still receive the events by testing on macOS; pointer events are standard but we should guard with e.g. `if (!('PointerEvent' in window))` fallback if we detect regressions.

---

## 4) Intent-Based Layer Switching

**Objective:** delay layer toggles until the overlay is genuinely in use, eliminating the first-popup flicker.

1. In `notes-explorer-phase1.tsx`, keep a `pointerInOverlay` / `focusInOverlay` ref. Debounce layer recalculations (150 ms) using `setTimeout` to avoid rapid toggles.
2. Update `PopupOverlay` to emit `onOverlayPointerChange(boolean)` and `onOverlayFocusChange(boolean)` props so the parent can set intent refs.
3. Layer decision logic:
   ```ts
   const anyPopups = hoverPopovers.size > 0
   const intent = hasPersistent || pointerInOverlay || focusInOverlay
   const target = anyPopups && intent ? 'popups' : 'notes'
   ```
4. Continue supporting the old behavior when the feature flag (see §5) is off.

---

## 5) Feature Flag & Rollback Strategy

- Introduce `NEXT_PUBLIC_CANVAS_CAMERA=0|1` (default `0`). When disabled, keep today’s DOM-pan path and legacy z-index behavior. Encapsulate new code in conditional branches so rollbacks mean flipping the env variable.
- Optional UI toggle: add a temporary switch in `components/annotation-app.tsx` (dev only) to flip the flag without reload.

---

## 6) Test Checklist

- **Camera Pan:** drag a panel/component to the viewport edge with zoom ≠ 1; camera should move smoothly and node should land exactly under the cursor on drop.
- **Z-Index:** active panel/component sits above other nodes but below popup overlay; minimap remains on top.
- **Overlay Intent:** opening the first popup keeps the layer on `notes` until the pointer/focus enters the overlay; leaving the overlay flips back after the debounce.
- **Plain Mode:** ensure Option A still persists panel positions via localStorage and no console errors appear.

---

## 7) Out of Scope / Follow-ups

- Component snapping, keyboard camera controls, menu-aim for hover popovers.
- Unit tests for `panCameraBy` once the core behavior stabilizes.

---

## 8) Summary

This revision keeps the proposal compatible with the reverted codebase:

- We extend (not replace) z-index tokens.
- Camera refactor is gated and mirrors the present `useAutoScroll` integrations.
- Overlay changes respect the latest explorer implementation.

Apply step-by-step with the feature flag to protect production. EOF
