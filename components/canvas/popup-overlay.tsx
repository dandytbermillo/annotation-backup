'use client';

import React, { useEffect, useRef, useMemo, useState, useCallback } from 'react';
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
  
  // Use the same LayerProvider context as the explorer
  const layerContext = useLayer();
  
  const overlayRef = useRef<HTMLDivElement>(null);
  const toastTimeoutRef = useRef<NodeJS.Timeout>();
  
  // Pan gesture state
  const [isPanning, setIsPanning] = useState(false);
  const panGestureRef = useRef({
    startX: 0,
    startY: 0,
    lastDx: 0,
    lastDy: 0,
    pointerId: -1,
    engaged: false
  });
  
  // Early return if context is not available
  if (!multiLayerEnabled || !layerContext) {
    return null; // Feature not enabled or context not available
  }
  
  const { transforms, layers, activeLayer, setActiveLayer, updateTransformByDelta, setGesture, currentGesture } = layerContext;
  
  // Debug log context availability
  useEffect(() => {
    debugLog('PopupOverlay', 'context_check', {
      hasUpdateTransformByDelta: !!updateTransformByDelta,
      hasSetGesture: !!setGesture,
      activeLayer,
      popupCount: popups.size
    });
  }, [updateTransformByDelta, setGesture, activeLayer, popups.size]);
  
  // Get popup layer state from LayerProvider
  const popupLayer = layers.get('popups');
  const popupTransform = transforms.popups || { x: 0, y: 0, scale: 1 };
  
  if (!popupLayer) {
    return null; // Layer not initialized
  }
  
  // Check if the pointer event is on empty space (not on interactive elements)
  const isOverlayEmptySpace = useCallback((e: React.PointerEvent) => {
    const target = e.target as HTMLElement;
    // Check if clicking on the overlay background or non-interactive areas
    return target.id === 'popup-overlay' || 
           target.classList.contains('popup-background') ||
           (!target.closest('.popup-card') && !target.closest('button'));
  }, []);
  
  // Handle pan start
  const handlePointerDown = useCallback((e: React.PointerEvent) => {
    // Only pan when popup layer is active and clicking on empty space
    if (activeLayer !== 'popups' || !isOverlayEmptySpace(e)) {
      debugLog('PopupOverlay', 'pan_blocked', { 
        activeLayer, 
        isEmptySpace: isOverlayEmptySpace(e),
        target: (e.target as HTMLElement).className 
      });
      return;
    }
    
    // Check if another gesture is in progress
    if (currentGesture && currentGesture.type !== 'none') {
      debugLog('PopupOverlay', 'gesture_conflict', { 
        currentGesture: currentGesture.type,
        txId: currentGesture.txId 
      });
      return;
    }
    
    const overlay = overlayRef.current;
    if (!overlay) return;
    
    debugLog('PopupOverlay', 'pan_start', { 
      clientX: e.clientX, 
      clientY: e.clientY 
    });
    
    // Start overlay pan gesture
    setGesture('overlay-pan');
    
    // Capture the pointer for robust dragging
    overlay.setPointerCapture(e.pointerId);
    
    // Initialize gesture state
    panGestureRef.current = {
      startX: e.clientX,
      startY: e.clientY,
      lastDx: 0,
      lastDy: 0,
      pointerId: e.pointerId,
      engaged: false
    };
    
    // Prevent text selection during pan
    document.body.style.userSelect = 'none';
    if (overlay) {
      overlay.style.willChange = 'transform';
      overlay.style.cursor = 'grabbing';
    }
    
    setIsPanning(true);
  }, [activeLayer, isOverlayEmptySpace, currentGesture, setGesture]);
  
  // Handle pan move
  const handlePointerMove = useCallback((e: React.PointerEvent) => {
    const overlay = overlayRef.current;
    if (!overlay || !overlay.hasPointerCapture(e.pointerId)) {
      // Debug why we're not handling the move
      if (!overlay) {
        debugLog('PopupOverlay', 'move_blocked_no_overlay', {});
      } else if (!overlay.hasPointerCapture(e.pointerId)) {
        debugLog('PopupOverlay', 'move_blocked_no_capture', { pointerId: e.pointerId });
      }
      return;
    }
    
    const gesture = panGestureRef.current;
    const dx = e.clientX - gesture.startX;
    const dy = e.clientY - gesture.startY;
    
    // Apply hysteresis - only engage after 4px movement
    if (!gesture.engaged && Math.hypot(dx, dy) < 4) return;
    
    if (!gesture.engaged) {
      debugLog('PopupOverlay', 'pan_engaged', { 
        distance: Math.hypot(dx, dy).toFixed(2) 
      });
      gesture.engaged = true;
    }
    
    // Calculate delta from last position
    const deltaDx = dx - gesture.lastDx;
    const deltaDy = dy - gesture.lastDy;
    
    // Update transform with delta using the new API
    if (!updateTransformByDelta) {
      debugLog('PopupOverlay', 'no_update_function', {});
    } else if (!currentGesture) {
      debugLog('PopupOverlay', 'no_current_gesture', {});
    } else {
      if (Math.abs(deltaDx) > 0 || Math.abs(deltaDy) > 0) {
        debugLog('PopupOverlay', 'transform_update', { 
          deltaDx, 
          deltaDy, 
          txId: currentGesture.txId,
          beforeTransform: transforms.popups
        });
      }
      updateTransformByDelta('popups', { dx: deltaDx, dy: deltaDy }, { 
        txId: currentGesture.txId 
      });
    }
    
    // Store last position
    gesture.lastDx = dx;
    gesture.lastDy = dy;
  }, [updateTransformByDelta, currentGesture, transforms.popups]);
  
  // Handle pan end
  const handlePointerEnd = useCallback((e?: React.PointerEvent) => {
    const overlay = overlayRef.current;
    if (!overlay) return;
    
    debugLog('PopupOverlay', 'pan_end', { 
      engaged: panGestureRef.current.engaged,
      totalDx: panGestureRef.current.lastDx,
      totalDy: panGestureRef.current.lastDy
    });
    
    // Release pointer capture if we have a pointer event
    if (e && panGestureRef.current.pointerId >= 0) {
      try {
        overlay.releasePointerCapture(panGestureRef.current.pointerId);
      } catch (err) {
        // Pointer might already be released
      }
    }
    
    // Reset styles
    document.body.style.userSelect = '';
    if (overlay) {
      overlay.style.willChange = '';
      overlay.style.cursor = '';
    }
    
    // Reset gesture state
    panGestureRef.current = {
      startX: 0,
      startY: 0,
      lastDx: 0,
      lastDy: 0,
      pointerId: -1,
      engaged: false
    };
    
    setIsPanning(false);
    
    // End the gesture
    setGesture('none');
  }, [setGesture]);
  
  // Handle window blur - cancel any active pan
  useEffect(() => {
    const handleWindowBlur = () => {
      if (isPanning) {
        handlePointerEnd();
      }
    };
    
    window.addEventListener('blur', handleWindowBlur);
    return () => {
      window.removeEventListener('blur', handleWindowBlur);
    };
  }, [isPanning, handlePointerEnd]);
  
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
  
  // Container transform style
  const containerStyle = CoordinateBridge.containerTransformStyle(popupTransform);
  
  // Debug log transform changes
  useEffect(() => {
    debugLog('PopupOverlay', 'transform_changed', {
      x: popupTransform.x,
      y: popupTransform.y,
      scale: popupTransform.scale
    });
  }, [popupTransform.x, popupTransform.y, popupTransform.scale]);
  
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
        popup.canvasPosition,
        popupTransform
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
  }, [popups, popupTransform])
  
  return (
    <div
      ref={overlayRef}
      id="popup-overlay"
      className="fixed inset-0"
      style={{
        // Ensure popup overlay is always above canvas panels
        zIndex: Math.max(Z_INDEX.POPUP_OVERLAY, 100),
        // Enable pointer events for pan handling
        pointerEvents: activeLayer === 'popups' ? 'auto' : 'none',
        // Prevent browser touch gestures
        touchAction: 'none',
        // Show grab cursor when hovering empty space
        cursor: isPanning ? 'grabbing' : (activeLayer === 'popups' ? 'grab' : 'default'),
      }}
      data-layer="popups"
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerEnd}
      onPointerCancel={handlePointerEnd}
    >
      {/* Transform container - applies pan/zoom to all children */}
      <div
        className="absolute inset-0"
        style={{
          ...containerStyle,
          // Ensure transform origin is correct
          transformOrigin: '0 0',
        }}
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
        if (!popup.canvasPosition) return null;
        
        const zIndex = getPopupZIndex(
          popup.level,
          popup.isDragging || popup.id === draggingPopup,
          true
        );
        
        const isActive = activeLayer === 'popups';
        const opacity = isActive ? 1 : 0.6;
        
        return (
          <div
            key={popup.id}
            id={`popup-${popup.id}`}
            className="popup-card absolute bg-gray-800 border border-gray-700 rounded-lg shadow-xl pointer-events-auto"
            style={{
              left: `${popup.canvasPosition.x}px`,
              top: `${popup.canvasPosition.y}px`,
              width: '300px',
              maxHeight: '400px',
              zIndex,
              opacity,
              cursor: popup.isDragging ? 'grabbing' : 'default',
              transition: popup.isDragging ? 'none' : 'opacity 0.3s ease',
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
