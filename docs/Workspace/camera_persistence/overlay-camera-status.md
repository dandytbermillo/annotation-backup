# Overlay Camera Persistence – Implementation Notes

## Summary
Per-workspace camera persistence is now fully wired through the stack:

- **Schema**: `OverlayLayoutPayload` stores a `camera { x, y, scale }` block. Default is identity so legacy layouts stay valid.
- **Backend**: `app/api/overlay/layout/shared.ts` keeps the `camera` field when normalizing payloads, so writes to `overlay_layouts` now include the viewport transform. Schema version bumped to `2.2.0`.
- **Hydration**: `buildHydratedOverlayLayout` includes the camera in its hash and returns the persisted transform, which `AnnotationApp` applies via the new `layerContext.setTransform('popups', camera)` before rendering popups.
- **Save Path**: `buildLayoutPayload` adds `camera` to the payload and hash. Camera deltas trigger the same debounced save path as popup moves, and hashes compare against layouts that may or may not carry `camera` (fallback to identity).
- **Layer Provider**: A new `setTransform` API lets consumers apply absolute transforms instead of deltas only, enabling camera restore without side effects.

## Testing Expectations
- Dragging the canvas updates `camera`; switching workspaces or reloading restores the exact viewport users left.
- Layout hashes change when only the camera changes, ensuring persistence even without popup movement.
- Legacy layouts (missing `camera`) still load, default to identity, and start persisting once saved.
