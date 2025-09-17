# Shift+Scroll Zoom Enhancement (2025-09-09)

## Issue
- Zooming the canvas with the mouse wheel felt jumpy and device-dependent.
- Users wanted smooth zoom steps only when holding `Shift`, while plain scrolling should keep panning/scrolling behavior.
- When the helper module handling delta normalization was absent, attempts to reintroduce smoother zooming caused runtime errors.

## Fix Summary
- Restored a shared helper (`lib/canvas/zoom-utils.ts`) that normalizes wheel deltas across devices.
- Updated `components/annotation-canvas-modern.tsx` so the wheel handler:
  - Requires `Shift` to trigger zoom.
  - Calls `getWheelZoomMultiplier(e.nativeEvent)` for smooth scaling.
  - Keeps the existing focal-point math so zoom centers on the cursor.

## Applied Patch
```diff
diff --git a/lib/canvas/zoom-utils.ts b/lib/canvas/zoom-utils.ts
new file mode 100644
--- /dev/null
+++ b/lib/canvas/zoom-utils.ts
@@
+/**
+ * Zoom utility helpers for wheel-based zooming.
+ * Normalizes wheel input so trackpads and mice feel consistent.
+ */
+
+export interface WheelZoomEventLike {
+  deltaX: number
+  deltaY: number
+  deltaMode?: number
+}
+
+const DOM_DELTA_LINE = 1
+const DOM_DELTA_PAGE = 2
+const LINE_HEIGHT_PX = 16
+const PAGE_HEIGHT_PX = 800
+
+function normalizeWheelDelta({ deltaX, deltaY, deltaMode = 0 }: WheelZoomEventLike): number {
+  const dominant = Math.abs(deltaY) >= Math.abs(deltaX) ? deltaY : deltaX
+
+  switch (deltaMode) {
+    case DOM_DELTA_LINE:
+      return dominant * LINE_HEIGHT_PX
+    case DOM_DELTA_PAGE:
+      return dominant * PAGE_HEIGHT_PX
+    default:
+      return dominant
+  }
+}
+
+export interface ZoomMultiplierOptions {
+  intensity?: number
+  maxMagnitude?: number
+}
+
+export function getWheelZoomMultiplier(
+  event: WheelZoomEventLike,
+  { intensity = 0.0006, maxMagnitude = 600 }: ZoomMultiplierOptions = {}
+): number {
+  const normalized = Math.max(
+    -maxMagnitude,
+    Math.min(maxMagnitude, normalizeWheelDelta(event))
+  )
+
+  return Math.exp(-normalized * intensity)
+}
diff --git a/components/annotation-canvas-modern.tsx b/components/annotation-canvas-modern.tsx
--- a/components/annotation-canvas-modern.tsx
+++ b/components/annotation-canvas-modern.tsx
@@
-import {
-  loadStateFromStorage,
-  saveStateToStorage,
-  CANVAS_STORAGE_DEBOUNCE
-} from "@/lib/canvas/canvas-storage"
+import {
+  loadStateFromStorage,
+  saveStateToStorage,
+  CANVAS_STORAGE_DEBOUNCE
+} from "@/lib/canvas/canvas-storage"
+import { getWheelZoomMultiplier } from "@/lib/canvas/zoom-utils"
@@
   const handleWheel = (e: React.WheelEvent) => {
     // Only zoom if Shift key is held down
     if (!e.shiftKey) {
       // Allow normal scrolling when Shift is not pressed
       return
     }
 
     e.preventDefault()
 
-    const zoomFactor = e.deltaY > 0 ? 0.9 : 1.1
-    const newZoom = Math.max(0.3, Math.min(2, canvasState.zoom * zoomFactor))
+    const multiplier = getWheelZoomMultiplier(e.nativeEvent)
+    const newZoom = Math.max(0.3, Math.min(2, canvasState.zoom * multiplier))

     const rect = e.currentTarget.getBoundingClientRect()
     const mouseX = e.clientX - rect.left
     const mouseY = e.clientY - rect.top
```

## Verification
- Restarted the Next.js dev server to clear stale chunks.
- Confirmed Shift+scroll zooms smoothly on both mouse and trackpad; plain scrolling remains unchanged.
- Ensured the helper import resolves correctly to avoid the previous `originalFactory` runtime error.

## Follow-up Ideas
- Add automated tests for `getWheelZoomMultiplier` to catch regressions in delta normalization.
- Consider exposing an intensity setting in user preferences for power users who want faster/slower zoom.
