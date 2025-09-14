Title: Popup Overlay Pan — Scope + Pointer Capture + Active Gating (Patch Preview)

Context
- Symptom: Dragging on popup overlay does not move popups together even when the "popups" indicator is on.
- Likely causes:
  1) Overlay is interactive but the handler is in a different file than the one actually used.
  2) Pointer capture missing (pointermove stops after crossing child nodes).
  3) Overlay interactivity gated solely on `popups.size` with transient empty states.
  4) Overlay spans too broadly (z-index or scoping issues), causing event suppression elsewhere.

Goals
- Ensure we edit the actual overlay component in use (`components/canvas/popup-overlay.tsx`).
- Add robust Pointer Events + capture with hysteresis.
- Gate interactivity by active layer AND popups count.
- Keep overlay scoped to the canvas area to avoid sidebar conflicts (phaseable change).
- Remove mixed mouse/document handlers to avoid duplication with pointer events.

Files Affected
- components/canvas/popup-overlay.tsx (primary)
- components/notes-explorer-phase1.tsx (import path verification only)
- lib/constants/z-index.ts (optional: ensure sidebar wins)

Patch 1 — Use layer context + pointer capture + hysteresis
```diff
diff --git a/components/canvas/popup-overlay.tsx b/components/canvas/popup-overlay.tsx
@@
 import { useLayer } from '@/components/canvas/layer-provider';
@@
 export const PopupOverlay: React.FC<PopupOverlayProps> = ({
@@
 }) => {
   const multiLayerEnabled = useFeatureFlag('ui.multiLayerCanvas' as any);
-  
-  // Self-contained transform state (like notes canvas)
-  const [transform, setTransform] = useState({ x: 0, y: 0, scale: 1 });
-  const [isPanning, setIsPanning] = useState(false);
-  const [activeLayer, setActiveLayer] = useState('popups'); // Local active state
+
+  // Self-contained transform state (infinite-canvas pattern)
+  const [transform, setTransform] = useState({ x: 0, y: 0, scale: 1 });
+  const [isPanning, setIsPanning] = useState(false);
+  const [engaged, setEngaged] = useState(false); // hysteresis engaged
+
+  // Use LayerProvider to gate interactivity by active layer
+  const layerCtx = useLayer();
+  const isActiveLayer = !!layerCtx && layerCtx.activeLayer === 'popups';
@@
   const overlayRef = useRef<HTMLDivElement>(null);
   const containerRef = useRef<HTMLDivElement>(null);
   const panStartRef = useRef({ x: 0, y: 0 });
   const lastMouseRef = useRef({ x: 0, y: 0 });
+  const pointerIdRef = useRef<number | null>(null);
@@
   const isOverlayEmptySpace = useCallback((e: React.PointerEvent) => {
@@
   }, []);
 
   // Handle pan start (simplified like notes canvas)
-  const handlePointerDown = useCallback((e: React.PointerEvent) => {
+  const handlePointerDown = useCallback((e: React.PointerEvent) => {
     // Only start panning if clicking on empty space
-    if (!isOverlayEmptySpace(e)) {
+    if (!isOverlayEmptySpace(e)) {
       return;
     }
+    // Gate by layer/activity and popups presence
+    const hasPopups = popups.size > 0;
+    if (!isActiveLayer || !hasPopups) return;
 
     debugLog('PopupOverlay', 'pan_start', { 
@@
-    setIsPanning(true);
-    panStartRef.current = { x: e.clientX, y: e.clientY };
-    lastMouseRef.current = { x: e.clientX, y: e.clientY };
+    setIsPanning(true);
+    setEngaged(false); // reset hysteresis
+    panStartRef.current = { x: e.clientX, y: e.clientY };
+    lastMouseRef.current = { x: e.clientX, y: e.clientY };
+    pointerIdRef.current = e.pointerId;
+
+    // Capture pointer for robust dragging across children
+    overlayRef.current?.setPointerCapture?.(e.pointerId);
 
     // Optimize for dragging
     document.body.style.userSelect = 'none';
     if (containerRef.current) {
       containerRef.current.style.willChange = 'transform';
     }
 
     e.preventDefault();
-  }, [isOverlayEmptySpace, transform]);
+  }, [isOverlayEmptySpace, transform, isActiveLayer, popups.size]);
 
   // Handle pan move (simplified like notes canvas)
-  const handlePointerMove = useCallback((e: React.PointerEvent) => {
-    if (!isPanning) return;
+  const handlePointerMove = useCallback((e: React.PointerEvent) => {
+    if (!isPanning || pointerIdRef.current === null) return;
+    // Respect capture: if not captured, ignore
+    if (overlayRef.current?.hasPointerCapture && !overlayRef.current.hasPointerCapture(pointerIdRef.current)) return;
 
     const deltaX = e.clientX - lastMouseRef.current.x;
     const deltaY = e.clientY - lastMouseRef.current.y;
+
+    // 3–5px hysteresis to distinguish click vs pan
+    if (!engaged) {
+      const dx0 = e.clientX - panStartRef.current.x;
+      const dy0 = e.clientY - panStartRef.current.y;
+      if (Math.hypot(dx0, dy0) < 4) return;
+      setEngaged(true);
+    }
 
     // Update transform directly
     setTransform(prev => {
@@
     lastMouseRef.current = { x: e.clientX, y: e.clientY };
-  }, [isPanning, transform]);
+  }, [isPanning, engaged]);
 
   // Handle pan end (simplified)
   const handlePointerEnd = useCallback(() => {
     if (!isPanning) return;
@@
     setIsPanning(false);
+    setEngaged(false);
+    if (pointerIdRef.current !== null) {
+      overlayRef.current?.releasePointerCapture?.(pointerIdRef.current);
+      pointerIdRef.current = null;
+    }
 
     // Reset styles
     document.body.style.userSelect = '';
     if (containerRef.current) {
       containerRef.current.style.willChange = '';
     }
-  }, [isPanning, transform]);
+  }, [isPanning]);
@@
-  // Setup document-level mouse event listeners (like notes canvas)
-  useEffect(() => {
-    const handleMouseMove = (e: MouseEvent) => {
-      if (!isPanning) return;
-      
-      const deltaX = e.clientX - lastMouseRef.current.x;
-      const deltaY = e.clientY - lastMouseRef.current.y;
-      
-      setTransform(prev => ({
-        ...prev,
-        x: prev.x + deltaX,
-        y: prev.y + deltaY
-      }));
-      
-      lastMouseRef.current = { x: e.clientX, y: e.clientY };
-    };
-    
-    const handleMouseUp = () => {
-      if (isPanning) {
-        setIsPanning(false);
-        document.body.style.userSelect = '';
-        if (containerRef.current) {
-          containerRef.current.style.willChange = '';
-        }
-      }
-    };
-    
-    document.addEventListener('mousemove', handleMouseMove);
-    document.addEventListener('mouseup', handleMouseUp);
-    
-    return () => {
-      document.removeEventListener('mousemove', handleMouseMove);
-      document.removeEventListener('mouseup', handleMouseUp);
-    };
-  }, [isPanning]);
+  // Remove document-level mouse listeners; rely on Pointer Events + capture
+  // (keeps semantics consistent across mouse/pen/touch and avoids duplicates)
@@
   return (
     <div
       ref={overlayRef}
       id="popup-overlay"
-      className="fixed inset-0"
+      className="fixed inset-0"
       style={{
         // Popup overlay should be below sidebar (z-50) but above canvas
         zIndex: 40, // Below sidebar z-50, above canvas
-        // Only interactive when popups exist, otherwise pass through clicks
-        pointerEvents: popups.size > 0 ? 'auto' : 'none',
+        // Interactive only when active layer AND popups exist
+        pointerEvents: (isActiveLayer && popups.size > 0) ? 'auto' : 'none',
         // Don't cover the sidebar area (320px on left)
         left: '320px', // Leave space for sidebar
         // Prevent browser touch gestures
         touchAction: 'none',
         // Show grab cursor when hovering empty space
-        cursor: isPanning ? 'grabbing' : (popups.size > 0 ? 'grab' : 'default'),
+        cursor: isPanning ? 'grabbing' : ((isActiveLayer && popups.size > 0) ? 'grab' : 'default'),
       }}
       data-layer="popups"
       onPointerDown={handlePointerDown}
       onPointerMove={handlePointerMove}
       onPointerUp={handlePointerEnd}
       onPointerCancel={handlePointerEnd}
     >
```

