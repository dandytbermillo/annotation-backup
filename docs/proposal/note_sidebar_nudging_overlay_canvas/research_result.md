// In annotation-app.tsx, update the sidebar wrapper to ensure proper stacking:

{/* Notes Explorer - Sliding Panel with hover control */}
<div
  className={`fixed left-0 top-0 h-full z-50 transition-transform duration-300 ease-in-out ${
    isNotesExplorerOpen ? 'translate-x-0' : '-translate-x-full'
  }`}
  style={{ 
    width: '320px',
    // CRITICAL: Create independent stacking context above canvas
    isolation: 'isolate',
    // Ensure sidebar always wins z-index battles
    zIndex: 9999,
  }}
  onMouseEnter={handleSidebarMouseEnter}
  onMouseLeave={handleSidebarMouseLeave}
>
  <NotesExplorer 
    onNoteSelect={handleNoteSelect} 
    isOpen={true}
    onClose={closeNotesExplorer}
    onAddComponent={() => setShowAddComponentMenu(true)}
    zoom={canvasState.zoom * 100}
    onZoomIn={handleZoomIn}
    onZoomOut={handleZoomOut}
    onResetView={handleResetView}
    onToggleConnections={handleToggleConnections}
    showConnections={canvasState.showConnections}
    enableTreeView={true}
    usePhase1API={usePhase1API}
  />
</div>

{/* Canvas Area - Ensure it stays below sidebar */}
<div 
  className="flex-1 relative transition-all duration-300 ease-in-out"
  style={{
    pointerEvents: multiLayerEnabled && layerContext?.activeLayer === 'popups' ? 'none' : 'auto',
    opacity: multiLayerEnabled && layerContext?.activeLayer === 'popups' ? 0.6 : 1,
    transition: 'opacity 0.3s ease',
    position: 'relative',
    // CRITICAL: Lower z-index to stay below sidebar
    zIndex: 1,
    // Create new stacking context to contain canvas and overlay
    isolation: 'isolate',
  }}
>
  {/* Canvas content */}
</div>






// In popup-overlay.tsx, update recomputeOverlayBounds to properly guard sidebar:

const recomputeOverlayBounds = useCallback(() => {
  if (typeof window === 'undefined') return;
  const canvasEl = document.getElementById('canvas-container');
  if (canvasEl) {
    const rect = canvasEl.getBoundingClientRect();
    
    // CRITICAL FIX: Properly detect and exclude sidebar area
    const sidebarEl = document.querySelector('[data-sidebar]') as HTMLElement | null;
    let effectiveLeft = rect.left;
    let effectiveWidth = rect.width;
    let pointerGuardWidth = 0; // Track sidebar width for pointer guard
    
    if (sidebarEl) {
      const sidebarRect = sidebarEl.getBoundingClientRect();
      const sidebarWidth = sidebarRect.width; // Typically 320px
      
      // Check if sidebar is actually visible (not translated out)
      const isSidebarVisible = sidebarRect.right > 0;
      
      if (isSidebarVisible) {
        // Calculate actual overlap with canvas
        const overlap = Math.max(0, sidebarRect.right - rect.left);
        
        if (overlap > 0) {
          effectiveLeft = Math.max(rect.left, sidebarRect.right);
          effectiveWidth = Math.max(0, rect.right - effectiveLeft);
          pointerGuardWidth = sidebarWidth;
          
          debugLog('PopupOverlay', 'bounds_sidebar_detected', {
            sidebarWidth,
            sidebarRight: sidebarRect.right,
            canvasLeft: rect.left,
            overlap,
            effectiveLeft,
            effectiveWidth,
          });
        }
      }
    }
    
    setOverlayBounds({
      top: Math.max(0, rect.top),
      left: Math.max(0, effectiveLeft),
      width: Math.max(0, effectiveWidth),
      height: Math.max(0, rect.height),
    });
    
    // Store pointer guard width for click detection
    overlayRef.current?.setAttribute('data-pointer-guard', String(pointerGuardWidth));
    
    setOverlayContainer(canvasEl as HTMLElement);
    debugLog('PopupOverlay', 'overlay_bounds_updated', { 
      rect, 
      effectiveLeft, 
      effectiveWidth,
      pointerGuardWidth,
    });
  } else {
    // Fallback: full viewport minus sidebar
    const sidebarWidth = 320;
    setOverlayBounds({ 
      top: 0, 
      left: sidebarWidth, 
      width: window.innerWidth - sidebarWidth, 
      height: window.innerHeight 
    });
    overlayRef.current?.setAttribute('data-pointer-guard', String(sidebarWidth));
    debugLog('PopupOverlay', 'overlay_bounds_fallback', { left: sidebarWidth });
  }
}, []);

