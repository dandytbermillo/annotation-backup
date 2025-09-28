# Overlay Edge Auto-Scroll — Research Plan

## Context
- The annotation workspace now orchestrates more than one canvas: the primary notes canvas, the popup overlay canvas, and auxiliary panes such as the note sidebar/tree view that anchors folder hover interactions.
- Hovering the sidebar while the overlay layer is active spawns popups on the overlay canvas; those popups are expected to persist and respond to camera motion.

## Problem Statement
Dragging a popup toward the viewport edge should trigger the overlay canvas to pan via auto-scroll so the popup stays under the cursor. After recent refactors, the shared camera often stays still: the pointer reaches the edge, but neither the overlay nor the notes canvas scroll, leaving the popup stuck or snapping back once the cursor re-enters the viewport.

## Research Goals
1. Confirm whether the auto-scroll loop still dispatches deltas to the shared `LayerProvider` camera when the pointer is at the edge.
2. Determine why the popup stays stationary—e.g., is the camera delta cancelled, overwritten, or invisible because screen coordinates are recomputed from stale refs?
3. Check coordination between canvases: the overlay must pan without disturbing the notes canvas or collapsing the note sidebar interactions.
4. Catalogue any race conditions between RAF-driven drag transforms, React state updates, and persistence saves that could zero-out the motion.

## Key Questions
- Do `useAutoScroll` and `handleAutoScroll` still share the current drag context after memoisation updates?
- When multiple canvases are active, does `LayerProvider.updateTransformByDelta('popups', …)` propagate to the DOM container, or is another hook (e.g., notes canvas pan) overriding it the next frame?
- Are refs like `dragScreenPosRef` and `dragDeltaRef` updated with the camera motion, or do they reset the popup to its previous screen position?
- Does the note sidebar (tree view hover) toggle layer visibility mid-drag, cancelling auto-scroll callbacks?
- How do persistence throttles react during edge panning—do they schedule a layout save that conflicts with drag visuals?

## Research Activities
1. **Instrumentation Review**
   - Trace `useAutoScroll` in `components/canvas/use-auto-scroll.ts` to confirm thresholds, velocity calculation, and animation frame lifecycles.
   - Inspect `handleAutoScroll` inside `components/notes-explorer-phase1.tsx` for dependency arrays, ref updates, and calls into `layerContext.updateTransformByDelta`.
   - Verify `LayerProvider` (`components/canvas/layer-provider.tsx`) applies deltas to the popups layer transform when sync pan is enabled.
2. **Reproduction Walkthrough**
   - With the note sidebar open, create a popup via hover, start drag, and log pointer coordinates plus camera deltas (instrument with `debugLog`).
   - Compare behaviour when only the overlay canvas is visible versus when both notes canvas and overlay share the viewport.
3. **Cross-Layer Interaction Audit**
   - Identify whether note sidebar shortcuts (tab toggles) or multi-layer gating resets the active layer during drag.
   - Ensure the overlay container is still mounted inside `#canvas-container`; confirm there is exactly one DOM transform origin for both canvases.
4. **Ref / State Sync Examination**
   - Confirm that `draggingPopup`, `dragScreenPosRef`, and `hoverPopovers` stay consistent while auto-scroll runs; capture whether React state overrides the ref-adjusted values on the next render.
   - Evaluate whether RAF-driven transforms collide with the React reconciliation path (e.g., component rerender resetting `style.transform`).
5. **Regression Comparison**
   - Cross-check against the baseline project `/Users/dandy/Downloads/infinite-canvas-main` for auto-scroll heuristics and layer camera integration.

## Risks & Constraints
- Multiple canvases sharing a camera can introduce gesture arbitration conflicts—dragging the overlay while the notes canvas believes it owns the gesture may cancel motions.
- The note sidebar must remain responsive; any change that blocks sidebar hover events or collapses the tree would impact core navigation.
- Auto-scroll must avoid reintroducing jitter or runaway pan loops when popups rest near the edge.

## Affected Files
- `components/notes-explorer-phase1.tsx`
- `components/canvas/popup-overlay.tsx`
- `components/canvas/use-auto-scroll.ts`
- `components/canvas/layer-provider.tsx`
- `lib/utils/coordinate-bridge.ts`
- `lib/rendering/connection-line-adapter.ts`
- `lib/adapters/overlay-layout-adapter.ts`

## Deliverables
- Annotated findings describing where auto-scroll signals diverge from expected behaviour.
- Recommendations (or patch previews) outlining how to restore smooth edge-driven panning without breaking multi-canvas coordination.
- Optional instrumentation patch to surface camera delta/debug logs for future regression checks.
