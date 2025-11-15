# Non-Main Panel Recentering Fix

## Issue
- After each reload, at least one child (non-main) panel briefly appeared directly on top of its parent or at the viewport center before snapping to the correct world position.
- Cause: `useCanvasNoteSync` re-created panels with the default centered coordinates whenever hydration rebuilt `canvasItems`. Even though the data store already had persisted world positions, the hook replaced them with the fallback center until a user interaction triggered persistence again. Hydration then corrected the position, producing a visible “jump.”

## Fix
1. **Rehydrate Panel Positions:** `useCanvasNoteSync` now looks up each panel’s `worldPosition` (or `position`) from `dataStore`/`branchesMap` before rebuilding `canvasItems`. When a stored coordinate exists, it replaces the default center so non-main panels keep their saved world-space location across sync cycles.
2. **Hydration-Aware Rendering:** `PanelsRenderer` accepts a `hydrationReady` flag and defers rendering of non-main panels until `useCanvasHydration` succeeds. This prevents child panels from rendering at the default center for a single frame before the stored coordinates are applied.
3. **Hydration Key:** `useCanvasNoteSync` also keys its effect on the hydration status (`success` + number of hydrated panels) so position rehydration runs immediately after persisted branch data arrives.

Combined, these changes eliminate the center-on-load flash and ensure child branches always render in their last persisted location, even after multiple reloads.
