'use client';

import React, { useEffect, useRef, useState, useCallback, useMemo } from 'react';
import { Z_INDEX, getPopupZIndex } from '@/lib/constants/z-index';
import { X, Folder, FileText, Eye } from 'lucide-react';
import { debugLog } from '@/lib/utils/debug-logger';

interface Transform {
  x: number;
  y: number;
  scale: number;
}

interface PopupData {
  id: string;
  folder: any;
  canvasPosition: { x: number; y: number }; // Fixed canvas coordinates
  isLoading: boolean;
  parentId?: string;
  level: number;
  isDragging?: boolean;
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
 * PopupOverlay - Improved with infinite-canvas patterns
 * Uses container transform with translate3d for GPU acceleration
 */
export const PopupOverlay: React.FC<PopupOverlayProps> = ({
  popups,
  draggingPopup,
  onClosePopup,
  onDragStart,
  onHoverFolder,
  onLeaveFolder,
}) => {
  const multiLayerEnabled = true;

  useEffect(() => {
    debugLog('PopupOverlay', 'improved_state', {
      multiLayerEnabled,
      popupCount: popups.size,
    });
  }, [multiLayerEnabled, popups.size]);

  // Local transform state - manages its own pan/zoom
  const [transform, setTransform] = useState<Transform>({ x: 0, y: 0, scale: 1 });
  
  // Pan state
  const [isPanning, setIsPanning] = useState(false);
  const panStartRef = useRef({ x: 0, y: 0 });
  const lastPanRef = useRef({ x: 0, y: 0 });
  
  // Refs
  const overlayRef = useRef<HTMLDivElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  
  
  // Handle pan start
  const handlePointerDown = useCallback((e: React.PointerEvent) => {
    const target = e.target as HTMLElement;
    
    // Check if clicking on empty space (not on popup card or button)
    const isOnPopup = !!target.closest('.popup-card');
    const isOnButton = !!target.closest('button');
    
    if (isOnPopup || isOnButton) {
      debugLog('PopupOverlay', 'click_on_popup', { target: target.className });
      return;
    }
    
    // Start panning
    debugLog('PopupOverlay', 'pan_start', { 
      clientX: e.clientX, 
      clientY: e.clientY,
      currentTransform: transform
    });
    
    setIsPanning(true);
    panStartRef.current = { x: e.clientX, y: e.clientY };
    lastPanRef.current = { x: e.clientX, y: e.clientY };
    
    // Capture pointer for robust dragging
    overlayRef.current?.setPointerCapture(e.pointerId);
    
    // Optimize for dragging
    if (containerRef.current) {
      containerRef.current.style.willChange = 'transform';
    }
    document.body.style.userSelect = 'none';
    document.body.style.cursor = 'grabbing';
    
    e.preventDefault();
  }, [transform]);
  
  // Handle pan move
  const handlePointerMove = useCallback((e: React.PointerEvent) => {
    if (!isPanning) return;
    
    // Calculate delta from last position
    const deltaX = e.clientX - lastPanRef.current.x;
    const deltaY = e.clientY - lastPanRef.current.y;
    
    // Apply delta to transform
    setTransform(prev => {
      const newTransform = {
        ...prev,
        x: prev.x + deltaX,
        y: prev.y + deltaY
      };
      
      debugLog('PopupOverlay', 'pan_move', { 
        deltaX, 
        deltaY,
        newTransform
      });
      
      return newTransform;
    });
    
    // Update last position
    lastPanRef.current = { x: e.clientX, y: e.clientY };
  }, [isPanning]);
  
  // Handle pan end
  const handlePointerUp = useCallback((e: React.PointerEvent) => {
    if (!isPanning) return;
    
    debugLog('PopupOverlay', 'pan_end', { 
      totalDelta: {
        x: e.clientX - panStartRef.current.x,
        y: e.clientY - panStartRef.current.y
      }
    });
    
    setIsPanning(false);
    
    // Release pointer capture
    overlayRef.current?.releasePointerCapture(e.pointerId);
    
    // Reset optimizations
    if (containerRef.current) {
      containerRef.current.style.willChange = '';
    }
    document.body.style.userSelect = '';
    document.body.style.cursor = '';
  }, [isPanning]);
  
  // Handle wheel zoom
  const handleWheel = useCallback((e: React.WheelEvent) => {
    e.preventDefault();
    
    const scaleDelta = e.deltaY > 0 ? 0.9 : 1.1;
    const newScale = Math.max(0.3, Math.min(2, transform.scale * scaleDelta));
    
    // Get mouse position relative to overlay
    const rect = overlayRef.current?.getBoundingClientRect();
    if (!rect) return;
    
    const mouseX = e.clientX - rect.left;
    const mouseY = e.clientY - rect.top;
    
    // Calculate new transform to zoom around mouse position
    const scaleChange = newScale / transform.scale;
    
    setTransform(prev => ({
      scale: newScale,
      x: mouseX - (mouseX - prev.x) * scaleChange,
      y: mouseY - (mouseY - prev.y) * scaleChange
    }));
    
    debugLog('PopupOverlay', 'zoom', { 
      newScale,
      mousePosition: { x: mouseX, y: mouseY }
    });
  }, [transform.scale, transform.x, transform.y]);
  
  // Generate connection lines in canvas space
  const connectionPaths = useMemo(() => {
    const paths: any[] = [];
    
    popups.forEach((popup, id) => {
      if (popup.parentId) {
        const parent = popups.get(popup.parentId);
        if (parent) {
          // Use canvas positions directly
          const startX = parent.canvasPosition.x + 280; // Approximate popup width
          const startY = parent.canvasPosition.y + 50; // Approximate header height
          const endX = popup.canvasPosition.x;
          const endY = popup.canvasPosition.y + 50;
          
          const controlX = (startX + endX) / 2;
          
          paths.push({
            d: `M ${startX} ${startY} Q ${controlX} ${startY} ${endX} ${endY}`,
            stroke: '#4B5563',
            strokeWidth: 2,
            opacity: popup.isDragging ? 0.3 : 0.6
          });
        }
      }
    });
    
    return paths;
  }, [popups]);
  
  // Container transform style using translate3d for GPU acceleration
  const containerStyle: React.CSSProperties = {
    transform: `translate3d(${transform.x}px, ${transform.y}px, 0) scale(${transform.scale})`,
    transformOrigin: '0 0',
    willChange: isPanning ? 'transform' : 'auto',
  };

  return (
    <div
      ref={overlayRef}
      className="fixed inset-0"
      style={{
        zIndex: Z_INDEX.POPUP_OVERLAY || 100,
        cursor: isPanning ? 'grabbing' : 'grab',
        touchAction: 'none', // Prevent browser touch gestures
      }}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      onPointerCancel={handlePointerUp}
      onWheel={handleWheel}
    >
      {/* Transform container - all content moves together */}
      <div
        ref={containerRef}
        className="absolute inset-0"
        style={containerStyle}
      >
        {/* Connection lines SVG */}
        <svg 
          className="absolute inset-0 pointer-events-none"
          style={{ 
            overflow: 'visible',
            width: '100%',
            height: '100%'
          }}
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
        
        {/* Popups - positioned in canvas coordinates */}
        {Array.from(popups.values()).map((popup) => {
          const zIndex = getPopupZIndex(
            popup.level,
            popup.isDragging || popup.id === draggingPopup,
            true
          );
          
          return (
            <div
              key={popup.id}
              id={`popup-${popup.id}`}
              className="popup-card absolute bg-gray-800 border border-gray-700 rounded-lg shadow-xl"
              style={{
                left: `${popup.canvasPosition.x}px`,
                top: `${popup.canvasPosition.y}px`,
                width: '300px',
                maxHeight: '400px',
                zIndex,
                cursor: popup.isDragging ? 'grabbing' : 'default',
                pointerEvents: 'auto',
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
                  className="p-0.5 hover:bg-gray-700 rounded"
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
      </div>
    </div>
  );
};

export default PopupOverlay;
