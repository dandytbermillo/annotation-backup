Fix Overlay Edge Auto-Scroll by Refactoring Camera Delta Handling
Patch for Edge-Driven Auto-Scroll in Plain-Mode Overlay Popups
Overview of the Fix
This patch modifies the plain (single-layer) mode behavior to pan the entire popups overlay when a popup is dragged to the viewport edge. Instead of directly mutating each popup’s position state, we apply deltas via the popups container transform (similar to multi-layer mode). The dragged popup receives an equal-and-opposite CSS transform so it stays under the cursor while the container (camera) moves. We also add debug instrumentation to trace pointer positions, velocity, camera transforms, and popup transforms during auto-scroll. By treating the overlay as a single pannable layer (even in plain mode), we avoid state thrash and RAF conflicts. We also leverage the gesture lock mechanism to prevent simultaneous canvas interactions when multiple layers are mounted.
Changes in notes-explorer-phase1.tsx
1. Introduce a popups container with transform in plain mode: We wrap legacy popup elements in a fixed container div and position popups as absolute within it (using their canvasPosition). A new overlayContainerRef tracks this container, and offsetRef stores the current pan offset (camera transform) for the popups layer. This allows shifting all popups at once via CSS. For example:
// Add refs and state for overlay container and offset
const overlayContainerRef = useRef<HTMLDivElement | null>(null);
const [offset, setOffset] = useState<{ x: number; y: number }>({ x: 0, y: 0 });
const offsetRef = useRef<{ x: number; y: number }>({ x: 0, y: 0 });
In the JSX render, use the container in the fallback (plain mode) branch:
{multiLayerEnabled ? (
  <PopupOverlay ... />
) : (
  // Legacy popup rendering in a pannable container
  <div 
    ref={overlayContainerRef} 
    className="fixed inset-0" 
    style={{ transform: `translate3d(${offset.x}px, ${offset.y}px, 0)` }}
  >
    {Array.from(hoverPopovers.values()).map(popover => (
      <div key={popover.id}
           data-popup-id={popover.id}
           className="absolute bg-gray-800 border border-gray-700 rounded-lg shadow-xl"
           style={{
             left: `${popover.canvasPosition.x}px`,
             top: `${popover.canvasPosition.y}px`,
             width: '300px',
             maxHeight: '80vh',
             cursor: popover.isDragging ? 'grabbing' : 'default',
             transition: popover.isDragging ? 'none' : 'box-shadow 0.2s ease',
             zIndex: popover.isDragging ? 10000 : 9999 + popover.level
           }}
           onMouseDown={(e) => handlePopupDragStart(popover.id, e)}
      >
        ... {/* popup content */}
      </div>
    ))}
  </div>
)}
Now all popups share a common container that we can translate for auto-scroll. We use popover.canvasPosition for left/top (the stable “world” coordinates) and let the container’s CSS transform represent the camera offset. Popups are position: absolute relative to the fixed container (which covers the viewport), so a container transform shifts all popups together. 2. Update handleAutoScroll to pan via container transform: In the handleAutoScroll callback, we remove the old state mutation loop and replace it with container movement. We adjust offsetRef by the incoming deltaX, deltaY and apply the new offset to overlayContainerRef.current.style.transform. If a popup is being dragged, we update the drag references just as in multi-layer mode (adding the delta to dragScreenPosRef and subtracting from dragDeltaRef to counteract the container motion). For example:
const handleAutoScroll = useCallback((deltaX: number, deltaY: number) => {
  if (deltaX === 0 && deltaY === 0) return;

  if (multiLayerEnabled && layerContext) {
    // Multi-layer: delegate to layer context
    layerContext.updateTransformByDelta('popups', { dx: deltaX, dy: deltaY });
    if (draggingPopup) {
      // Adjust dragging popup transform to stay under cursor
      dragScreenPosRef.current.x += deltaX;
      dragScreenPosRef.current.y += deltaY;
      if (rafDragEnabledRef.current && draggingElRef.current) {
        dragDeltaRef.current.dx -= deltaX;
        dragDeltaRef.current.dy -= deltaY;
        if (dragRafRef.current == null) {
          dragRafRef.current = requestAnimationFrame(() => {
            dragRafRef.current = null;
            const el = draggingElRef.current;
            if (!el) return;
            const { dx, dy } = dragDeltaRef.current;
            el.style.transform = `translate3d(${Math.round(dx)}px, ${Math.round(dy)}px, 0)`;
          });
        }
      }
    }
    return;
  }

  // **Plain mode:** Pan the overlay container instead of mutating popups state
  if (overlayContainerRef.current) {
    const prevOffset = { ...offsetRef.current };
    offsetRef.current.x += deltaX;
    offsetRef.current.y += deltaY;
    // Apply container translate to move all popups
    overlayContainerRef.current.style.transform = 
      `translate3d(${Math.round(offsetRef.current.x)}px, ${Math.round(offsetRef.current.y)}px, 0)`;

    debugLog('NotesExplorer', 'plain_auto_scroll_step', {
      delta: { x: deltaX, y: deltaY },
      offsetBefore: prevOffset,
      offsetAfter: { ...offsetRef.current }
    });
  }

  if (draggingPopup) {
    // Keep dragged popup under cursor with equal-and-opposite transform
    dragScreenPosRef.current.x += deltaX;
    dragScreenPosRef.current.y += deltaY;
    if (rafDragEnabledRef.current && draggingElRef.current) {
      dragDeltaRef.current.dx -= deltaX;
      dragDeltaRef.current.dy -= deltaY;
      if (dragRafRef.current == null) {
        dragRafRef.current = requestAnimationFrame(() => {
          dragRafRef.current = null;
          const el = draggingElRef.current;
          if (!el) return;
          const { dx, dy } = dragDeltaRef.current;
          el.style.transform = `translate3d(${Math.round(dx)}px, ${Math.round(dy)}px, 0)`;
        });
      }
    }
  }

  // Log drag delta and popup transform for debugging
  if (draggingPopup) {
    debugLog('NotesExplorer', 'plain_auto_scroll_applied', {
      dragDelta: { ...dragDeltaRef.current },
      popupTransform: draggingElRef.current?.style.transform || 'none'
    });
  }
}, [multiLayerEnabled, layerContext]);
Note: We preserve the multi-layer branch and only change the plain-mode branch. The new code uses the same logic as multi-layer (panning via transform and adjusting dragDeltaRef) instead of calling setHoverPopovers for every popup.
3. Commit offset into state on drag end: When the user releases the mouse, we finalize the new positions of all popups and reset the container transform. This ensures no jump occurs and the state reflects the panned view. We modify the global mouseup handler and the RAF-driven handleUp to update every popup’s position and canvasPosition by the accumulated offsetRef, then clear the offset.
RAF drag end (handleUp): After computing the dragged popup’s final screen position (finalPos) and canvas position (finalCanvas), we use a single setHoverPopovers update to adjust all popups:
// Within handleUp (pointer up for RAF dragging)
stopAutoScroll();

