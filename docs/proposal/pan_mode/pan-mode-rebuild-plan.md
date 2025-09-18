# Pan Mode Rebuild Plan

## Scope
Restore a reliable "pan-only" mode in Option A by wiring the existing flag into the UI, event routing, and layer-aware drag logic so it coexists with the current Shift+drag overlay.

## Phase 0 – Prep & Audit
- Confirm baseline behavior (Shift+drag overlay, panel/component drags, multi-layer toggling via `useLayerManager`).
- Locate all touch points: `components/canvas/enhanced-control-panel.tsx`, `hooks/use-canvas-events.ts`, `components/canvas/canvas-panel.tsx`, `components/canvas/component-panel.tsx`, `lib/hooks/use-canvas-camera.ts`, `components/canvas/layer-provider.tsx`, Shift-overlay implementation, and relevant tests.
- Decide default state (likely `false`) and whether to persist mode across reloads.

## Phase 1 – UI Surface
- Add a visible toggle (button + tooltip and optional keyboard shortcut) to the control panel, wiring it to `handleTogglePanMode`. Update footer/toolbar to reflect active mode.
- Ensure state initialization in `canvas-context.tsx` (seed `isPanMode` in the reducer and initial state; optionally persist across sessions).

## Phase 2 – Event Pipeline
- Extend `useCanvasEvents` to honor `state.canvasState.isPanMode`:
  - When true, always treat drags as camera pans (ignore component selections/double clicks).
  - Ensure zoom/shift behaviors stay consistent.
- Mirror this logic for touch events if supported.

## Phase 3 – Component/Panel Interaction Lock
- In `CanvasPanel` and `ComponentPanel`, check the pan flag before starting header/body drags; early-return when pan mode is on.
- Optionally add `pointer-events: none` (or visual lock indicator) to headers while pan mode is active so the interaction cue matches behavior.
- Verify auto-scroll (`useAutoScroll`) and camera helpers still receive deltas during pan.

## Phase 4 – Layer Integration
- Use `useLayerManager` / `useFeatureFlag('ui.multiLayerCanvas')` so the toggle applies to whichever layer is active (notes vs popups).
- Decide whether pan mode should affect all layers or only the currently active one; ensure popups don’t intercept drags when the mode is on.
- Update overlay/toolbar messaging so users know which layer is being panned.

## Phase 5 – Shift+Drag Reconciliation
- Reuse the existing Shift-overlay logic when pan mode is on, or disable the overlay when the toggle is active so behaviors don’t clash.
- Confirm shift-drag still functions as a temporary override when pan mode is off.
- Ensure dragging anywhere (headers, component bodies, overlay) pans the canvas consistently in both pathways.

## Phase 6 – Testing & QA
- Add automated tests (unit + integration) to cover:
  - Toggling pan mode on/off and verifying drag outcomes (canvas vs panel/component movement).
  - Multi-layer scenarios (notes vs popups).
  - Shift+drag interaction with and without the toggle.
  - Persistence/reset behavior.
- Manual QA: check keyboard shortcuts, pointer cues, and accessibility hints; verify Electron + browser parity.

## Phase 7 – Documentation & Cleanup
- Update developer docs (including the retrospective) with new behavior and testing instructions.
- Remove dead code if any legacy pan flag usage becomes redundant.
