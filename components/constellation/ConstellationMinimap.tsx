'use client';

import React, { useRef, useEffect, useCallback, useMemo, useState } from 'react';
import ReactDOM from 'react-dom';
import { ConstellationItem, AppState, Position } from '@/types/constellation';
import { transformPoint, getNodePosition } from '@/lib/constellation/constellation-utils';
import { debugLog } from '@/lib/utils/debug-logger';

interface ConstellationMinimapProps {
  allItems: ConstellationItem[];
  connections: Array<[string, string]>;
  state: AppState;
  onNavigate: (x: number, y: number, zoom?: number) => void;
  onItemSelect: (item: ConstellationItem) => void;
  onItemHover: (item: ConstellationItem | null) => void;
  draggedPositions?: { [key: string]: Position };
  getItemDepthLayer: (item: ConstellationItem) => number;
  getDepthZ: (depthLayer: number) => number;
  getConstellationDepthZ: (item: ConstellationItem, depthLayer: number) => number;
  className?: string;
}

// Component preview imports (these would need to be imported from the actual component files)
interface PreviewComponentProps {
  item: ConstellationItem;
  onClose?: () => void;
}

const ConstellationMinimap: React.FC<ConstellationMinimapProps> = ({
  allItems,
  connections,
  state,
  onNavigate,
  onItemSelect,
  onItemHover,
  draggedPositions = {},
  getItemDepthLayer,
  getDepthZ,
  getConstellationDepthZ,
  className = ''
}) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const minimapWidth = 320;  // Wider to fill horizontal space
  const minimapHeight = 200; // Keep original height
  const minimapPadding = 20;
  const [isDraggingMinimap, setIsDraggingMinimap] = useState(false);
  const [minimapDragStart, setMinimapDragStart] = useState<Position>({ x: 0, y: 0 });
  const [initialViewportOffset, setInitialViewportOffset] = useState<Position>({ x: 0, y: 0 });

  // Use ref for immediate access to minimap dragging state
  const isMinimapDraggingRef = useRef(false);
  const dragPanOffsetRef = useRef<Position>({ x: 0, y: 0 });
  
  // Shift+hover preview functionality
  const [isShiftPressed, setIsShiftPressed] = useState(false);
  const [hoveredComponent, setHoveredComponent] = useState<ConstellationItem | null>(null);
  const [previewPosition, setPreviewPosition] = useState<Position>({ x: 0, y: 0 });
  const [isInteractingWithPreview, setIsInteractingWithPreview] = useState(false);
  const [previewPinned, setPreviewPinned] = useState(false);
  
  // Draggable preview state
  const [isDraggingPopup, setIsDraggingPopup] = useState(false);
  const [popupDragOffset, setPopupDragOffset] = useState<Position>({ x: 0, y: 0 });
  const isPopupDraggingRef = useRef(false);
  const dragOffsetRef = useRef<Position>({ x: 0, y: 0 });

  // Component mount effect (removed debug logs)
  useEffect(() => {
    // Component mounted successfully
    return () => {
      // Component will unmount
    };
  }, []);

  // Track Shift key state
  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Shift') {
        setIsShiftPressed(true);
      }
    };

    const handleKeyUp = (event: KeyboardEvent) => {
      if (event.key === 'Shift') {
        setIsShiftPressed(false);
        if (!isInteractingWithPreview && !previewPinned) {
          setHoveredComponent(null);
        }
      }
    };

    document.addEventListener('keydown', handleKeyDown);
    document.addEventListener('keyup', handleKeyUp);

    return () => {
      document.removeEventListener('keydown', handleKeyDown);
      document.removeEventListener('keyup', handleKeyUp);
    };
  }, [isInteractingWithPreview, previewPinned]);

  // Get effective position for an item (dragged position if available, otherwise use nodePositions)
  const getItemPosition = useCallback((item: ConstellationItem) => {
    if (draggedPositions[item.id]) {
      return draggedPositions[item.id];
    }
    return getNodePosition(item, state.nodePositions, allItems);
  }, [draggedPositions, state.nodePositions, allItems]);

  // Calculate current viewport first to include it in bounds
  const viewport = useMemo(() => {
    const viewWidth = (typeof window !== 'undefined' ? window.innerWidth : 1920) / state.zoom;
    const viewHeight = (typeof window !== 'undefined' ? window.innerHeight : 1080) / state.zoom;

    // Transform: screen_x = world_x + pan.x (when zoom=1)
    // So world_x at screen center: world_x = centerX - pan.x
    const viewCenterWorldX = state.centerX - (state.pan?.x || 0);
    const viewCenterWorldY = state.centerY - (state.pan?.y || 0);

    return {
      x: viewCenterWorldX - viewWidth / 2,
      y: viewCenterWorldY - viewHeight / 2,
      width: viewWidth,
      height: viewHeight
    };
  }, [state.centerX, state.centerY, state.pan, state.zoom]);

  // Calculate bounds of all items including viewport area
  const bounds = useMemo(() => {
    if (allItems.length === 0) {
      return { minX: -500, maxX: 500, minY: -500, maxY: 500 };
    }

    let minX = Infinity;
    let maxX = -Infinity;
    let minY = Infinity;
    let maxY = -Infinity;

    allItems.forEach(item => {
      // Use world coordinates only - no 3D transformations
      const worldPos = getItemPosition(item);

      minX = Math.min(minX, worldPos.x);
      maxX = Math.max(maxX, worldPos.x);
      minY = Math.min(minY, worldPos.y);
      maxY = Math.max(maxY, worldPos.y);
    });

    // Include viewport bounds to ensure it's never clipped
    minX = Math.min(minX, viewport.x);
    maxX = Math.max(maxX, viewport.x + viewport.width);
    minY = Math.min(minY, viewport.y);
    maxY = Math.max(maxY, viewport.y + viewport.height);

    // Add padding for visual breathing room
    const padding = 100;
    return {
      minX: minX - padding,
      maxX: maxX + padding,
      minY: minY - padding,
      maxY: maxY + padding
    };
  }, [allItems, getItemPosition, viewport]);

  // Calculate scale to fit all items in minimap
  const scale = useMemo(() => {
    const contentWidth = bounds.maxX - bounds.minX;
    const contentHeight = bounds.maxY - bounds.minY;
    const availableWidth = minimapWidth - minimapPadding * 2;
    const availableHeight = minimapHeight - minimapPadding * 2;

    return Math.min(availableWidth / contentWidth, availableHeight / contentHeight);
  }, [bounds, minimapWidth, minimapHeight, minimapPadding]);

  // Convert world coordinates to minimap coordinates
  const worldToMinimap = useCallback((worldX: number, worldY: number) => {
    return {
      x: (worldX - bounds.minX) * scale + minimapPadding,
      y: (worldY - bounds.minY) * scale + minimapPadding
    };
  }, [bounds, scale, minimapPadding]);

  // Convert minimap coordinates to world coordinates
  const minimapToWorld = useCallback((minimapX: number, minimapY: number) => {
    return {
      x: (minimapX - minimapPadding) / scale + bounds.minX,
      y: (minimapY - minimapPadding) / scale + bounds.minY
    };
  }, [bounds, scale, minimapPadding]);

  // Find item at minimap position - FIXED: Use world coordinates only
  const getItemAtMinimapPosition = useCallback((minimapX: number, minimapY: number) => {
    for (const item of allItems) {
      // Use world coordinates only - no 3D transformations
      const worldPos = getItemPosition(item);
      const pos = worldToMinimap(worldPos.x, worldPos.y);
      
      const size = 5; // Base size for items in minimap (no scale needed)
      
      if (minimapX >= pos.x - size && minimapX <= pos.x + size &&
          minimapY >= pos.y - size && minimapY <= pos.y + size) {
        return item;
      }
    }
    return null;
  }, [allItems, getItemPosition, worldToMinimap]);

  // Handle minimap double-click - FIXED: Use world coordinates for navigation
  const handleMinimapDoubleClick = useCallback((event: React.MouseEvent) => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    
    const rect = canvas.getBoundingClientRect();
    const minimapX = event.clientX - rect.left;
    const minimapY = event.clientY - rect.top;
    
    const clickedItem = getItemAtMinimapPosition(minimapX, minimapY);
    
    if (clickedItem) {
      // Use world coordinates for navigation - no 3D transformation
      const worldPos = getItemPosition(clickedItem);
      
      // Navigate to item using world coordinates
      onNavigate(worldPos.x, worldPos.y);
      
      // Select item
      onItemSelect(clickedItem);
    }
    
    event.preventDefault();
  }, [getItemAtMinimapPosition, getItemPosition, onNavigate, onItemSelect]);

  // Handle minimap mouse down
  const handleMinimapMouseDown = useCallback((event: React.MouseEvent) => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    
    const rect = canvas.getBoundingClientRect();
    const minimapX = event.clientX - rect.left;
    const minimapY = event.clientY - rect.top;
    
    // Check if clicking within viewport rectangle
    const viewportMinimap = worldToMinimap(viewport.x, viewport.y);
    const viewportSize = {
      width: viewport.width * scale,
      height: viewport.height * scale
    };
    
    const isInViewport = minimapX >= viewportMinimap.x && 
                        minimapX <= viewportMinimap.x + viewportSize.width &&
                        minimapY >= viewportMinimap.y && 
                        minimapY <= viewportMinimap.y + viewportSize.height;
    
    if (isInViewport) {
      // Start dragging viewport
      setIsDraggingMinimap(true);
      isMinimapDraggingRef.current = true;
      setMinimapDragStart({ x: minimapX, y: minimapY });

      // Capture the pan offset at drag start for consistent calculations
      const panX = state.pan?.x || 0;
      const panY = state.pan?.y || 0;
      dragPanOffsetRef.current = { x: panX, y: panY };

      // Store the actual viewport center in world coordinates
      const viewCenterWorldX = state.centerX - panX;
      const viewCenterWorldY = state.centerY - panY;
      setInitialViewportOffset({ x: viewCenterWorldX, y: viewCenterWorldY });
    } else {
      // Click outside viewport - navigate to position
      const worldPos = minimapToWorld(minimapX, minimapY);
      onNavigate(worldPos.x, worldPos.y);
    }

    event.preventDefault();
  }, [worldToMinimap, minimapToWorld, viewport, scale, state.centerX, state.centerY, state.pan, onNavigate]);

  // Handle minimap mouse move for viewport dragging
  const handleMinimapMouseMove = useCallback((event: MouseEvent) => {
    if (!isDraggingMinimap) return;
    
    const canvas = canvasRef.current;
    if (!canvas) return;
    
    const rect = canvas.getBoundingClientRect();
    const currentMinimapX = event.clientX - rect.left;
    const currentMinimapY = event.clientY - rect.top;
    
    const deltaMinimapX = currentMinimapX - minimapDragStart.x;
    const deltaMinimapY = currentMinimapY - minimapDragStart.y;
    
    const deltaWorldX = deltaMinimapX / scale;
    const deltaWorldY = deltaMinimapY / scale;

    // Calculate new viewport center in world coordinates
    const newViewportWorldX = initialViewportOffset.x + deltaWorldX;
    const newViewportWorldY = initialViewportOffset.y + deltaWorldY;

    // Convert to state.centerX by adding back the captured pan offset
    // viewport_world = centerX - pan, so centerX = viewport_world + pan
    const newCenterX = newViewportWorldX + dragPanOffsetRef.current.x;
    const newCenterY = newViewportWorldY + dragPanOffsetRef.current.y;

    onNavigate(newCenterX, newCenterY);
  }, [isDraggingMinimap, minimapDragStart, scale, initialViewportOffset, onNavigate]);

  // Handle minimap mouse up
  const handleMinimapMouseUp = useCallback(() => {
    setIsDraggingMinimap(false);
  }, []);

  // Setup drag event listeners with ref-based state checking
  useEffect(() => {
    const handleMouseMove = (event: MouseEvent) => {
      if (!isMinimapDraggingRef.current) return;
      
      const canvas = canvasRef.current;
      if (!canvas) return;
      
      const rect = canvas.getBoundingClientRect();
      const currentMinimapX = event.clientX - rect.left;
      const currentMinimapY = event.clientY - rect.top;
      
      const deltaMinimapX = currentMinimapX - minimapDragStart.x;
      const deltaMinimapY = currentMinimapY - minimapDragStart.y;

      const deltaWorldX = deltaMinimapX / scale;
      const deltaWorldY = deltaMinimapY / scale;

      // Calculate new viewport center in world coordinates
      const newViewportWorldX = initialViewportOffset.x + deltaWorldX;
      const newViewportWorldY = initialViewportOffset.y + deltaWorldY;

      // Convert to state.centerX by adding back the captured pan offset
      const newCenterX = newViewportWorldX + dragPanOffsetRef.current.x;
      const newCenterY = newViewportWorldY + dragPanOffsetRef.current.y;

      onNavigate(newCenterX, newCenterY);
    };

    const handleMouseUp = (event: MouseEvent) => {
      if (isMinimapDraggingRef.current) {
        isMinimapDraggingRef.current = false;
        setIsDraggingMinimap(false);
        event.preventDefault();
        event.stopPropagation();
      }
    };

    if (isDraggingMinimap) {
      document.addEventListener('mousemove', handleMouseMove, { capture: true });
      document.addEventListener('mouseup', handleMouseUp, { capture: true });

      return () => {
        document.removeEventListener('mousemove', handleMouseMove, { capture: true });
        document.removeEventListener('mouseup', handleMouseUp, { capture: true });
      };
    }
  }, [isDraggingMinimap, minimapDragStart, scale, initialViewportOffset, onNavigate]);

  // Emergency cleanup on unmount
  useEffect(() => {
    return () => {
      isMinimapDraggingRef.current = false;
      setIsDraggingMinimap(false);
    };
  }, []);

  // Handle hover detection
  const handleMinimapMouseMoveLocal = useCallback((event: React.MouseEvent) => {
    if (isDraggingMinimap) return;
    
    const canvas = canvasRef.current;
    if (!canvas) return;
    
    const rect = canvas.getBoundingClientRect();
    const minimapX = event.clientX - rect.left;
    const minimapY = event.clientY - rect.top;
    
    const item = getItemAtMinimapPosition(minimapX, minimapY);
    
    if (isShiftPressed && item) {
      setHoveredComponent(item);
      
      // Calculate preview position
      const previewWidth = 320;
      const previewHeight = 400;
      
      let previewX = rect.right + 10;
      let previewY = rect.top;
      
      // Adjust if would go off screen
      if (previewX + previewWidth > window.innerWidth - 10) {
        previewX = rect.left - previewWidth - 10;
      }
      if (previewY + previewHeight > window.innerHeight - 10) {
        previewY = window.innerHeight - previewHeight - 10;
      }
      
      setPreviewPosition({ x: previewX, y: previewY });
    } else if (!isShiftPressed && !isInteractingWithPreview && !previewPinned) {
      setHoveredComponent(null);
    }
  }, [isDraggingMinimap, getItemAtMinimapPosition, isShiftPressed, isInteractingWithPreview, previewPinned]);

  // Get item color based on type and state
  const getItemColor = useCallback((item: ConstellationItem) => {
    const isSelected = state.selectedItem?.id === item.id;
    const isHovered = state.hoveredItem?.id === item.id;
    const isGroupSelected = state.selectedGroupItems?.has(item.id);
    const isDragged = state.draggedNode === item.id;
    
    // State-based colors take priority
    if (isDragged) return '#ff6b35';
    if (isSelected) return '#3b82f6';
    if (isHovered) return '#fbbf24';
    if (isGroupSelected) return '#f97316';
    
    // Constellation colors
    if (item.isCenter) return item.color || '#8b5cf6';
    if (item.color) return item.color;
    
    // Type-based colors
    const typeColors: Record<string, string> = {
      document: '#10b981',
      folder: '#fbbf24',
      media: '#ef4444',
      email: '#06b6d4',
      note: '#a78bfa',
      presentation: '#f59e0b',
      spreadsheet: '#84cc16',
      chat: '#ec4899',
      event: '#6366f1'
    };
    
    return typeColors[item.type] || '#6b7280';
  }, [state.selectedItem, state.hoveredItem, state.selectedGroupItems, state.draggedNode]);

  // Draw minimap
  const drawMinimap = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    
    // Clear canvas
    ctx.clearRect(0, 0, minimapWidth, minimapHeight);

    // Draw background
    ctx.fillStyle = 'rgba(0, 0, 0, 0.8)';
    ctx.fillRect(0, 0, minimapWidth, minimapHeight);

    // Draw border
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.3)';
    ctx.lineWidth = 1;
    ctx.strokeRect(0, 0, minimapWidth, minimapHeight);
    
    // Sort items by depth for proper rendering order - FIXED: Use world coordinates only
    const sortedItems = allItems.map(item => {
      const worldPos = getItemPosition(item);
      const depthLayer = getItemDepthLayer(item);
      const zPos = getConstellationDepthZ(item, depthLayer);
      
      return {
        item,
        worldPos, // Use world position instead of transformed
        depthLayer,
        depth: zPos // Use direct Z position for sorting
      };
    }).sort((a, b) => b.depth - a.depth);
    
    // Draw connections first - FIXED: Use world coordinates only
    connections.forEach(([id1, id2]) => {
      const item1 = allItems.find(item => item.id === id1);
      const item2 = allItems.find(item => item.id === id2);
      
      if (!item1 || !item2) return;
      
      // Use world coordinates directly - no 3D transformation
      const pos1World = getItemPosition(item1);
      const pos2World = getItemPosition(item2);
      
      const pos1 = worldToMinimap(pos1World.x, pos1World.y);
      const pos2 = worldToMinimap(pos2World.x, pos2World.y);
      
      ctx.strokeStyle = 'rgba(100, 181, 246, 0.3)';
      ctx.lineWidth = 0.5;
      ctx.beginPath();
      ctx.moveTo(pos1.x, pos1.y);
      ctx.lineTo(pos2.x, pos2.y);
      ctx.stroke();
    });
    
    // Draw items - FIXED: Use world coordinates only
    sortedItems.forEach(({ item, worldPos, depthLayer }) => {
      // Use world coordinates directly - no 3D transformation
      const pos = worldToMinimap(worldPos.x, worldPos.y);
      const color = getItemColor(item);
      const baseSize = item.isCenter ? 8 : 5;
      const depthScale = Math.max(0.3, 1 - depthLayer * 0.2);
      const size = baseSize * depthScale;
      
      // Draw glow for selected/hovered items
      if (state.selectedItem?.id === item.id || state.hoveredItem?.id === item.id) {
        ctx.fillStyle = color + '44';
        ctx.beginPath();
        ctx.arc(pos.x, pos.y, size + 3, 0, 2 * Math.PI);
        ctx.fill();
      }
      
      // Draw item
      ctx.fillStyle = color;
      ctx.globalAlpha = Math.max(0.3, 1 - depthLayer * 0.25);
      ctx.beginPath();
      ctx.arc(pos.x, pos.y, size, 0, 2 * Math.PI);
      ctx.fill();
      
      // Draw border
      ctx.strokeStyle = 'rgba(255, 255, 255, 0.5)';
      ctx.lineWidth = 1;
      ctx.stroke();
      
      ctx.globalAlpha = 1;
      
      // Draw special indicators
      if (item.isCenter) {
        // Star for constellation centers
        ctx.fillStyle = '#ffffff';
        ctx.font = '8px sans-serif';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText('⭐', pos.x, pos.y);
      } else if (item.type === 'folder' || item.isFolder) {
        // Folder icon
        ctx.fillStyle = '#ffffff';
        ctx.font = '8px sans-serif';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText('📁', pos.x, pos.y);
      }
    });
    
    // Draw viewport rectangle
    const viewportPos = worldToMinimap(viewport.x, viewport.y);
    const viewportSize = {
      width: viewport.width * scale,
      height: viewport.height * scale
    };
    
    ctx.strokeStyle = isDraggingMinimap ? '#f59e0b' : '#fbbf24';
    ctx.lineWidth = isDraggingMinimap ? 3 : 2;
    ctx.setLineDash([3, 3]);
    ctx.strokeRect(viewportPos.x, viewportPos.y, viewportSize.width, viewportSize.height);
    ctx.setLineDash([]);
    
    // Fill viewport
    ctx.fillStyle = isDraggingMinimap ? 'rgba(251, 191, 36, 0.2)' : 'rgba(251, 191, 36, 0.1)';
    ctx.fillRect(viewportPos.x, viewportPos.y, viewportSize.width, viewportSize.height);
  }, [allItems, connections, getItemPosition, getItemDepthLayer, getConstellationDepthZ, worldToMinimap, viewport, scale, getItemColor, isDraggingMinimap]);

  // Draw minimap on state changes
  useEffect(() => {
    drawMinimap();
  }, [drawMinimap]);

  // Component Preview Portal
  const ComponentPreview: React.FC<{ item: ConstellationItem }> = ({ item }) => {
    const handlePinClick = (e: React.MouseEvent) => {
      e.preventDefault();
      e.stopPropagation();
      setPreviewPinned(!previewPinned);
    };

    const handlePopupDragStart = (e: React.MouseEvent) => {
      if ((e.target as HTMLElement).tagName === 'BUTTON') return;
      
      e.preventDefault();
      e.stopPropagation();
      
      setIsDraggingPopup(true);
      isPopupDraggingRef.current = true;
      dragOffsetRef.current = { x: 0, y: 0 };
    };

    const handlePopupDragMove = useCallback((e: MouseEvent) => {
      if (!isPopupDraggingRef.current) return;
      
      const deltaX = e.movementX;
      const deltaY = e.movementY;
      
      dragOffsetRef.current = {
        x: dragOffsetRef.current.x + deltaX,
        y: dragOffsetRef.current.y + deltaY
      };
      
      setPopupDragOffset({ ...dragOffsetRef.current });
    }, []);

    const handlePopupDragEnd = useCallback(() => {
      isPopupDraggingRef.current = false;
      setIsDraggingPopup(false);
      
      setPreviewPosition(prev => ({
        x: prev.x + dragOffsetRef.current.x,
        y: prev.y + dragOffsetRef.current.y
      }));
      
      setPopupDragOffset({ x: 0, y: 0 });
      dragOffsetRef.current = { x: 0, y: 0 };
    }, []);

    useEffect(() => {
      if (isDraggingPopup) {
        document.addEventListener('mousemove', handlePopupDragMove);
        document.addEventListener('mouseup', handlePopupDragEnd);
        
        return () => {
          document.removeEventListener('mousemove', handlePopupDragMove);
          document.removeEventListener('mouseup', handlePopupDragEnd);
        };
      }
    }, [isDraggingPopup, handlePopupDragMove, handlePopupDragEnd]);

    const previewContent = (
      <div
        style={{
          position: 'fixed',
          left: previewPosition.x + popupDragOffset.x,
          top: previewPosition.y + popupDragOffset.y,
          width: '320px',
          maxHeight: '400px',
          zIndex: 99999,
          backgroundColor: 'white',
          border: '2px solid #3b82f6',
          borderRadius: '12px',
          boxShadow: isDraggingPopup 
            ? '0 25px 50px -12px rgba(0, 0, 0, 0.4)' 
            : '0 25px 50px -12px rgba(0, 0, 0, 0.25)',
          overflow: 'hidden',
          pointerEvents: 'auto',
          transition: isDraggingPopup ? 'none' : 'all 0.2s ease'
        }}
        onMouseEnter={() => setIsInteractingWithPreview(true)}
        onMouseLeave={() => {
          if (!previewPinned) {
            setIsInteractingWithPreview(false);
            setTimeout(() => {
              if (!isShiftPressed && !previewPinned) {
                setHoveredComponent(null);
              }
            }, 300);
          }
        }}
      >
        {/* Header */}
        <div 
          style={{
            backgroundColor: '#3b82f6',
            color: 'white',
            padding: '8px 12px',
            fontSize: '13px',
            fontWeight: '600',
            display: 'flex',
            alignItems: 'center',
            gap: '8px',
            cursor: isDraggingPopup ? 'grabbing' : 'grab'
          }}
          onMouseDown={handlePopupDragStart}
        >
          <span>{item.icon || '📄'}</span>
          <span>Preview: {item.title}</span>
          <div style={{ marginLeft: 'auto', display: 'flex', gap: '8px' }}>
            <button
              onClick={handlePinClick}
              style={{
                background: previewPinned ? 'rgba(34, 197, 94, 0.2)' : 'rgba(255,255,255,0.1)',
                border: previewPinned ? '1px solid rgba(34, 197, 94, 0.5)' : '1px solid rgba(255,255,255,0.3)',
                color: 'white',
                cursor: 'pointer',
                fontSize: '12px',
                padding: '4px 8px',
                borderRadius: '4px'
              }}
            >
              {previewPinned ? '📌 PINNED' : '📍 PIN'}
            </button>
          </div>
        </div>
        
        {/* Content */}
        <div style={{ padding: '16px', backgroundColor: '#f8fafc' }}>
          <div style={{ marginBottom: '12px' }}>
            <h3 style={{ fontSize: '16px', fontWeight: '600', color: '#1e293b', margin: '0 0 4px 0' }}>
              {item.title}
            </h3>
            <p style={{ fontSize: '14px', color: '#64748b', margin: 0 }}>
              Type: {item.type} | Constellation: {item.constellation || 'None'}
            </p>
          </div>
          
          {item.content && (
            <div style={{ 
              backgroundColor: 'white', 
              padding: '12px', 
              borderRadius: '8px',
              border: '1px solid #e2e8f0',
              fontSize: '13px',
              color: '#475569',
              maxHeight: '200px',
              overflow: 'auto'
            }}>
              {item.content}
            </div>
          )}
          
          {item.tags && item.tags.length > 0 && (
            <div style={{ marginTop: '12px', display: 'flex', flexWrap: 'wrap', gap: '6px' }}>
              {item.tags.map((tag, index) => (
                <span 
                  key={index}
                  style={{
                    backgroundColor: '#e0e7ff',
                    color: '#4338ca',
                    padding: '2px 8px',
                    borderRadius: '12px',
                    fontSize: '11px'
                  }}
                >
                  {tag}
                </span>
              ))}
            </div>
          )}
          
          <div style={{ marginTop: '12px', paddingTop: '12px', borderTop: '1px solid #e2e8f0' }}>
            <button
              onClick={() => {
                onItemSelect(item);
                setHoveredComponent(null);
                setPreviewPinned(false);
              }}
              style={{
                width: '100%',
                padding: '8px',
                backgroundColor: '#3b82f6',
                color: 'white',
                border: 'none',
                borderRadius: '6px',
                cursor: 'pointer',
                fontSize: '14px',
                fontWeight: '500'
              }}
            >
              Go to Item
            </button>
          </div>
        </div>
      </div>
    );

    return typeof document !== 'undefined' 
      ? ReactDOM.createPortal(previewContent, document.body)
      : null;
  };

  const minimapContent = (
    <div
      className={`pointer-events-auto ${className}`}
      style={{
        position: 'fixed',
        bottom: '20px',
        right: '20px',
        zIndex: 9999,
        minWidth: '220px',
        minHeight: '200px'
      }}
    >
      <div className="bg-black bg-opacity-90 rounded-lg p-2 backdrop-blur-sm border border-gray-600">
        <div className="text-white text-xs mb-2 text-center font-semibold">Constellation Map</div>
        <canvas
          ref={canvasRef}
          width={minimapWidth}
          height={minimapHeight}
          className={`border border-gray-600 rounded ${isDraggingMinimap ? 'cursor-grabbing' : 'cursor-pointer'}`}
          onMouseDown={handleMinimapMouseDown}
          onDoubleClick={handleMinimapDoubleClick}
          onMouseMove={handleMinimapMouseMoveLocal}
          onMouseLeave={() => {
            if (!isInteractingWithPreview && !previewPinned) {
              setHoveredComponent(null);
            }
          }}
          style={{
            width: minimapWidth,
            height: minimapHeight,
            display: 'block'
          }}
        />
        
        {/* Legend */}
        <div className="text-xs text-gray-400 mt-2 space-y-1">
          <div className="grid grid-cols-2 gap-1 text-xs">
            <div className="flex items-center gap-1">
              <div className="w-2 h-2 bg-purple-500 rounded-full"></div>
              <span>Centers</span>
            </div>
            <div className="flex items-center gap-1">
              <div className="w-2 h-2 bg-yellow-500 rounded-full"></div>
              <span>Folders</span>
            </div>
            <div className="flex items-center gap-1">
              <div className="w-2 h-2 bg-emerald-500 rounded-full"></div>
              <span>Documents</span>
            </div>
            <div className="flex items-center gap-1">
              <div className="w-2 h-2 bg-blue-500 rounded-full"></div>
              <span>Selected</span>
            </div>
          </div>
          
          <div className="border-t border-gray-600 pt-1 mt-2 text-center">
            <div className="text-xs text-gray-500">
              Double-click: Navigate • Shift+hover: Preview
            </div>
          </div>
        </div>
      </div>
      
      {/* Component Preview */}
      {hoveredComponent && (isShiftPressed || isInteractingWithPreview || previewPinned) && (
        <ComponentPreview item={hoveredComponent} />
      )}
    </div>
  );

  // Render minimap using portal to escape overflow-hidden parent
  if (typeof document === 'undefined') {
    return null;
  }

  return ReactDOM.createPortal(minimapContent, document.body);
};

export default ConstellationMinimap;
