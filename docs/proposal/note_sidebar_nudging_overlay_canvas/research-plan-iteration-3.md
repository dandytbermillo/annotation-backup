# Overlay Drift + Sidebar Clip — Iteration 3 Research Plan

## Current Symptoms
- Opening or closing the Notes sidebar still nudges the popup overlay horizontally.
- After the latest guard attempt, a vertical “dead zone” now appears between the sidebar and overlay that slices the popup content (see screenshot).

## Key Questions
1. Which layer is actually moving when the sidebar toggles — the canvas transform, the overlay container, or the popup positions stored in `hoverPopovers`?
2. Why does the guard zone extend into the canvas (causing the popup to be clipped) instead of stopping at the sidebar edge?
3. Are pointer events and layout calculations using the same coordinate reference (client vs. canvas vs. screen)?

## Investigation Tasks
1. **Overlay Transform Snapshot**
   - Log `containerRef.style.transform`, `activeTransform`, and `transformRef.current` before and after sidebar toggle.
   - Compare with the canvas’ own transform (`ModernAnnotationCanvas` state).

2. **Popup Position Audit**
   - For each `hoverPopovers` entry, log both `canvasPosition` and screen `position` during sidebar toggle.
   - Verify whether the drift equals the sidebar width (~320px) or another offset.

3. **Guard Width vs. Clip**
   - Instrument `pointerGuardOffset`, `overlayBounds.left`, and actual sidebar `getBoundingClientRect` to confirm discrepancies.
   - Render a translucent diagnostic div using the guard width to visualize exactly what area is being clipped.

4. **LayerProvider State**
   - Capture `layerCtx.transforms` and `layerCtx.activeLayer` before/after toggles to ensure we’re not being resynced with stale transforms.

5. **Fallback Detection**
   - Detect whether we fall back to the fixed overlay path unexpectedly (e.g., portal missing). If the fallback still uses hard-coded offsets, log that scenario.

## Deliverables
- Consolidated log output showing the values above for a sidebar open/close sequence.
- Screenshot/GIF with the diagnostic overlay visible to measure the clipped area.
- Short write-up identifying which transform/position jumps and why the guard is too wide.
- Proposed code fix only after root cause confirmed.

