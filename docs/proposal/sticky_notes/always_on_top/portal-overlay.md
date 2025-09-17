# Sticky Notes — Always-On-Top Portal (2025-09-09)

## Problem
- Sticky notes rendered inside the canvas layer inherited the same stacking context as panels and popup overlays. Whenever a popup, badge, or other floating UI used a higher `z-index`, sticky notes slipped underneath, breaking the “always visible” expectation.

## Fix Summary
- Created a dedicated `document.body` portal for sticky notes so they no longer share the canvas stacking context.
- Portal root is a fixed, full-screen container (`#sticky-note-overlay-root`) with `pointer-events: none` and `z-index: 12000`; each sticky note keeps `pointer-events: auto` so it remains draggable.
- Rendered sticky notes into the portal via `createPortal` while leaving other component types untouched.

## Applied Code
```diff
diff --git a/components/annotation-canvas-modern.tsx b/components/annotation-canvas-modern.tsx
--- a/components/annotation-canvas-modern.tsx
+++ b/components/annotation-canvas-modern.tsx
@@
-import { useEffect, useState, forwardRef, useImperativeHandle, useRef, useCallback, useMemo } from "react"
+import { useEffect, useState, forwardRef, useImperativeHandle, useRef, useCallback, useMemo } from "react"
+import { createPortal } from "react-dom"
@@
   const [showAddComponentMenu, setShowAddComponentMenu] = useState(false)
+  const [stickyOverlayEl, setStickyOverlayEl] = useState<HTMLElement | null>(null)
@@
  useEffect(() => {
    document.addEventListener('mousemove', handleCanvasMouseMove)
    document.addEventListener('mouseup', handleCanvasMouseUp)
    
    return () => {
      document.removeEventListener('mousemove', handleCanvasMouseMove)
      document.removeEventListener('mouseup', handleCanvasMouseUp)
    }
  }, [canvasState.isDragging, canvasState.lastMouseX, canvasState.lastMouseY])
+
+  useEffect(() => {
+    if (typeof document === 'undefined') return
+
+    const overlay = document.createElement('div')
+    overlay.id = 'sticky-note-overlay-root'
+    overlay.style.position = 'fixed'
+    overlay.style.inset = '0'
+    overlay.style.pointerEvents = 'none'
+    overlay.style.zIndex = '12000'
+    document.body.appendChild(overlay)
+    setStickyOverlayEl(overlay)
+
+    return () => {
+      document.body.removeChild(overlay)
+      setStickyOverlayEl(null)
+    }
+  }, [])
@@
-        {stickyNoteItems.length > 0 && (
-          <div
-            className="pointer-events-none fixed inset-0 z-[12000]"
-          >
-            {stickyNoteItems.map(component => (
-              <StickyNoteOverlayPanel
-                key={component.id}
-                id={component.id}
-                position={component.position}
-                onClose={handleComponentClose}
-                onPositionChange={handleComponentPositionChange}
-              />
-            ))}
-          </div>
-        )}
+        {stickyOverlayEl && stickyNoteItems.length > 0 && createPortal(
+          stickyNoteItems.map(component => (
+            <StickyNoteOverlayPanel
+              key={component.id}
+              id={component.id}
+              position={component.position}
+              onClose={handleComponentClose}
+              onPositionChange={handleComponentPositionChange}
+            />
+          )),
+          stickyOverlayEl
+        )}
```

## Verification
- Restarted the dev server to attach the new portal node.
- Added a sticky note, opened multi-layer popups, and confirmed the note stays on top while remaining draggable.
- Checked that other components continue to render in their original layers with no pointer interference.

## Follow-up Ideas
- Persist sticky-note screen positions separately so they’re resilient to future camera refactors.
- Consider a user toggle to temporarily hide all sticky notes when working in popup mode.