const { left, top } = dragStartPosRef.current;
const { dx, dy } = dragDeltaRef.current;
const finalPos = { x: left + dx, y: top + dy };
// Use current offset transform for accurate canvas calc
const currentTransform = { x: offsetRef.current.x, y: offsetRef.current.y, scale: 1 };
const finalCanvas = CoordinateBridge.screenToCanvas(finalPos, currentTransform);

setHoverPopovers(prev => {
  const newMap = new Map(prev);
  newMap.forEach((popup, id) => {
    let newPosition = popup.position;
    let newCanvasPos = popup.canvasPosition;
    if (id === draggingPopup) {
      // Dragged popup: use final positions
      newPosition = finalPos;
      newCanvasPos = finalCanvas;
    }
    if (offsetRef.current.x !== 0 || offsetRef.current.y !== 0) {
      // Apply total container offset to all popups
      newPosition = { 
        x: newPosition.x + offsetRef.current.x, 
        y: newPosition.y + offsetRef.current.y 
      };
      newCanvasPos = { 
        x: newCanvasPos.x + offsetRef.current.x, 
        y: newCanvasPos.y + offsetRef.current.y 
      };
    }
    newMap.set(id, { 
      ...popup, 
      position: newPosition, 
      canvasPosition: newCanvasPos, 
      isDragging: false 
    });
  });
  return newMap;
});

// Reset container transform (offset) after committing positions
if (overlayContainerRef.current) {
  overlayContainerRef.current.style.transform = '';
}
offsetRef.current = { x: 0, y: 0 };
setOffset({ x: 0, y: 0 });

