# Pan Mode Retrospective (Option A Canvas)

## Background

During the "control panel" work (commit `5d7582c8290dff9e57d0413e188490692c9cfed6`, "control panel is added"),
we introduced a `Pan / Select` toggle concept so users could temporarily disable panel drags and treat the
canvas like a camera surface.
The change added a new `canvasState.isPanMode` flag and UI affordances inside
`components/canvas/enhanced-control-panel.tsx`, but we never finished the plumbing that
would make the toggle affect pointer handling. Users later reported the button either never appeared or
had no effect: components kept grabbing focus, the X button still dragged the canvas, and layered popups
stayed interactive.

## What Was Implemented

The control panel introduced a handler to flip a new `isPanMode` flag:

```tsx
// components/canvas/enhanced-control-panel.tsx#L105-L119
const handleTogglePanMode = () => {
  dispatch({
    type: 'SET_CANVAS_STATE',
    payload: {
      isPanMode: !state.canvasState.isPanMode,
    },
  })
}
```

The footer also surfaced the current mode:

```tsx
// components/canvas/enhanced-control-panel.tsx#L718-L724
<div className="flex justify-between">
  <span>Mode:</span>
  <span className="text-white">{state.canvasState.isPanMode ? 'Pan' : 'Select'}</span>
</div>
```

`types/canvas.ts` gained an optional `isPanMode?: boolean` field, so the reducer could store the flag, but the
initial state never set a default value.

### Canvas Panels vs. Components (structure at the time)

- **Panels** (`CanvasPanel` in `components/canvas/canvas-panel.tsx`)
  - Represent note branches (`panelId`, `branch` data) and render Tiptap editors.
  - Use `useCanvasCamera()` to follow camera translations and participate in auto-scroll.
  - Register themselves with the multi-layer manager (`useLayerManager` / `useCanvasNode`) so layer toggles can
    enable or disable editing depending on whether the "notes" or "popups" layer is active.
  - Drag interactions originate from panel headers; body drags feed back into the camera helpers via
    `panCameraBy({ dxScreen, dyScreen })`.

- **Components** (`calculator`, `timer`, `sticky-note`, etc. rendered by `ComponentPanel`)
  - Added to the canvas through the control panel (`handleAddComponent`).
  - Each component panel wraps its widget and exposes a draggable header (`.component-header`); the body usually consumes
    its own pointer events (e.g., calculator buttons) and does not forward drags.
  - Like note panels, component panels call `useLayerManager()` / `useCanvasNode()` so the layer system can control
    z-index and focus, but their drag logic is separate and must be toggled independently when locking interactions.
  - Dragging relies on the same `useCanvasCamera()` helpers for panning, but only across the header; bodies remain inert.

- **Canvas item metadata** (`types/canvas-items.ts`)
  - Normalizes both panels and components into a shared `CanvasItem` type to drive counting/stats in the control
    panel (`itemType: 'panel' | 'component'`, `componentType`, etc.).
  - This consolidation means the control panel can enumerate total panels/components, but “pan mode” needs to deal
    with two distinct drag pipelines.

Because `CanvasPanel` and the component wrappers manage their own pointer state, any global toggle (pan mode, lock
layer) must coordinate with both code paths. The original pan-mode experiment never bridged that gap.

## Why It Did Not Work

1. **No UI wiring** — `handleTogglePanMode` is never invoked. The original control panel layout never added a
   button (or keyboard shortcut) that calls the handler, so the mode always remains `undefined → false`.

2. **Event system ignores the flag** — the core drag/zoom hooks (`hooks/use-canvas-events.ts`) continue to
   treat every background `mousedown` as a request to start panning the camera, regardless of any
   `isPanMode` flag:

   ```tsx
   // hooks/use-canvas-events.ts#L10-L36 (excerpt)
   const startDrag = (e: MouseEvent) => {
     if (e.target && (e.target as Element).closest('.panel') && !(e.target as Element).closest('.panel-header')) return

     dispatch({
       type: 'SET_CANVAS_STATE',
       payload: {
         isDragging: true,
         lastMouseX: e.clientX,
         lastMouseY: e.clientY,
       },
     })
   }
   ```

   There is no `state.canvasState.isPanMode` guard, so toggling the flag would not change behaviour even if the
   UI were calling it.

