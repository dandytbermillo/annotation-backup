# Unified Canvas Nodes & Camera Pan — Updated Implementation Plan (2025-09-16)

> **Status:** Proposal only. No code applied.
>
> Goal: bring Option A’s canvas closer to Figma/Miro behavior without breaking the current plain-mode flow. Plan reflects the repository after the recent revert (e.g. `lib/constants/z-index.ts` reintroduced legacy tokens, `components/canvas/canvas-panel.tsx` still moves DOM nodes directly).

---

## 0) Current Baseline (Confirmed 2025-09-16)

- `components/canvas/canvas-panel.tsx` and `component-panel.tsx` call `useAutoScroll` and, on every edge scroll tick, manually offset **all** DOM nodes (panels/components). This simulates camera movement but desynchronizes positions and makes future zoom logic brittle.
- `lib/constants/z-index.ts` exposes `NOTES_CANVAS`, `POPUP_OVERLAY`, `POPUP_BASE`, etc. Component panels hardcode `zIndex = 1000` while canvas panels use the `PANEL_Z_INDEX` helper.
- Overlay focus/hover logic is still mouse-based; the LayerProvider toggles between `notes` and `popups` immediately when popup count changes, leading to flicker.
- Panels remain heavier than component widgets (TipTap editors, isolation, batching). Positioning fixes won’t erase that complexity gap.

---

## Phase 1 — Quick Wins (Optional, 1–2 days)

Give panels parity with component widgets before the full camera refactor.

1. **Simplify panel drag state** so it matches the lighter logic in `component-panel.tsx` (drop the extra RAF/transform accumulation; update position directly).
2. **Unify drag z-index** without touching existing tokens: extend `Z_INDEX` with `CANVAS_NODE_BASE`, `CANVAS_NODE_ACTIVE` and have both panels/components use them while dragging.
3. **Defer TipTap-heavy features while dragging/hidden** (parameterize `tiptap-editor-plain.tsx` so annotation plugins load only when the panel is idle and visible).

None of these steps change persistence or camera math—they just reduce jank while we build the proper system.

---

## Phase 2 — Camera Proof of Concept (2–3 days)

Before touching production code, vet the camera approach in isolation.

1. Build a small test component (`components/canvas/camera-test.tsx`) that renders a couple of fake nodes and lets you drag/pan/zoom them using a shared `camera = { x, y, zoom }` transform. Validate math at zoom 0.5/1/2, edge auto-scroll, drop accuracy.
2. Prototype a `useCanvasCamera`/`panCameraBy` helper (see Phase 3) and confirm it integrates with `CanvasProvider` without disrupting Option A saves.

Only after this POC passes do we toggle feature flags in production modules.

---

## Phase 3 — Incremental Migration (3–4 days)

### 1) Z-Index Tokens That Coexist With Today’s Values

**Objective:** introduce reusable node/UI tokens without disrupting existing consumers.

- Extend `lib/constants/z-index.ts` instead of mutating existing keys:
  ```ts
  export const Z_INDEX = {
    ...Z_EXISTING,
    CANVAS_NODE_BASE: 110,
    CANVAS_NODE_ACTIVE: 160,
    CANVAS_UI: 300,
  } as const
  ```
- Update `components/canvas/canvas-panel.tsx` and `component-panel.tsx` to derive `style.zIndex` from the new constants (fallback to `PANEL_Z_INDEX`/hardcoded values when the feature flag is off).
- Verify ancillary UI (`EnhancedMinimap`, `CanvasControls`) still sits above the canvas nodes.

### 2) Camera-Based Edge Pan

**Objective:** stop moving every DOM node during auto-scroll and update the shared camera instead.

1. Add a camera helper (either `useCanvasCamera` hook or methods on `CanvasProvider`) that exposes `panCameraBy({ dxScreen, dyScreen })`. Important: divide screen deltas by the current zoom to get world-space movement before dispatching `SET_CANVAS_STATE`.
2. In `component-panel.tsx`, swap the `handleAutoScroll` implementation to call `panCameraBy`. Track accumulated camera movement in a ref so final drop coordinates account for the pan offset. Keep the legacy DOM adjustments for emergency rollback only.
3. After components operate correctly, migrate `canvas-panel.tsx` to use the shared helper. The feature now ships enabled by default; use `NEXT_PUBLIC_CANVAS_CAMERA=0` if you need to temporarily opt out during verification.

### 3) Pointer-Friendly Overlay Triggers

- Update `handleFolderHover` / `handleFolderHoverLeave` in `components/notes-explorer-phase1.tsx` to accept `React.PointerEvent`.
- Replace `onMouseEnter`/`onMouseLeave` with pointer-equivalent handlers for tree nodes and popup overlay children (cast events as needed to satisfy TypeScript).
- Test on Safari/Firefox; if pointer events misbehave, fall back to mouse events when `window.PointerEvent` is absent.

### 4) Intent-Based Layer Switching

- Keep refs for `pointerInOverlay` and `focusInOverlay`; debounce layer recalculations (≈150 ms).
- Update `PopupOverlay` to emit `onOverlayPointerChange` / `onOverlayFocusChange` so the parent can set intent and schedule layer decisions. Only switch to the popup layer when popovers exist **and** pointer/focus is inside (or a persistent popup is open).

---

## Phase 4 — Optimizations (Optional)

After the camera path is stable:

- Consider panel virtualization (render panels within viewport + buffer) to reduce DOM load.
- Lazy-load TipTap editors when panels gain focus, show placeholders otherwise.

---

## Rollback Strategy

- The camera path is enabled by default. Set `NEXT_PUBLIC_CANVAS_CAMERA=0` only if you need to temporarily fall back to the legacy DOM-pan logic during verification.
- During development you can still add a dev-only toggle in `components/annotation-app.tsx` to switch modes live, but plan to remove it once the rollout is stable.

---

## Test Checklist

- **Camera Pan:** drag a panel/component to the viewport edge at zoom ≠ 1; camera should move smoothly and the node should land under the cursor when released.
- **Z-Index:** active node sits above others but below overlays; minimap/control overlays remain visible.
- **Overlay Intent:** opening the first popup keeps the layer on `notes` until pointer/focus enters the overlay; leaving it flips back after the debounce.
- **Plain Mode:** Option A persists positions without console errors.

Critical metrics before rolling the flag to production:
- Panels drag smoothly (no position jumps)
- Drop coordinates are accurate
- Frame rate remains acceptable
- No regressions in existing panel features (TipTap, isolation, etc.)

---

## Alternative (“Panel Lite”)

If the full camera system proves too heavy, an alternative is to introduce a simplified panel type that mirrors component behavior (plain text/markdown, no TipTap). This would narrow the complexity gap by reducing panel weight instead of refactoring the shared positioning system.

---

## Summary

- Phase 1 offers short-term relief (simpler drag logic, shared drag z-index, deferred TipTap work).
- Phase 2 validates the camera approach without risking production code.
- Phase 3 migrates components first, then panels, under a feature flag so we can roll back instantly.
- Phase 4 and the “Panel Lite” alternative remain optional follow-ups.

This keeps the plan grounded in today’s code, adds guardrails for rollout, and acknowledges that positioning fixes won’t erase panel complexity—but they will remove the biggest source of desync between panels and components. EOF