// Clean up dragging element styles
if (draggingElRef.current) {
  const el = draggingElRef.current;
  el.style.transition = '';
  el.style.willChange = 'auto';
  el.style.zIndex = '';
  el.style.transform = '';
  el.removeAttribute('data-dragging');
}
// Cancel any pending RAF
if (dragRafRef.current) {
  cancelAnimationFrame(dragRafRef.current);
  dragRafRef.current = null;
}
// Clear drag refs
draggingElRef.current = null;
dragDeltaRef.current = { dx: 0, dy: 0 };
rafDragEnabledRef.current = false;
setDraggingPopup(null);

// Release global cursor styles
document.body.style.cursor = '';
document.body.style.userSelect = '';

debugLog('NotesExplorer', 'auto_scroll_end_plain', {
  appliedOffset: currentTransform,
  dragFinalPos: finalPos,
  popupsCount: prevHoverPopovers.size
});
This ensures the final state positions include the pan offset. For example, if the container moved +80px right and +20px down in total, every popup’s position and canvasPosition are incremented by (80,20). We then reset offsetRef to zero and remove the container’s transform so that subsequent interactions start from the new baseline.
Non-RAF drag end (handleGlobalMouseUp): We apply a similar approach in the global mouseup handler (used if RAF drag is disabled). We calculate the dragged popup’s final screen position using the offset transform, then update all popups:
// Within handleGlobalMouseUp (for non-RAF dragging)
stopAutoScroll();
setHoverPopovers(prev => {
  const newMap = new Map(prev);
  newMap.forEach((popup, id) => {
    let newPosition = popup.position;
    let newCanvasPos = popup.canvasPosition;
    if (id === draggingPopup && popup) {
      // Compute final screen pos from canvas using current offset transform
      const transform = { x: offsetRef.current.x, y: offsetRef.current.y, scale: 1 };
      newPosition = CoordinateBridge.canvasToScreen(popup.canvasPosition, transform);
      // Canvas position already includes drag moves in global mode
      newCanvasPos = popup.canvasPosition;
    }
    if (offsetRef.current.x !== 0 || offsetRef.current.y !== 0) {
      newPosition.x += offsetRef.current.x;
      newPosition.y += offsetRef.current.y;
      newCanvasPos.x += offsetRef.current.x;
      newCanvasPos.y += offsetRef.current.y;
    }
    newMap.set(id, { 
      ...popup, 
      position: newPosition, 
      canvasPosition: newCanvasPos, 
      isDragging: false 
    });
  });
  return newMap;
});
setDraggingPopup(null);
if (overlayContainerRef.current) {
  overlayContainerRef.current.style.transform = '';
}
offsetRef.current = { x: 0, y: 0 };
setOffset({ x: 0, y: 0 };
document.body.style.cursor = '';
document.body.style.userSelect = '';
debugLog('NotesExplorer', 'auto_scroll_end_plain', { appliedOffset: { ...offsetRef.current } });
After this, all popups’ state is realigned with the viewport, and the offset is cleared, mirroring the RAF case. 4. Use gesture locking to prevent conflicts: We utilize the layer provider’s gesture system to avoid input conflicts when the overlay is panning. On popup drag start, we signal a popup-drag gesture, and on drag end we release it:
const handlePopupDragStart = (popupId: string, e: React.MouseEvent) => {
  ...
  setDraggingPopup(popupId);
  dragScreenPosRef.current = { ...popup.position };
  ...
  rafDragEnabledRef.current = true;
  draggingElRef.current = el;
  ...
  if (multiLayerEnabled && layerContext) {
    layerContext.setGesture('popup-drag');
  }
  debugLog('NotesExplorer', 'popup_drag_start', {
    popupId,
    offset: { ...offsetRef.current },
    pointer: { x: e.clientX, y: e.clientY }
  });
};

 // In drag end (both global and RAF):
 if (layerContext) {
   layerContext.setGesture('none');
 }
This ensures that if multiple canvases (notes and popups) are mounted, other gestures (like notes canvas panning) are temporarily locked out during the popup drag. We place the setGesture('none') call after resetting drag state on mouseup.
Changes in use-auto-scroll.ts
We add debug logs to trace edge detection and scroll velocity. In checkAutoScroll, we log pointer coordinates and computed velocity whenever auto-scroll is triggered or updated, and in stopAutoScroll we log when scrolling stops:
const checkAutoScroll = useCallback((clientX, clientY) => {
  ...
  if (shouldScroll) {
    debugLog('useAutoScroll', 'trigger_auto_scroll', {
      pointer: { x: clientX, y: clientY },
      velocity: { x: velocityX, y: velocityY }
    });
  } else if (autoScrollRef.current.isActive) {
    debugLog('useAutoScroll', 'auto_scroll_edge_exit', { pointer: { x: clientX, y: clientY } });
  }
  setAutoScroll(prev => { ... });
}, [enabled, threshold, speed]);

const stopAutoScroll = useCallback(() => {
  setAutoScroll(prev => { ... });
  debugLog('useAutoScroll', 'stop_auto_scroll_manual', {});
}, []);
These logs will confirm when the pointer enters/exits the threshold zone and the velocity applied. The animation effect remains the same (calling onScroll each frame); the debug logs we added in NotesExplorer.handleAutoScroll already capture the deltas and offsets each frame.
(Optional) Changes in popup-overlay.tsx and layer-provider.tsx
No functional changes are required in the multi-layer overlay or layer provider logic. The existing multi-layer code already uses updateTransformByDelta for panning, and our new plain-mode implementation now mirrors this approach. We did, however, ensure the gesture system is utilized (via setGesture calls in notes-explorer-phase1.tsx) to avoid conflicts, which ties into the LayerProvider’s gesture handling. Debug logs in the overlay (e.g., pan_engaged, pan_end) remain as is, but you can add similar logs if needed to trace overlay panning.
Runtime Trace Instructions
After applying this patch, you can verify the behavior and trace logs as follows:
Drag a popup near a viewport edge: Open the browser console (and ensure debug logging is enabled). Begin dragging a popup toward an edge of the screen. As the cursor approaches the edge (within ~80px by default), the canvas should start panning automatically. The dragged popup will remain “pinned” under your cursor at the edge, while the entire set of popups moves.
Observe debug log output: In the console, you should see useAutoScroll logs indicating edge triggers. For example, "trigger_auto_scroll" entries will show the pointer coordinates and velocity as auto-scroll starts, and subsequent updates if you move closer to the edge (velocity increases up to the max). When you move the cursor away from the edge, an "auto_scroll_edge_exit" log will indicate auto-scroll stopping due to pointer reposition.
Container and popup transform logs: The NotesExplorer logs will show the effect of each auto-scroll frame. Look for "plain_auto_scroll_step" logs showing the delta applied and the offsetBefore/offsetAfter of the popups container (camera). These confirm that layerContext.updateTransformByDelta (in multi-layer) or the container CSS transform (in plain mode) is being updated every frame. Corresponding "plain_auto_scroll_applied" logs will output the dragDeltaRef and popup element’s transform – this should reflect an equal and opposite translation to the container’s offset, keeping the dragged popup stationary relative to the cursor.
Drop the popup and verify final state: When you release the mouse button, the auto-scroll should stop (see a stop_auto_scroll_manual log from useAutoScroll), and a "auto_scroll_end_plain" log will record the total offset applied. The popups container offset should reset to (0,0), and each popup’s new position in state should now equal its on-screen position. You can confirm this by checking a dragged popup’s DOM element style – after drop, its style.transform should be cleared and its style.left/top will have been updated to the new coordinates (matching where it was dropped). No sudden jump should occur on drop because the offset was integrated into the state before resetting.
Multi-layer integrity (if applicable): If you have multi-layer mode enabled, verify that dragging a popup still works correctly and that no gesture conflicts occur. The layerContext.currentGesture will switch to "popup-drag" during the drag (you can see this via the debug logs or devtools if you instrument the context), preventing the notes canvas from panning at the same time. On drop, it returns to "none", re-enabling other interactions. Both the notes layer and popups layer should pan smoothly and independently as designed.
By following these steps, you should see that edge-driven auto-scroll now behaves correctly in plain mode, with the dragged popup staying under the cursor and the entire overlay moving, just as in multi-layer mode. The added instrumentation will assist in confirming smooth updates of dragDeltaRef/dragScreenPosRef and the coordinated transforms of the container and popup element throughout the gesture.