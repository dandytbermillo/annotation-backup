# Overlay Sidebar Drift — Iteration 2 Research Plan

## Problem Snapshot
Despite multiple patch attempts, two regressions persist in plain mode:
- When the Notes sidebar toggles, overlay popups and sticky overlays still shift horizontally instead of remaining anchored to their canvas coordinates.
- While the overlay layer is active, the sidebar’s close/toggle controls intermittently stop receiving pointer events.

Previous changes (pointer guards, z-index adjustments, recompute suppression) have not been validated end-to-end, indicating an underlying coordination bug rather than a styling quirk.

## Affected Surfaces
- `components/canvas/popup-overlay.tsx` – overlay bounds, transform dispatch, pointer capture.
- `components/notes-explorer-phase1.tsx` – hover popover lifecycle, layer switching (`setActiveLayer`), persisted layout hydration.
- `components/annotation-app.tsx` – sidebar open/close state and container composition.
- `components/canvas/layer-provider.tsx` – shared transforms for `notes` and `popups` layers.
- `lib/utils/coordinate-bridge.ts` – conversions when popups migrate between screen/canvas coordinates.

## Hypotheses
1. **Transform Drift**: `layerContext.transforms.popups` is being recomputed when the sidebar closes, reapplying a global translate equal to the sidebar width.
2. **Bounds Mutation**: `recomputeOverlayBounds()` continues to subtract the sidebar width or re-run after every CSS transition, causing an 320px offset regardless of the latest patch.
3. **Popup Rehydration**: Toggling `isNotesExplorerOpen` triggers `hoverPopovers` to rehydrate from persisted layout, using screen coordinates captured while the sidebar was hidden.
4. **Pointer Capture Leakage**: The overlay container never releases pointer capture when `setActiveLayer('notes')` executes, so subsequent pointer events to the sidebar are swallowed.

## Data to Collect
1. **Layer Transform Timeline**
   - Instrument `layer-provider` (specifically `setActiveLayer` and `updateTransform`) to log the full `transforms.popups` object before/after sidebar toggles.
   - Capture `canvasState.translateX/translateY/zoom` from `ModernAnnotationCanvas` when the shift occurs.

2. **Overlay Bounds & Pointer Guard**
   - Log `overlayBounds` and any computed guard offset immediately before and after `recomputeOverlayBounds()` runs.
   - Confirm whether bounds recompute is triggered by the sidebar’s CSS transition, resize observer, or window resize listener.

3. **Hover Popover Lifecycle**
   - Dump the serialized `hoverPopovers` map (IDs, `canvasPosition`, `position`) for each mutation. Compare positions before toggle, immediately after toggle, and after clicking the canvas again.
   - Check whether `applyPlainOverlayOffsetToPopups` (plain-mode auto-scroll) is invoked during sidebar open/close.

4. **Pointer Event Routing**
   - Temporarily add listeners to the sidebar root to confirm whether pointerdown events arrive while a popup is open.
   - Verify whether `onPointerEnter/Leave` handlers on the overlay are flipping any global state that disables the sidebar toggle.

5. **Fallback Path**
   - Force the popup overlay portal to fail (e.g., by temporarily renaming `#canvas-container`) and observe whether the fixed-position fallback still uses hard-coded offsets.

## Investigation Tasks
1. **Enable Targeted Logging**
   - Add development-only `debugLog` entries in the files above capturing transforms, bounds, popover data, and pointer events.
   - Ensure logs include timestamps and sidebar state to align events chronologically.

2. **Reproduce with Logging**
   - Open a note, spawn a popup, toggle the sidebar open/closed multiple times.
   - Record log output focusing on: `transform_applied`, `overlay_bounds_updated`, `hover_popovers_mutated`, and any new pointer logs.

3. **Isolate Trigger**
   - Identify which log entries coincide with the popup movement (e.g., transform delta equals ~320px) to pinpoint the responsible code path.
   - If `hoverPopovers` positions jump by ~sidebar width, focus on the layout adapter and `CoordinateBridge` conversions. If transforms jump, focus on `LayerProvider` dispatch.

4. **Validate Pointer Guard**
   - Confirm whether the computed guard offset equals the measured sidebar width. If so, ensure it’s actually subtracting from the interactive area in the overlay DOM.
   - Verify that the sidebar toggle button still sits above the overlay (`Z_INDEX.SIDEBAR` check).

5. **Document Findings**
   - Summarize evidence (logs, transform deltas, pointer capture status) in `docs/proposal/note_sidebar_nudging_overlay_canvas/research_result.md` before attempting another fix.

## Exit Criteria
- Clear identification of which subsystem (transform dispatch, popover hydration, or pointer guard) introduces the horizontal shift.
- Reproducible instructions and log references that explain why the sidebar loses pointer interaction when popups are active.
- A verified hypothesis to drive the next corrective patch (with instrumentation ready to validate the fix).