// Add pointer guard check to prevent interaction over sidebar
const isPointerOverSidebar = useCallback((e: React.PointerEvent): boolean => {
  const guardWidth = Number(overlayRef.current?.getAttribute('data-pointer-guard') || '0');
  
  if (guardWidth > 0 && e.clientX < guardWidth) {
    debugLog('PopupOverlay', 'pointer_blocked_sidebar', {
      clientX: e.clientX,
      guardWidth,
    });
    return true;
  }
  
  return false;
}, []);

// Update handlePointerDown to check sidebar guard
const handlePointerDown = useCallback((e: React.PointerEvent) => {
  // CRITICAL: Block pointer events over sidebar area
  if (isPointerOverSidebar(e)) {
    debugLog('PopupOverlay', 'pointer_down_blocked_sidebar', {
      clientX: e.clientX,
      clientY: e.clientY,
    });
    return; // Don't start panning over sidebar
  }
  
  // ... rest of existing handlePointerDown logic
}, [isPointerOverSidebar, isOverlayEmptySpace, isActiveLayer, popups.size, layerCtx]);







// In notes-explorer-phase1.tsx, update the sidebar container styles:

return (
  <div 
    data-sidebar="sidebar"
    className={`h-screen w-80 bg-gray-900 text-white flex flex-col border-r border-gray-800 fixed left-0 top-0 z-50 transition-transform duration-300 ease-in-out ${
      isOpen ? 'translate-x-0' : '-translate-x-full'
    }`}
    style={{
      // CRITICAL: Ensure sidebar always appears above everything
      zIndex: 9999,
      // Create independent stacking context
      isolation: 'isolate',
      // Prevent any parent stacking context from interfering
      position: 'fixed',
      // Explicitly set compositing to force GPU layer
      willChange: isOpen ? 'transform' : 'auto',
      transform: isOpen ? 'translateX(0)' : 'translateX(-100%)',
    }}
  >
    {/* Sidebar content */}
  </div>
)

// Also add a CSS guard in your global styles or a <style> tag:
const sidebarStyles = `
  [data-sidebar="sidebar"] {
    /* Force sidebar to always be on top */
    z-index: 9999 !important;
    /* Create new stacking context */
    isolation: isolate;
    /* Ensure it's always positioned correctly */
    position: fixed !important;
  }
  
  /* Ensure canvas and overlay respect sidebar */
  #canvas-container,
  #popup-overlay {
    /* Should never exceed sidebar z-index */
    z-index: 1 !important;
  }
  
  /* When popup layer is active, ensure sidebar still receives events */
  [data-sidebar="sidebar"] * {
    pointer-events: auto !important;
  }
`;

// Add this to your component or global styles
useEffect(() => {
  if (typeof document === 'undefined') return;
  
  const styleId = 'sidebar-z-index-guard';
  if (!document.getElementById(styleId)) {
    const style = document.createElement('style');
    style.id = styleId;
    style.textContent = sidebarStyles;
    document.head.appendChild(style);
  }
  
  return () => {
    const existingStyle = document.getElementById(styleId);
    if (existingStyle) {
      existingStyle.remove();
    }
  };
}, []);




