'use client';

import React, { useEffect, useRef, useMemo } from 'react';
import { useFeatureFlag } from '@/lib/offline/feature-flags';
import { CoordinateBridge } from '@/lib/utils/coordinate-bridge';
import { ConnectionLineAdapter, PopupState } from '@/lib/rendering/connection-line-adapter';
import { Z_INDEX, getPopupZIndex } from '@/lib/constants/z-index';
import { useLayer } from '@/components/canvas/layer-provider';
import { PopupStateAdapter } from '@/lib/adapters/popup-state-adapter';
import { X, Folder, FileText, Eye } from 'lucide-react';

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
  
  // Early return if context is not available
  if (!multiLayerEnabled || !layerContext) {
    return null; // Feature not enabled or context not available
  }
  
  const { transforms, layers, activeLayer, setActiveLayer } = layerContext;
  
  // Get popup layer state from LayerProvider
  const popupLayer = layers.get('popups');
  const popupTransform = transforms.popups || { x: 0, y: 0, scale: 1 };
  
  if (!popupLayer) {
    return null; // Layer not initialized
  }
  
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
      className="fixed inset-0 pointer-events-none"
      style={{
        // Ensure popup overlay is always above canvas panels
        zIndex: Math.max(Z_INDEX.POPUP_OVERLAY, 100),
        ...containerStyle,
      }}
      data-layer="popups"
    >
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
            className="absolute bg-gray-800 border border-gray-700 rounded-lg shadow-xl pointer-events-auto"
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
    </div>
  );
};

// Export for use in other components
export default PopupOverlay;