3. **Panels remain interactive** — `CanvasPanel` continues to listen for drag gestures on its headers and propogates
   movement via the existing `useCanvasCamera` helpers. Nothing disables panel drags when the canvas is in "pan" mode,
   so components still capture pointer events while the canvas translates underneath. Later changes that auto-detect
   the active layer (notes vs popups) rely on that same `useLayerManager` pipeline. Because pan mode never integrated
   with those layer guards, it was blind to which canvas was "active" and never blocked pointer events on
   off-layer content.

4. **Initial state blind spot** — `canvas-context.tsx` never seeded `isPanMode`, so even if a user flipped it to `true`
   (via console), subsequent loads defaulted back to `undefined`, and the footer reverted to “Select” on refresh.

5. **UI placement / layer cues** — in later experiments (after the multi-layer canvas rollout) the panel moved toward
   the top-right and we introduced automatic layer detection so only items on the "active" layer respond to input.
   Pan mode was never updated to reflect those cues, so users saw neither a visible toggle nor any shift in
   interaction when layers flipped. Reports like “I don’t see the pan button” or “pan mode is helpless while components
   are still interactive” stem from that combination: no control surfaced, and the layer-aware logic continued to
   behave as if pan mode didn’t exist.
6. **Shift+drag goal remains unmet** — the current goal is to let users hold Shift and drag anywhere to pan the canvas
   without pulling components. The legacy pan-mode attempt never coordinated with that shortcut, and in practice only
   panel bodies (not headers) responded. Third-party components—calculator, timer, alarm, etc.—refused to move under
   the pan flag and still consumed drags even while Shift was pressed. This mismatch is why we ultimately reverted to
   the dedicated Shift-to-pan overlay: it reliably disables component drags and works across all layer types, whereas
   the pan-mode flag did neither.

## Current Codebase Status (September 2025)

- `CanvasState` still exposes an optional `isPanMode`, but no feature reads it.
- `EnhancedControlPanel` displays the mode status yet offers no control to toggle it.
- `useCanvasEvents` and `CanvasPanel` continue to respond exactly as before: background drags pan the camera;
  panel drags move components; popups remain interactive.
- The multi-layer system auto-detects which canvas layer (notes vs popups) is active and routes pointer events
  accordingly, but pan mode never plugged into that detection, so the flag remains unused in every layer.
- The UI now relies on the “Shift + drag” overlay implementation for manual panning and is expected to keep
  panel drags intact.

## Lessons Learned

- Adding a flag without updating the event handlers led to a false sense of progress. Every pointer pipeline
  (background pan, component drags, popups) needs to enforce the new mode.
- Surface area matters: the toggle must be discoverable (button or shortcut) and needs visual affordances to
  indicate when components are locked.
- Before landing UI affordances, we should validate the behaviour behind feature flags or integration tests so
  regressions are obvious during QA.

## Next Steps (if we revisit pan mode)

1. Decide whether Option A should expose a dedicated pan toggle, or if the current
   Shift-to-pan overlay (which already respects layer detection and component interactivity) is sufficient.
2. If we reintroduce the toggle:
   - Render a visible button or shortcut wired to `handleTogglePanMode`.
   - Update `useCanvasEvents` to respect `isPanMode` (ignore component drags, redirect pointer events to camera).
   - Temporarily disable panel-level drag handles (e.g., add `pointer-events: none` to headers) while in pan mode.
   - Hook into the existing layer detection (`useLayerManager`, `useFeatureFlag('ui.multiLayerCanvas')`) so the
     toggle reflects the active canvas and doesn’t interfere with popup interactions.
   - Add tests so the flag flipping actually changes behaviour.
3. Otherwise, remove the dead code (`isPanMode` flag, unused handler) to avoid confusion.

This retrospective should give enough context to rebuild the feature deliberately if we decide to bring it back.