// COMPREHENSIVE FIX: Add to popup-overlay.tsx after line 358

// Build overlay contents (absolute inside canvas container)
const overlayInner = (
  <div
    ref={overlayRef}
    id="popup-overlay"
    className={`absolute inset-0 ${isPanning ? 'popup-overlay-panning' : ''}`}
    data-panning={isPanning.toString()}
    style={{
      // CRITICAL: Reduced z-index to stay below sidebar
      zIndex: 10, // Changed from 40 to 10
      overflow: 'hidden',
      // CRITICAL: Add clip-path to exclude sidebar area
      clipPath: overlayBounds 
        ? `inset(0 0 0 ${overlayBounds.left}px)` 
        : 'none',
      // Pointer events management
      pointerEvents: (isActiveLayer && popups.size > 0) ? 'auto' : 'none',
      touchAction: (isActiveLayer && popups.size > 0) ? 'none' : 'auto',
      cursor: isPanning ? 'grabbing' : ((isActiveLayer && popups.size > 0) ? 'grab' : 'default'),
      opacity: isActiveLayer ? 1 : 0,
      visibility: isActiveLayer ? 'visible' : 'hidden',
      // Contain layout/paint to this overlay
      contain: 'layout paint' as const,
    }}
    data-layer="popups"
    onPointerDown={(e) => {
      // CRITICAL: Additional sidebar check
      const sidebarEl = document.querySelector('[data-sidebar]');
      if (sidebarEl) {
        const rect = sidebarEl.getBoundingClientRect();
        if (e.clientX >= rect.left && e.clientX <= rect.right &&
            e.clientY >= rect.top && e.clientY <= rect.bottom) {
          debugLog('PopupOverlay', 'pointer_blocked_over_sidebar', {
            clientX: e.clientX,
            clientY: e.clientY,
            sidebarBounds: rect,
          });
          return; // Don't handle pointer events over sidebar
        }
      }
      handlePointerDown(e);
    }}
    onPointerMove={handlePointerMove}
    onPointerUp={handlePointerEnd}
    onPointerCancel={handlePointerEnd}
    onPointerEnter={() => setIsOverlayHovered(true)}
    onPointerLeave={() => setIsOverlayHovered(false)}
  >
    {/* Transform container */}
    <div ref={containerRef} className="absolute inset-0" style={containerStyle}>
      {/* Connection lines */}
      <svg className="absolute inset-0 pointer-events-none" style={{ overflow: 'visible' }}>
        {connectionPaths.map((path, index) => (
          <path key={index} d={path.d} stroke={path.stroke} strokeWidth={path.strokeWidth} opacity={path.opacity} fill="none" strokeLinecap="round" strokeLinejoin="round" />
        ))}
      </svg>
      
      {/* Popups */}
      {visiblePopups.map((popup) => {
        const position = popup.canvasPosition || popup.position;
        if (!position) return null;
        
        const zIndex = getPopupZIndex(
          popup.level,
          popup.isDragging || popup.id === draggingPopup,
          true
        );
        
        return (
          <div
            key={popup.id}
            id={`popup-${popup.id}`}
            className="popup-card absolute bg-gray-800 border border-gray-700 rounded-lg shadow-xl pointer-events-auto"
            style={{
              left: `${position.x}px`,
              top: `${position.y}px`,
              width: '300px',
              maxHeight: '400px',
              // CRITICAL: Ensure popup z-index never exceeds sidebar
              zIndex: Math.min(zIndex, 100), // Cap at 100, well below sidebar's 9999
              cursor: popup.isDragging ? 'grabbing' : 'default',
              opacity: isPanning ? 0.99 : 1,
              transform: 'translateZ(0)',
              backfaceVisibility: 'hidden' as const,
              willChange: popup.isDragging || isPanning ? 'transform' : 'auto',
            }}
            data-popup-id={popup.id}
            onPointerDown={(e) => {
              // Prevent event from bubbling to overlay's pointer guard
              e.stopPropagation();
            }}
          >
            {/* Popup content... */}
          </div>
        );
      })}
    </div>
  </div>
);

