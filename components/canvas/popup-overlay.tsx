'use client';

import React, { useEffect, useRef, useMemo, useState, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { useFeatureFlag } from '@/lib/offline/feature-flags';
import { CoordinateBridge } from '@/lib/utils/coordinate-bridge';
import { ConnectionLineAdapter, PopupState } from '@/lib/rendering/connection-line-adapter';
import { Z_INDEX, getPopupZIndex } from '@/lib/constants/z-index';
import { useLayer } from '@/components/canvas/layer-provider';
import { PopupStateAdapter } from '@/lib/adapters/popup-state-adapter';
import { X, Folder, FileText, Eye } from 'lucide-react';
import { debugLog } from '@/lib/utils/debug-logger';

interface PopupData extends PopupState {
  id: string;
  folder: any; // TreeNode from existing implementation
  canvasPosition: { x: number; y: number };
  parentId?: string;
  level: number;
  isDragging?: boolean;
  isLoading?: boolean;
  height?: number;
}

interface PopupOverlayProps {
  popups: Map<string, PopupData>;
  draggingPopup: string | null;
  onClosePopup: (id: string) => void;
  onDragStart?: (id: string, event: React.MouseEvent) => void;
  onHoverFolder?: (folder: any, event: React.MouseEvent, parentPopupId: string) => void;
  onLeaveFolder?: () => void;
}

/**
 * PopupOverlay - React component for the popup layer
 * Renders popups and connection lines in a separate layer above the notes canvas
 */
export const PopupOverlay: React.FC<PopupOverlayProps> = ({
  popups,
  draggingPopup,
  onClosePopup,
  onDragStart,
  onHoverFolder,
  onLeaveFolder,
}) => {
  const multiLayerEnabled = useFeatureFlag('ui.multiLayerCanvas' as any);
  
  // Debug log on mount
  useEffect(() => {
    debugLog('PopupOverlay', 'component_mounted', {
      multiLayerEnabled,
      popupCount: popups.size,
      timestamp: new Date().toISOString()
    });
    
    return () => {
      debugLog('PopupOverlay', 'component_unmounted', {
        timestamp: new Date().toISOString()
      });
    };
  }, []);
  
  // Self-contained transform state (infinite-canvas pattern)
  const [transform, setTransform] = useState({ x: 0, y: 0, scale: 1 });
  const [isPanning, setIsPanning] = useState(false);
  const [engaged, setEngaged] = useState(false); // hysteresis engaged
  
  // Use LayerProvider to gate interactivity by active layer
  const layerCtx = useLayer();
  const isActiveLayer = !!layerCtx && layerCtx.activeLayer === 'popups';
  
  const overlayRef = useRef<HTMLDivElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  // Track the on-screen bounds of the canvas container to scope the overlay
  const [overlayBounds, setOverlayBounds] = useState<{ top: number; left: number; width: number; height: number } | null>(null);
  // Preferred: mount overlay inside the canvas container via React portal
  const [overlayContainer, setOverlayContainer] = useState<HTMLElement | null>(null);
  const [isPointerInside, setIsPointerInside] = useState<boolean>(false);
  const [isOverlayHovered, setIsOverlayHovered] = useState(false);
  const panStartRef = useRef({ x: 0, y: 0 });
  const lastMouseRef = useRef({ x: 0, y: 0 });
  const pointerIdRef = useRef<number | null>(null);
  const toastTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  
  // Early return if feature not enabled
  if (!multiLayerEnabled) {
    return null; // Feature not enabled
  }
  
  // Debug log initialization and state tracking
  useEffect(() => {
    debugLog('PopupOverlay', 'initialized', {
      popupCount: popups.size,
      transform,
      multiLayerEnabled,
      isActiveLayer,
      layerCtx: layerCtx?.activeLayer || 'none'
    });
  }, [popups.size, transform, multiLayerEnabled, isActiveLayer, layerCtx?.activeLayer]);
  
  // Debug log transform changes
  useEffect(() => {
    debugLog('PopupOverlay', 'transform_changed', {
      transform,
      isPanning,
      engaged
    });
  }, [transform]);
  
  // Debug log layer changes
  useEffect(() => {
    debugLog('PopupOverlay', 'layer_state', {
      isActiveLayer,
      activeLayer: layerCtx?.activeLayer || 'none',
      popupCount: popups.size,
      canInteract: isActiveLayer && popups.size > 0
    });
  }, [isActiveLayer, layerCtx?.activeLayer, popups.size]);
  
  // Check if the pointer event is on empty space (not on interactive elements)
  const isOverlayEmptySpace = useCallback((e: React.PointerEvent) => {
    const target = e.target as HTMLElement;
    // Check if we're NOT clicking on a popup card or button
    // This allows clicking on any background element including transform containers
    const isOnPopup = !!target.closest('.popup-card');
    const isOnButton = !!target.closest('button');
    
    // Empty space = not on popup card and not on button
    return !isOnPopup && !isOnButton;
  }, []);
  
  // Handle pan start (simplified like notes canvas)
  const handlePointerDown = useCallback((e: React.PointerEvent) => {
    // Always log that pointer down was received
    console.log('[PopupOverlay] pointerDown:', {
      target: (e.target as HTMLElement).className,
      isEmptySpace: isOverlayEmptySpace(e),
      isActiveLayer,
      popupCount: popups.size,
      layerCtx: layerCtx?.activeLayer || 'none',
      clientX: e.clientX,
      clientY: e.clientY
    });
    
    debugLog('PopupOverlay', 'pointer_down_received', {
      target: (e.target as HTMLElement).className,
      isEmptySpace: isOverlayEmptySpace(e),
      isActiveLayer,
      popupCount: popups.size,
      layerCtx: layerCtx?.activeLayer || 'none'
    });
    
    // Only start panning if clicking on empty space
    if (!isOverlayEmptySpace(e)) {
      debugLog('PopupOverlay', 'pan_blocked_not_empty_space', {
        target: (e.target as HTMLElement).className
      });
      return;
    }
    
    // Require at least one popup present
    const hasPopups = popups.size > 0;
    if (!hasPopups) {
      debugLog('PopupOverlay', 'pan_blocked', { 
        isActiveLayer,
        hasPopups,
        layerCtx: layerCtx?.activeLayer || 'none',
        reason: 'no_popups'
      });
      return;
    }
    // Also require correct active layer to avoid accidental interception
    if (!isActiveLayer) {
      debugLog('PopupOverlay', 'pan_blocked_inactive_layer', {
        isActiveLayer,
        layerCtx: layerCtx?.activeLayer || 'none',
        reason: 'inactive_layer'
      });
      return;
    }
    
    console.log('[PopupOverlay] PAN START!', {
      clientX: e.clientX,
      clientY: e.clientY,
      transform,
      pointerId: e.pointerId
    });
    
    debugLog('PopupOverlay', 'pan_start', { 
      clientX: e.clientX, 
      clientY: e.clientY,
      currentTransform: transform,
      pointerId: e.pointerId,
      isActiveLayer,
      popupCount: popups.size
    });
    
    setIsPanning(true);
    setEngaged(false); // reset hysteresis
    panStartRef.current = { x: e.clientX, y: e.clientY };
    lastMouseRef.current = { x: e.clientX, y: e.clientY };
    pointerIdRef.current = e.pointerId;
    
    // Capture pointer for robust dragging across children
    // Only capture if this is a real pointer event (not synthetic)
    try {
      if (e.pointerId !== undefined && overlayRef.current) {
        overlayRef.current.setPointerCapture(e.pointerId);
      }
    } catch (err) {
      // Fallback: pointer capture not available or synthetic event
      debugLog('PopupOverlay', 'pointer_capture_failed', { 
        error: err.message,
        pointerId: e.pointerId 
      });
    }
    
    // Optimize for dragging
    document.body.style.userSelect = 'none';
    if (containerRef.current) {
      containerRef.current.style.willChange = 'transform';
    }
    
    // Only prevent default for actual drag operations
    e.preventDefault();
  }, [isOverlayEmptySpace, transform, isActiveLayer, popups.size]);
  
  // Handle pan move (simplified like notes canvas)
  const handlePointerMove = useCallback((e: React.PointerEvent) => {
    if (!isPanning || pointerIdRef.current === null) {
      debugLog('PopupOverlay', 'pan_move_blocked', {
        isPanning,
        pointerIdRef: pointerIdRef.current,
        reason: !isPanning ? 'not_panning' : 'no_pointer_id'
      });
      return;
    }
    
    // Don't block on capture - it may not be available for synthetic events
    
    const deltaX = e.clientX - lastMouseRef.current.x;
    const deltaY = e.clientY - lastMouseRef.current.y;
    
    // 3-5px hysteresis to distinguish click vs pan
    if (!engaged) {
      const dx0 = e.clientX - panStartRef.current.x;
      const dy0 = e.clientY - panStartRef.current.y;
      if (Math.hypot(dx0, dy0) < 4) return;
      setEngaged(true);
      debugLog('PopupOverlay', 'pan_engaged', { threshold: Math.hypot(dx0, dy0) });
    }
    
    // Update transform directly
    setTransform(prev => {
      const newTransform = {
        ...prev,
        x: prev.x + deltaX,
        y: prev.y + deltaY
      };
      
      // Log to database
      debugLog('PopupOverlay', 'pan_move', { 
        deltaX, 
        deltaY,
        newTransform,
        popupCount: popups.size
      });
      
      return newTransform;
    });
    
    lastMouseRef.current = { x: e.clientX, y: e.clientY };
  }, [isPanning, engaged, popups.size]);
  
  // Handle pan end (simplified)
  const handlePointerEnd = useCallback((e: React.PointerEvent) => {
    if (!isPanning) return;
    
    debugLog('PopupOverlay', 'pan_end', { 
      totalDelta: {
        x: transform.x,
        y: transform.y
      },
      pointerId: e.pointerId,
      wasEngaged: engaged
    });
    
    setIsPanning(false);
    setEngaged(false);
    
    // Release pointer capture
    if (pointerIdRef.current !== null && overlayRef.current) {
      try {
        overlayRef.current.releasePointerCapture(pointerIdRef.current);
      } catch (err) {
        // Pointer was never captured or already released
        debugLog('PopupOverlay', 'pointer_release_failed', { 
          error: err.message,
          pointerId: pointerIdRef.current 
        });
      }
      pointerIdRef.current = null;
    }
    
    // Reset styles
    document.body.style.userSelect = '';
    if (containerRef.current) {
      containerRef.current.style.willChange = '';
    }
  }, [isPanning, transform, engaged]);
  
  // Note: With pointer capture, we don't need document-level listeners
  // The pointer events will continue to fire on the overlay even when
  // the pointer moves outside or over child elements
  
  // Note: Auto-switch is already handled by the explorer component
  // Removing duplicate auto-switch logic to prevent conflicts
  
  // Show toast notification
  const showToast = (message: string) => {
    // Clear existing timeout
    if (toastTimeoutRef.current) {
      clearTimeout(toastTimeoutRef.current);
    }
    
    // Create toast element
    const toast = document.createElement('div');
    toast.className = 'fixed bottom-4 right-4 bg-gray-800 text-white px-4 py-2 rounded-lg shadow-lg animate-slide-in';
    toast.style.zIndex = String(Z_INDEX.TOAST);
    toast.textContent = message;
    toast.setAttribute('role', 'status');
    toast.setAttribute('aria-live', 'polite');
    
    document.body.appendChild(toast);
    
    // Animate in
    requestAnimationFrame(() => {
      toast.style.opacity = '1';
      toast.style.transform = 'translateY(0)';
    });
    
    // Remove after delay
    toastTimeoutRef.current = setTimeout(() => {
      toast.style.opacity = '0';
      toast.style.transform = 'translateY(10px)';
      setTimeout(() => toast.remove(), 300);
    }, 2000);
  };
  
  // Generate connection lines
  const connectionPaths = ConnectionLineAdapter.adaptConnectionLines(
    popups,
    draggingPopup !== null
  );
  
  // Container transform style with translate3d for GPU acceleration
  const containerStyle = {
    transform: `translate3d(${transform.x}px, ${transform.y}px, 0) scale(${transform.scale})`,
    transformOrigin: '0 0',
    willChange: isPanning ? 'transform' : 'auto'
  };

  // Recompute overlay bounds to match the canvas area (avoids hardcoded offsets)
  const recomputeOverlayBounds = useCallback(() => {
    if (typeof window === 'undefined') return;
    const canvasEl = document.getElementById('canvas-container');
    if (canvasEl) {
      const rect = canvasEl.getBoundingClientRect();
      // If a sidebar is present, subtract its area from the interactive bounds
      const sidebarEl = document.querySelector('[data-sidebar]') as HTMLElement | null;
      let effectiveLeft = rect.left;
      let effectiveWidth = rect.width;
      if (sidebarEl) {
        const s = sidebarEl.getBoundingClientRect();
        // If the sidebar overlaps the left portion of the canvas horizontally,
        // shift the interactive area to start at the sidebar's right edge
        const overlap = Math.max(0, s.right - rect.left);
        if (overlap > 0) {
          effectiveLeft = rect.left + overlap;
          effectiveWidth = Math.max(0, rect.width - overlap);
        }
      }
      setOverlayBounds({
        top: Math.max(0, rect.top),
        left: Math.max(0, effectiveLeft),
        width: Math.max(0, effectiveWidth),
        height: Math.max(0, rect.height),
      });
      // Track container for portal mounting
      setOverlayContainer(canvasEl as HTMLElement);
      debugLog('PopupOverlay', 'overlay_bounds_updated', { rect });
    } else {
      // Fallback: full viewport minus sidebar (legacy)
      setOverlayBounds({ top: 0, left: 320, width: window.innerWidth - 320, height: window.innerHeight });
      debugLog('PopupOverlay', 'overlay_bounds_fallback', { left: 320 });
    }
  }, []);

  useEffect(() => {
    // Initial compute and on resize
    recomputeOverlayBounds();
    const onResize = () => recomputeOverlayBounds();
    window.addEventListener('resize', onResize);
    const onScroll = () => recomputeOverlayBounds();
    window.addEventListener('scroll', onScroll, { passive: true });
    // Recompute after short delay to catch sidebar transitions
    const t = setTimeout(recomputeOverlayBounds, 300);
    return () => {
      window.removeEventListener('resize', onResize);
      window.removeEventListener('scroll', onScroll as any);
      clearTimeout(t);
    };
  }, [recomputeOverlayBounds]);

  // Gate overlay interactivity based on pointer location relative to canvas container
  useEffect(() => {
    const onPointerMove = (e: PointerEvent) => {
      // If pointer is over any sidebar element, treat as outside overlay
      const target = e.target as HTMLElement | null;
      if (target && target.closest('[data-sidebar]')) {
        setIsPointerInside(false);
        return;
      }
      let rect: DOMRect | null = null;
      if (overlayContainer) {
        rect = overlayContainer.getBoundingClientRect();
      } else if (overlayBounds) {
        rect = new DOMRect(overlayBounds.left, overlayBounds.top, overlayBounds.width, overlayBounds.height);
      }
      if (!rect) return;
      const inside = e.clientX >= rect.left && e.clientX <= rect.right && e.clientY >= rect.top && e.clientY <= rect.bottom;
      setIsPointerInside(inside);
    };
    window.addEventListener('pointermove', onPointerMove, { passive: true });
    return () => window.removeEventListener('pointermove', onPointerMove);
  }, [overlayContainer, overlayBounds]);

  // No global pointer tracking needed when overlay is confined to canvas container via portal.
  
  // Debug log container style
  useEffect(() => {
    debugLog('PopupOverlay', 'container_style', {
      containerStyle,
      hasContainer: !!containerRef.current,
      computedTransform: containerRef.current?.style?.transform || 'none'
    });
  }, [containerStyle]);
  
  // Viewport culling - only render visible popups
  const visiblePopups = useMemo(() => {
    if (typeof window === 'undefined') return Array.from(popups.values())
    
    const viewport = {
      width: window.innerWidth,
      height: window.innerHeight,
    }
    
    return Array.from(popups.values()).filter((popup) => {
      if (!popup.canvasPosition) return false
      
      // Convert canvas position to screen position
      const screenPos = CoordinateBridge.canvasToScreen(
        popup.canvasPosition || popup.position,
        transform
      )
      
      // Check if popup is within viewport (with some margin)
      const margin = 100
      const popupWidth = 300
      const popupHeight = popup.height || 400
      
      return (
        screenPos.x + popupWidth >= -margin &&
        screenPos.x <= viewport.width + margin &&
        screenPos.y + popupHeight >= -margin &&
        screenPos.y <= viewport.height + margin
      )
    })
  }, [popups, transform])
  
  // Build overlay contents (absolute inside canvas container)
  const overlayInner = (
    <div
      ref={overlayRef}
      id="popup-overlay"
      className="absolute inset-0"
      style={{
        // Keep overlay above canvas content but below sidebar (sidebar lives outside container)
        zIndex: 40,
        overflow: 'hidden',
        // Only accept events while hovered (or when actively panning)
        pointerEvents: (isPanning || (isActiveLayer && popups.size > 0 && isPointerInside)) ? 'auto' : 'none',
        touchAction: (isPanning || (isActiveLayer && popups.size > 0)) ? 'none' : 'auto',
        cursor: isPanning ? 'grabbing' : ((isActiveLayer && popups.size > 0) ? 'grab' : 'default'),
      }}
      data-layer="popups"
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerEnd}
      onPointerCancel={handlePointerEnd}
      onPointerEnter={() => setIsOverlayHovered(true)}
      onPointerLeave={() => setIsOverlayHovered(false)}
    >
      {/* Transform container - applies pan/zoom to all children */}
      <div ref={containerRef} className="absolute inset-0" style={containerStyle}>
        {/* Invisible background to catch clicks on empty space */}
        <div className="absolute inset-0 popup-background" style={{ backgroundColor: 'transparent' }} aria-hidden="true" />
        {/* Connection lines (canvas coords) */}
        <svg className="absolute inset-0 pointer-events-none" style={{ overflow: 'visible' }}>
          {connectionPaths.map((path, index) => (
            <path key={index} d={path.d} stroke={path.stroke} strokeWidth={path.strokeWidth} opacity={path.opacity} fill="none" strokeLinecap="round" strokeLinejoin="round" />
          ))}
        </svg>
        {/* Popups (canvas coords) - only render visible ones */}
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
                zIndex,
                cursor: popup.isDragging ? 'grabbing' : 'default',
              }}
            >
              {/* Popup Header */}
              <div
                className="px-3 py-2 border-b border-gray-700 flex items-center justify-between cursor-grab active:cursor-grabbing"
                onMouseDown={(e) => onDragStart?.(popup.id, e)}
                style={{ backgroundColor: popup.isDragging ? '#374151' : 'transparent' }}
              >
                <div className="flex items-center gap-2">
                  <Folder className="w-4 h-4 text-blue-400" />
                  <span className="text-sm font-medium text-white truncate">
                    {popup.folder?.name || 'Loading...'}
                  </span>
                </div>
                <button
                  onClick={() => onClosePopup(popup.id)}
                  onMouseDown={(e) => e.stopPropagation()}
                  className="p-0.5 hover:bg-gray-700 rounded pointer-events-auto"
                  aria-label="Close popup"
                >
                  <X className="w-4 h-4 text-gray-400" />
                </button>
              </div>
              {/* Popup Content */}
              <div className="overflow-y-auto" style={{ maxHeight: 'calc(400px - 100px)' }}>
                {popup.isLoading ? (
                  <div className="p-4 text-center text-gray-500 text-sm">Loading...</div>
                ) : popup.folder?.children && popup.folder.children.length > 0 ? (
                  <div className="py-1">
                    {popup.folder.children.map((child: any) => (
                      <div
                        key={child.id}
                        className="px-3 py-2 hover:bg-gray-700 cursor-pointer flex items-center justify-between text-sm group"
                      >
                        <div className="flex items-center gap-2 flex-1 min-w-0">
                          {child.type === 'folder' ? (
                            <Folder className="w-4 h-4 text-blue-400 flex-shrink-0" />
                          ) : (
                            <FileText className="w-4 h-4 text-gray-400 flex-shrink-0" />
                          )}
                          <span className="text-gray-200 truncate">{child.name}</span>
                        </div>
                        {child.type === 'folder' && (
                          <div
                            onMouseEnter={(e) => {
                              e.stopPropagation();
                              onHoverFolder?.(child, e, popup.id);
                            }}
                            onMouseLeave={(e) => {
                              e.stopPropagation();
                              onLeaveFolder?.();
                            }}
                            className="p-1 -m-1"
                          >
                            <Eye className="w-4 h-4 text-gray-500 opacity-0 group-hover:opacity-100 transition-opacity flex-shrink-0" />
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="p-4 text-center text-gray-500 text-sm">Empty folder</div>
                )}
              </div>
              {/* Popup Footer */}
              <div className="px-3 py-1.5 border-t border-gray-700 text-xs text-gray-500">
                Level {popup.level} • {popup.folder?.children?.length || 0} items
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );

  // Prefer mounting inside canvas container when available
  if (typeof window !== 'undefined' && overlayContainer) {
    return createPortal(overlayInner, overlayContainer);
  }

  // Fallback: fixed overlay aligned to canvas bounds
  return (
    <div
      ref={overlayRef}
      id="popup-overlay"
      className="fixed"
      style={{
        top: overlayBounds ? `${overlayBounds.top}px` : 0,
        left: overlayBounds ? `${overlayBounds.left}px` : '320px',
        width: overlayBounds ? `${overlayBounds.width}px` : `calc(100vw - 320px)`,
        height: overlayBounds ? `${overlayBounds.height}px` : '100vh',
        // Popup overlay should be below sidebar (z-50) but above canvas
        zIndex: 40, // Below sidebar z-50, above canvas
        // Ensure overlay content does not spill into sidebar area
        overflow: 'hidden',
        // Only accept events while hovered (or when actively panning)
        pointerEvents: (isPanning || (isActiveLayer && popups.size > 0 && isPointerInside)) ? 'auto' : 'none',
        // Prevent browser touch gestures only when interactive
        touchAction: (isPanning || (isActiveLayer && popups.size > 0)) ? 'none' : 'auto',
        // Show grab cursor when hovering empty space
        cursor: isPanning ? 'grabbing' : ((isActiveLayer && popups.size > 0) ? 'grab' : 'default'),
      }}
      data-layer="popups"
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerEnd}
      onPointerCancel={handlePointerEnd}
      onPointerEnter={() => setIsOverlayHovered(true)}
      onPointerLeave={() => setIsOverlayHovered(false)}
    >
      {/* Transform container - applies pan/zoom to all children */}
      <div
        ref={containerRef}
        className="absolute inset-0"
        style={containerStyle}
      >
        {/* Invisible background to catch clicks on empty space */}
        <div 
          className="absolute inset-0 popup-background" 
          style={{ backgroundColor: 'transparent' }}
          aria-hidden="true"
        />
        
        {/* Connection lines (canvas coords) */}
        <svg 
          className="absolute inset-0 pointer-events-none"
          style={{ overflow: 'visible' }}
        >
        {connectionPaths.map((path, index) => (
          <path
            key={index}
            d={path.d}
            stroke={path.stroke}
            strokeWidth={path.strokeWidth}
            opacity={path.opacity}
            fill="none"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        ))}
      </svg>
      
      {/* Popups (canvas coords) - only render visible ones */}
      {visiblePopups.map((popup) => {
        // Use canvas position if available, otherwise use screen position
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
              zIndex,
              cursor: popup.isDragging ? 'grabbing' : 'default',
            }}
          >
            {/* Popup Header */}
            <div
              className="px-3 py-2 border-b border-gray-700 flex items-center justify-between cursor-grab active:cursor-grabbing"
              onMouseDown={(e) => onDragStart?.(popup.id, e)}
              style={{
                backgroundColor: popup.isDragging ? '#374151' : 'transparent',
              }}
            >
              <div className="flex items-center gap-2">
                <Folder className="w-4 h-4 text-blue-400" />
                <span className="text-sm font-medium text-white truncate">
                  {popup.folder?.name || 'Loading...'}
                </span>
              </div>
              <button
                onClick={() => onClosePopup(popup.id)}
                onMouseDown={(e) => e.stopPropagation()}
                className="p-0.5 hover:bg-gray-700 rounded pointer-events-auto"
                aria-label="Close popup"
              >
                <X className="w-4 h-4 text-gray-400" />
              </button>
            </div>
            
            {/* Popup Content */}
            <div className="overflow-y-auto" style={{ maxHeight: 'calc(400px - 100px)' }}>
              {popup.isLoading ? (
                <div className="p-4 text-center text-gray-500 text-sm">
                  Loading...
                </div>
              ) : popup.folder?.children && popup.folder.children.length > 0 ? (
                <div className="py-1">
                  {popup.folder.children.map((child: any) => (
                    <div
                      key={child.id}
                      className="px-3 py-2 hover:bg-gray-700 cursor-pointer flex items-center justify-between text-sm group"
                    >
                      <div className="flex items-center gap-2 flex-1 min-w-0">
                        {child.type === 'folder' ? (
                          <Folder className="w-4 h-4 text-blue-400 flex-shrink-0" />
                        ) : (
                          <FileText className="w-4 h-4 text-gray-400 flex-shrink-0" />
                        )}
                        <span className="text-gray-200 truncate">{child.name}</span>
                      </div>
                      {child.type === 'folder' && (
                        <div
                          onMouseEnter={(e) => {
                            e.stopPropagation();
                            onHoverFolder?.(child, e, popup.id);
                          }}
                          onMouseLeave={(e) => {
                            e.stopPropagation();
                            onLeaveFolder?.();
                          }}
                          className="p-1 -m-1"
                        >
                          <Eye className="w-4 h-4 text-gray-500 opacity-0 group-hover:opacity-100 transition-opacity flex-shrink-0" />
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              ) : (
                <div className="p-4 text-center text-gray-500 text-sm">
                  Empty folder
                </div>
              )}
            </div>
            
            {/* Popup Footer */}
            <div className="px-3 py-1.5 border-t border-gray-700 text-xs text-gray-500">
              Level {popup.level} • {popup.folder?.children?.length || 0} items
            </div>
          </div>
        );
      })}
      </div> {/* Close transform container */}
    </div>
  );
};

// Export for use in other components
export default PopupOverlay;