Notes
- This keeps the infinite‑canvas translate3d container.
- It removes mixed document mouse handlers to avoid duplication and relies on capture.
- Interactivity is now gated on active layer + popups present.

Patch 2 — Import verification (no code change unless mismatch)
```diff
diff --git a/components/notes-explorer-phase1.tsx b/components/notes-explorer-phase1.tsx
@@
-import { PopupOverlay } from "@/components/canvas/popup-overlay"
+// Ensure this import points to the file we patched
+import { PopupOverlay } from "@/components/canvas/popup-overlay"
```

Patch 3 — Optional: unify z-index to keep sidebar on top
```diff
diff --git a/lib/constants/z-index.ts b/lib/constants/z-index.ts
@@
 export const Z_INDEX = {
-  NOTES_CANVAS: 1,
-  POPUP_OVERLAY: 100,
-  SIDEBAR: 1000,
+  NOTES_CANVAS: 1,
+  POPUP_OVERLAY: 40,   // Keep overlay under sidebar
+  SIDEBAR: 1000,       // Sidebar always above overlay
@@
 }
```

Phaseable improvement (scoping overlay under canvas area)
- Long‑term: render overlay inside the canvas container as `absolute inset-0` so it never spans the sidebar area. This entirely removes the need for ad‑hoc `left: '320px'` offsets and reduces z‑index interactions. That change is structural (move PopupOverlay under the canvas DOM subtree) and can follow after this patch.

Test Checklist
- With multiple popups open, click‑drag on overlay empty space moves all popups together.
- Drag across a popup card while panning — motion continues (pointer capture).
- When layer is not active or no popups are open — overlay shows default cursor and does not intercept clicks.
- Sidebar remains fully clickable; overlay does not cover it.

Rollback
- Revert the changes in popup-overlay.tsx; behavior returns to current state.
- z-index token change is optional; revert if UI depends on previous values.