// CRITICAL: Also update the fallback fixed overlay
return (
  <div
    ref={overlayRef}
    id="popup-overlay"
    className={`fixed ${isPanning ? 'popup-overlay-panning' : ''}`}
    data-panning={isPanning.toString()}
    style={{
      top: overlayBounds ? `${overlayBounds.top}px` : 0,
      left: overlayBounds ? `${overlayBounds.left}px` : '320px',
      width: overlayBounds ? `${overlayBounds.width}px` : `calc(100vw - 320px)`,
      height: overlayBounds ? `${overlayBounds.height}px` : '100vh',
      // CRITICAL: Reduced z-index to 10 (below sidebar's 9999)
      zIndex: 10,
      overflow: 'hidden',
      // CRITICAL: Ensure pointer events never block sidebar
      pointerEvents: (isActiveLayer && popups.size > 0) ? 'auto' : 'none',
      touchAction: (isActiveLayer && popups.size > 0) ? 'none' : 'auto',
      cursor: isPanning ? 'grabbing' : ((isActiveLayer && popups.size > 0) ? 'grab' : 'default'),
      opacity: isActiveLayer ? 1 : 0,
      visibility: isActiveLayer ? 'visible' : 'hidden',
      contain: 'layout paint' as const,
    }}
    data-layer="popups"
    onPointerDown={(e) => {
      // CRITICAL: Check if pointer is over sidebar
      if (e.clientX < 320) { // Sidebar width
        debugLog('PopupOverlay', 'fallback_pointer_blocked', {
          clientX: e.clientX,
          sidebarWidth: 320,
        });
        return;
      }
      handlePointerDown(e);
    }}
    onPointerMove={handlePointerMove}
    onPointerUp={handlePointerEnd}
    onPointerCancel={handlePointerEnd}
    onPointerEnter={() => setIsOverlayHovered(true)}
    onPointerLeave={() => setIsOverlayHovered(false)}
  >
    {/* ... rest of fallback overlay content */}
  </div>
);


# Sidebar Not Appearing Over Overlay - Complete Solution

## Root Causes Identified

### 1. **Stacking Context Conflict**
The canvas container (`#canvas-container`) creates a new stacking context, preventing the sidebar's `z-index: 50` from properly comparing with elements inside the canvas (including the popup overlay).

**Evidence:**
- Sidebar: `z-50` (fixed positioning)
- Popup Overlay: `z-40` (absolute within canvas)
- Canvas: `z-1` (relative with isolation)

When the overlay is portaled into the canvas container, it becomes trapped within that stacking context.

### 2. **Pointer Event Capture**
The overlay sets `pointerEvents: 'auto'` when active, capturing ALL pointer events including those over the sidebar area, even though it tries to adjust bounds.

**Evidence from code:**
```typescript
pointerEvents: (isActiveLayer && popups.size > 0) ? 'auto' : 'none'
```

### 3. **Bounds Calculation Incomplete**
While `recomputeOverlayBounds()` attempts to detect the sidebar and adjust bounds, it:
- Doesn't store the sidebar width for runtime pointer guards
- Doesn't use `clip-path` to visually exclude the sidebar area
- Recalculates on resize but not on sidebar toggle

## Complete Fix Implementation

### Priority 1: Z-Index Hierarchy (CRITICAL)

**annotation-app.tsx:**
```typescript
// Sidebar wrapper
<div style={{
  isolation: 'isolate',  // NEW: Independent stacking context
  zIndex: 9999,          // CHANGED: From 50 to 9999
}}>

// Canvas area
<div style={{
  zIndex: 1,
  isolation: 'isolate',  // NEW: Contain canvas/overlay stacking
}}>
```

**notes-explorer-phase1.tsx:**
```typescript
<div 
  data-sidebar="sidebar"
  style={{
    zIndex: 9999,         // CHANGED: From 50 to 9999
    isolation: 'isolate', // NEW
    position: 'fixed',    // ENSURE
  }}
>
```

**popup-overlay.tsx:**
```typescript
// Inside canvas container
style={{
  zIndex: 10,  // CHANGED: From 40 to 10
}}

// Popup cards
style={{
  zIndex: Math.min(zIndex, 100), // NEW: Cap at 100
}}
```

### Priority 2: Pointer Event Guards

**popup-overlay.tsx - Add guard storage:**
```typescript
const recomputeOverlayBounds = useCallback(() => {
  // ... existing code ...
  
  // NEW: Store sidebar width for runtime checks
  overlayRef.current?.setAttribute('data-pointer-guard', String(pointerGuardWidth));
}, []);
```

**popup-overlay.tsx - Add guard checks:**
```typescript
const handlePointerDown = useCallback((e: React.PointerEvent) => {
  // NEW: Check if pointer is over sidebar
  const sidebarEl = document.querySelector('[data-sidebar]');
  if (sidebarEl) {
    const rect = sidebarEl.getBoundingClientRect();
    if (e.clientX >= rect.left && e.clientX <= rect.right &&
        e.clientY >= rect.top && e.clientY <= rect.bottom) {
      return; // Block pointer events over sidebar
    }
  }
  
  // ... existing handlePointerDown logic ...
}, [...]);
```

### Priority 3: Visual Exclusion

**popup-overlay.tsx - Add clip-path:**
```typescript
style={{
  // NEW: Visually exclude sidebar area
  clipPath: overlayBounds 
    ? `inset(0 0 0 ${overlayBounds.left}px)` 
    : 'none',
}}
```

### Priority 4: CSS Guards

**Add global styles:**
```css
[data-sidebar="sidebar"] {
  z-index: 9999 !important;
  isolation: isolate;
  position: fixed !important;
}

[data-sidebar="sidebar"] * {
  pointer-events: auto !important;
}

#canvas-container,
#popup-overlay {
  z-index: 1 !important;
}
```

## Testing Checklist

After applying all patches:

1. **Z-Index Test**
   - [ ] Sidebar appears above overlay when both visible
   - [ ] Sidebar buttons are clickable when overlay active
   - [ ] Sidebar doesn't flicker or hide temporarily

2. **Pointer Events Test**
   - [ ] Clicking sidebar buttons works when overlay active
   - [ ] Hovering sidebar items shows tooltips
   - [ ] Dragging popups doesn't capture sidebar area
   - [ ] Scrolling sidebar list works when overlay visible

3. **Bounds Test**
   - [ ] Overlay doesn't visually cover sidebar
   - [ ] Popups don't appear under sidebar
   - [ ] Sidebar toggle updates overlay bounds
   - [ ] Window resize maintains correct bounds

4. **Edge Cases**
   - [ ] Works when sidebar is hidden then shown
   - [ ] Works during sidebar slide animation
   - [ ] Works with multiple popups open
   - [ ] Works when dragging popups near sidebar

## Debug Logging

Monitor these logs to verify fixes:
- `overlay_bounds_updated` - Should show correct left offset
- `pointer_blocked_over_sidebar` - Should fire when clicking sidebar
- `bounds_sidebar_detected` - Should detect sidebar correctly

## Rollback Plan

If issues arise:
1. Revert z-index changes first (most likely culprit)
2. Then revert pointer guard changes
3. Finally revert clip-path if visual issues occur

## Performance Impact

- **Minimal**: Using `isolation: isolate` creates GPU layers but is lightweight
- **Negligible**: Pointer guard checks are simple bounds tests
- **None**: CSS changes are declarative with no runtime cost
