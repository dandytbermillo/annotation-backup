'use client';

import React, { useRef, useEffect, useCallback } from 'react';
import { ConstellationItem } from '@/types/constellation';
import { getItemIcon, getItemColor, getItemSize, transformPoint, getNodePosition } from '@/lib/constellation/constellation-utils';
import { Z_INDEX } from '@/lib/constants/z-index';

interface ConstellationVisualizationProps {
  allItems: ConstellationItem[];
  connections: Array<[string, string]>;
  state: any;
  onMouseDown: (e: React.MouseEvent, svgElement: SVGElement | null) => void;
  onMouseMove: (e: React.MouseEvent) => void;
  onMouseUp: () => void;
  onWheel: (e: React.WheelEvent) => void;
  onItemClick: (item: ConstellationItem, event?: React.MouseEvent) => void;
  onItemHover: (item: ConstellationItem | null) => void;
  // New depth-related props
  getItemDepthLayer: (item: ConstellationItem) => number;
  getDepthScale: (depthLayer: number, isCenter?: boolean) => number;
  getDepthOpacity: (depthLayer: number, isCenter?: boolean) => number;
  getDepthBlur: (depthLayer: number) => string;
  getDepthZ: (depthLayer: number) => number;
  // Constellation focus props
  getConstellationDepthZ: (item: ConstellationItem, depthLayer: number) => number;
  // Group selection functions
  onClearGroupSelection?: () => void;
  // Panel close functions
  onCloseDebugPanel?: () => void;
}

export default function ConstellationVisualization({
  allItems,
  connections,
  state,
  onMouseDown,
  onMouseMove,
  onMouseUp,
  onWheel,
  onItemClick,
  onItemHover,
  getItemDepthLayer,
  getDepthScale,
  getDepthOpacity,
  getDepthBlur,
  getDepthZ,
  getConstellationDepthZ,
  onClearGroupSelection,
  onCloseDebugPanel,
}: ConstellationVisualizationProps) {
  const svgRef = useRef<SVGSVGElement>(null);
  const nodeElementsRef = useRef<Map<string, SVGElement>>(new Map());
  const labelElementsRef = useRef<Map<string, SVGElement>>(new Map());
  const connectionElementsRef = useRef<SVGGElement | null>(null);
  const contentCacheRef = useRef<Map<string, string>>(new Map()); // Cache for fetched file contents
  const activeTooltipRef = useRef<{ element: SVGElement; itemId: string } | null>(null); // Track active tooltip

  // Helper function to hide the currently active tooltip
  const hideActiveTooltip = useCallback(() => {
    if (activeTooltipRef.current) {
      activeTooltipRef.current.element.style.opacity = '0';
      activeTooltipRef.current = null;
    }
  }, []);

  // Enhanced opacity calculation that considers depth layers
  const getItemOpacity = useCallback((item: ConstellationItem): number => {
    let baseOpacity = 1;
    
    // Apply constellation filter dimming
    if (state.highlightedConstellation && state.highlightedConstellation !== 'all') {
      baseOpacity = item.constellation === state.highlightedConstellation ? 1 : 0.25;
    }
    
    // Apply type filter dimming
    if (state.filterType !== 'all') {
      if (item.type !== state.filterType) {
        baseOpacity = Math.min(baseOpacity, 0.2);
      }
    }
    
    // Apply search filter dimming
    if (state.searchQuery) {
      const matchesSearch = item.title.toLowerCase().includes(state.searchQuery.toLowerCase()) ||
                          (item.tags && item.tags.some((tag: string) => tag.toLowerCase().includes(state.searchQuery.toLowerCase())));
      
      if (!matchesSearch) {
        baseOpacity = Math.min(baseOpacity, 0.15);
      }
    }
    
    // Apply depth layer opacity
    const depthLayer = getItemDepthLayer(item);
    const depthOpacity = getDepthOpacity(depthLayer, item.isCenter);

    return baseOpacity * depthOpacity;
  }, [state.highlightedConstellation, state.filterType, state.searchQuery, getItemDepthLayer, getDepthOpacity]);

  // Enhanced connection opacity that considers depth layers
  const getConnectionOpacity = useCallback((avgDepthLayer: number): number => {
    // Base opacity based on average depth layer
    switch (Math.round(avgDepthLayer)) {
      case 0: return 0.6; // Foreground connections - more visible
      case 1: return 0.4; // Middle connections - medium visible
      case 2: return 0.2; // Background connections - less visible
      case 3: return 0.1; // Hidden connections - barely visible
      default: return 0.05; // Far background - very faint
    }
  }, []);

  // Check if connection should be highlighted
  const isConnectionHighlighted = useCallback((connection: [string, string]): boolean => {
    if (!state.hoveredItem && !state.selectedItem) return false;
    const highlightId = state.hoveredItem?.id || state.selectedItem?.id;
    return connection.includes(highlightId);
  }, [state.hoveredItem, state.selectedItem]);

  // Enhanced connection analysis functions
  const getConnectionType = useCallback((item1: any, item2: any): 'intra-constellation' | 'cross-constellation' | 'parent-child' | 'semantic' => {
    // Parent-child relationships (highest priority)
    if (item1.parentId === item2.id || item2.parentId === item1.id) {
      return 'parent-child';
    }
    
    // Same constellation connections
    if (item1.constellation === item2.constellation) {
      return 'intra-constellation';
    }
    
    // Cross-constellation connections
    if (item1.constellation !== item2.constellation) {
      return 'cross-constellation';
    }
    
    // Default to semantic
    return 'semantic';
  }, []);

  const getConnectionImportance = useCallback((item1: any, item2: any): number => {
    // Calculate connection importance (1-5) based on various factors
    let importance = 1;
    
    // Higher importance for center nodes
    if (item1.isCenter || item2.isCenter) importance += 2;
    
    // Higher importance for high-importance items
    const avgImportance = ((item1.importance || 3) + (item2.importance || 3)) / 2;
    importance += Math.floor(avgImportance / 2);
    
    // Higher importance for parent-child relationships
    if (item1.parentId === item2.id || item2.parentId === item1.id) importance += 1;
    
    // Higher importance for selected/hovered items
    if (state.selectedItem === item1 || state.selectedItem === item2 || 
        state.hoveredItem === item1 || state.hoveredItem === item2) {
      importance += 2;
    }
    
    return Math.min(5, importance);
  }, [state.selectedItem, state.hoveredItem]);

  const getConnectionColor = useCallback((item1: any, item2: any, connectionType: string): string => {
    const isHighlighted = isConnectionHighlighted([item1.id, item2.id]);

    if (isHighlighted) return '#fbbf24'; // Gold for highlighted

    // Check if either endpoint is the Knowledge Base center node
    const isKnowledgeBaseConnection =
      (item1.isCenter && (item1.title === 'Knowledge Base' || item1.depthLayer === 0)) ||
      (item2.isCenter && (item2.title === 'Knowledge Base' || item2.depthLayer === 0)) ||
      item1.id === 'virtual-knowledge-base-root_center' ||
      item2.id === 'virtual-knowledge-base-root_center';

    if (isKnowledgeBaseConnection) {
      return '#718096'; // Soft gray for Knowledge Base connections
    }

    switch (connectionType) {
      case 'parent-child':
        // Use parent's color with lighter shade
        const parentItem = item1.parentId === item2.id ? item2 : item1;
        return parentItem.color || '#64b5f6';
        
      case 'intra-constellation':
        // Use constellation's own color
        return item1.color || '#64b5f6';
        
      case 'cross-constellation':
        // Create gradient effect or use neutral color
        return '#9ca3af'; // Gray for cross-constellation
        
             case 'semantic':
         // Enhanced semantic color detection based on actual connection patterns
         const semanticColors: Record<string, string> = {
           'financial': '#10b981',    // Green for financial connections
           'project': '#f59e0b',      // Orange for project dependencies  
           'document': '#8b5cf6',     // Purple for document relationships
           'media': '#ef4444',        // Red for media connections
           'learning': '#a855f7',     // Violet for learning connections
           'communication': '#06b6d4', // Cyan for communication links
         };
         
         // Specific connection pattern detection
         const connectionKey = `${item1.id}-${item2.id}`;
         const reverseKey = `${item2.id}-${item1.id}`;
         
         // Map specific connections to semantic types
         const specificConnections: Record<string, string> = {
           'w1-f1': 'financial',     // Business report → Bank statements
           'w3-l1': 'learning',      // Project proposal → Course materials  
           'p3-f2': 'financial',     // Vacation planning → Investment portfolio
           'l3-w4': 'project',       // Research papers → Client presentation
           'c1-w2': 'communication', // Important emails → Team meeting notes
           'project_folder-w3': 'project',
           'documents_folder-p4': 'document',
           'photos_folder-p1': 'media',
           'finance_folder-f1': 'financial',
           'philosophy_folder-l1': 'learning'
         };
         
         // Check for specific connection patterns first
         if (specificConnections[connectionKey]) {
           return semanticColors[specificConnections[connectionKey]];
         }
         if (specificConnections[reverseKey]) {
           return semanticColors[specificConnections[reverseKey]];
         }
         
         // Fallback to general type-based detection
         if (item1.constellation === 'finance' || item2.constellation === 'finance') return semanticColors.financial;
         if (item1.constellation === 'learning' || item2.constellation === 'learning') return semanticColors.learning;
         if (item1.constellation === 'communication' || item2.constellation === 'communication') return semanticColors.communication;
         if (item1.constellation === 'work' || item2.constellation === 'work') return semanticColors.project;
         if (item1.type === 'document' || item2.type === 'document') return semanticColors.document;
         if (item1.type === 'media' || item2.type === 'media') return semanticColors.media;
         
         return '#64b5f6'; // Default blue
        
      default:
        return '#64b5f6';
    }
  }, [isConnectionHighlighted]);

  const createGradientConnection = useCallback((svg: SVGSVGElement, id1: string, id2: string, color1: string, color2: string): string => {
    const gradientId = `gradient-${id1}-${id2}`;
    
    // Check if gradient already exists
    if (!svg.querySelector(`#${gradientId}`)) {
      const defs = svg.querySelector('defs') || svg.appendChild(document.createElementNS('http://www.w3.org/2000/svg', 'defs'));
      
      const gradient = document.createElementNS('http://www.w3.org/2000/svg', 'linearGradient');
      gradient.setAttribute('id', gradientId);
      gradient.setAttribute('x1', '0%');
      gradient.setAttribute('y1', '0%');
      gradient.setAttribute('x2', '100%');
      gradient.setAttribute('y2', '0%');
      
      const stop1 = document.createElementNS('http://www.w3.org/2000/svg', 'stop');
      stop1.setAttribute('offset', '0%');
      stop1.setAttribute('stop-color', color1);
      
      const stop2 = document.createElementNS('http://www.w3.org/2000/svg', 'stop');
      stop2.setAttribute('offset', '100%');
      stop2.setAttribute('stop-color', color2);
      
      gradient.appendChild(stop1);
      gradient.appendChild(stop2);
      defs.appendChild(gradient);
    }
    
    return `url(#${gradientId})`;
  }, []);

  // Smart connection filtering functions
  const shouldShowConnection = useCallback((item1: any, item2: any, pos1: any, pos2: any, importance: number, connectionType: string): boolean => {
    // Distance-based filtering - use world coordinates, not screen coordinates
    const worldPos1 = getNodePosition(item1, state.nodePositions, allItems);
    const worldPos2 = getNodePosition(item2, state.nodePositions, allItems);
    const worldDistance = Math.sqrt(Math.pow(worldPos1.x - worldPos2.x, 2) + Math.pow(worldPos1.y - worldPos2.y, 2));
    const maxDistance = 800 * (state.zoom || 1); // Scale with zoom
    if (worldDistance > maxDistance) return false;

    // Zoom-level adaptation
    const zoomThreshold = state.zoom || 1;
    if (zoomThreshold < 0.5 && importance < 3) return false; // Hide low-importance when zoomed out
    if (zoomThreshold < 0.3 && importance < 4) return false; // Hide medium-importance when very zoomed out

    // Focus mode - only show connections related to selected/hovered nodes
    if (state.connectionFocusMode) {
      const focusedId = state.selectedItem?.id || state.hoveredItem?.id;
      if (focusedId) {
        // Show connection only if one of the items matches the focused item
        if (item1.id !== focusedId && item2.id !== focusedId) {
          return false;
        }
      } else {
        // If focus mode is enabled but no item is selected/hovered, hide all connections
        return false;
      }
    }

    // Connection type filtering
    if (state.hiddenConnectionTypes && state.hiddenConnectionTypes.has(connectionType)) {
      return false;
    }

    // Connection strength filtering
    if (state.minConnectionStrength && importance < state.minConnectionStrength) {
      return false;
    }

    // Depth-based filtering - hide connections between very distant depth layers
    const depthLayer1 = getItemDepthLayer(item1);
    const depthLayer2 = getItemDepthLayer(item2);
    const depthDifference = Math.abs(depthLayer1 - depthLayer2);
    if (depthDifference > 2) return false; // Don't show connections across more than 2 depth layers

    return true;
  }, [state, getItemDepthLayer]);

  // Connection bundling for nearby connections
  const bundleConnections = useCallback((connectionData: Array<{item1: any, item2: any, pos1: any, pos2: any, importance: number, connectionType: string}>) => {
    const bundled: Array<{connections: Array<any>, centerPos1: any, centerPos2: any, totalImportance: number}> = [];
    const processed = new Set<string>();

    connectionData.forEach((conn, index) => {
      if (processed.has(`${conn.item1.id}-${conn.item2.id}`)) return;

      // Find nearby connections to bundle
      const nearby = connectionData.filter((other, otherIndex) => {
        if (otherIndex === index || processed.has(`${other.item1.id}-${other.item2.id}`)) return false;
        
        const dist1 = Math.sqrt(Math.pow(conn.pos1.x - other.pos1.x, 2) + Math.pow(conn.pos1.y - other.pos1.y, 2));
        const dist2 = Math.sqrt(Math.pow(conn.pos2.x - other.pos2.x, 2) + Math.pow(conn.pos2.y - other.pos2.y, 2));
        
        return dist1 < 50 && dist2 < 50; // Bundle if endpoints are within 50px
      });

      if (nearby.length > 0) {
        // Create bundle
        const allConnections = [conn, ...nearby];
        const centerPos1 = {
          x: allConnections.reduce((sum, c) => sum + c.pos1.x, 0) / allConnections.length,
          y: allConnections.reduce((sum, c) => sum + c.pos1.y, 0) / allConnections.length
        };
        const centerPos2 = {
          x: allConnections.reduce((sum, c) => sum + c.pos2.x, 0) / allConnections.length,
          y: allConnections.reduce((sum, c) => sum + c.pos2.y, 0) / allConnections.length
        };
        
        bundled.push({
          connections: allConnections,
          centerPos1,
          centerPos2,
          totalImportance: allConnections.reduce((sum, c) => sum + c.importance, 0)
        });

        // Mark as processed
        allConnections.forEach(c => processed.add(`${c.item1.id}-${c.item2.id}`));
      } else {
        // Single connection
        bundled.push({
          connections: [conn],
          centerPos1: conn.pos1,
          centerPos2: conn.pos2,
          totalImportance: conn.importance
        });
        processed.add(`${conn.item1.id}-${conn.item2.id}`);
      }
    });

    return bundled;
  }, []);

  // Enhanced connections rendering with smart filtering and bundling
  const renderConnections = useCallback((svg: SVGSVGElement) => {
    const connectionsGroup = connectionElementsRef.current;
    if (!connectionsGroup) return;

    // Clear existing connections
    connectionsGroup.innerHTML = '';

    // Log connection rendering for debugging when needed
    if (state.showDebugPanel) {
      console.log('🔗 Rendering connections:', {
        totalConnections: connections.length,
        focusMode: state.connectionFocusMode,
        selectedItem: state.selectedItem?.id,
        hoveredItem: state.hoveredItem?.id,
        zoom: state.zoom,
        nodePositionsCount: Object.keys(state.nodePositions).length
      });
    }

    // First pass: collect all connection data
    const connectionData: Array<{
      item1: any,
      item2: any,
      pos1: any,
      pos2: any,
      importance: number,
      connectionType: string,
      item1Constellation: string | null,
      item2Constellation: string | null
    }> = [];

    connections.forEach(([id1, id2]) => {
      const item1 = allItems.find(item => item.id === id1);
      const item2 = allItems.find(item => item.id === id2);
      
      if (!item1 || !item2) return;

      const pos1Data = getNodePosition(item1, state.nodePositions, allItems);
      const pos2Data = getNodePosition(item2, state.nodePositions, allItems);
      
      // Get depth layers and Z positions for both items
      const depthLayer1 = getItemDepthLayer(item1);
      const depthLayer2 = getItemDepthLayer(item2);
      const zPosition1 = getConstellationDepthZ(item1, depthLayer1);
      const zPosition2 = getConstellationDepthZ(item2, depthLayer2);
      
      const pos1 = transformPoint(pos1Data.x, pos1Data.y, zPosition1, state);
      const pos2 = transformPoint(pos2Data.x, pos2Data.y, zPosition2, state);
      
      // Analyze connection properties
      const connectionType = getConnectionType(item1, item2);
      const importance = getConnectionImportance(item1, item2);
      
      // Smart filtering - skip connections that shouldn't be shown
      const shouldShow = shouldShowConnection(item1, item2, pos1, pos2, importance, connectionType);

      // Store constellation info for later use in rendering
      const item1Constellation = item1.constellation || (item1.isCenter ? item1.id.replace('_center', '') : null);
      const item2Constellation = item2.constellation || (item2.isCenter ? item2.id.replace('_center', '') : null);

      // Log connection filtering details for cross-constellation connections when debugging
      if (state.showDebugPanel && (id1.includes('w1') || id2.includes('w1') || id1.includes('f1') || id2.includes('f1'))) {
        const worldPos1 = getNodePosition(item1, state.nodePositions, allItems);
        const worldPos2 = getNodePosition(item2, state.nodePositions, allItems);
        const worldDistance = Math.sqrt(Math.pow(worldPos1.x - worldPos2.x, 2) + Math.pow(worldPos1.y - worldPos2.y, 2));
        const screenDistance = Math.sqrt(Math.pow(pos2.x - pos1.x, 2) + Math.pow(pos2.y - pos1.y, 2));
        
        console.log(`🔗 Connection ${id1}-${id2}:`, {
          item1Title: item1?.title,
          item2Title: item2?.title,
          worldPos1, worldPos2,
          screenPos1: pos1, screenPos2: pos2,
          importance,
          connectionType,
          shouldShow,
          worldDistance,
          screenDistance,
          maxDistance: 800 * state.zoom,
          focusMode: state.connectionFocusMode,
          focusedId: state.selectedItem?.id || state.hoveredItem?.id,
          item1HasCustomPos: !!state.nodePositions[id1],
          item2HasCustomPos: !!state.nodePositions[id2]
        });
      }
      
      if (!shouldShow) {
        return;
      }

      connectionData.push({
        item1,
        item2,
        pos1,
        pos2,
        importance,
        connectionType,
        item1Constellation,
        item2Constellation
      });
    });

    // Apply connection bundling if enabled
    const bundledConnections = state.enableConnectionBundling ? 
      bundleConnections(connectionData) : 
      connectionData.map(conn => ({
        connections: [conn],
        centerPos1: conn.pos1,
        centerPos2: conn.pos2,
        totalImportance: conn.importance
      }));

    // Second pass: render the filtered and bundled connections
    bundledConnections.forEach(bundle => {
      const { connections: bundleConnections, centerPos1, centerPos2, totalImportance } = bundle;
      const isBundled = bundleConnections.length > 1;
      
      if (isBundled) {
        // Render bundled connection as a thicker line
        const bundleLine = document.createElementNS('http://www.w3.org/2000/svg', 'line');
        bundleLine.setAttribute('x1', centerPos1.x.toString());
        bundleLine.setAttribute('y1', centerPos1.y.toString());
        bundleLine.setAttribute('x2', centerPos2.x.toString());
        bundleLine.setAttribute('y2', centerPos2.y.toString());
        bundleLine.setAttribute('stroke', '#64b5f6');
        bundleLine.setAttribute('stroke-width', Math.min(8, Math.max(3, totalImportance * 0.5)).toString());
        bundleLine.setAttribute('opacity', '0.6');
        bundleLine.setAttribute('stroke-linecap', 'round');
        bundleLine.classList.add('connection-bundle');

        // Add Knowledge Base connection class if applicable
        const conn = bundleConnections[0];
        const isKnowledgeBaseBundleConnection =
          (conn.item1.isCenter && (conn.item1.title === 'Knowledge Base' || conn.item1.depthLayer === 0)) ||
          (conn.item2.isCenter && (conn.item2.title === 'Knowledge Base' || conn.item2.depthLayer === 0)) ||
          conn.item1.id === 'virtual-knowledge-base-root_center' ||
          conn.item2.id === 'virtual-knowledge-base-root_center';

        if (isKnowledgeBaseBundleConnection) {
          bundleLine.classList.add('connection-knowledge-base');
        }

        // Disable transitions for bundled connections not in focused constellation
        if (state.focusedConstellation) {
          const item1Constellation = conn.item1Constellation;
          const item2Constellation = conn.item2Constellation;
          const belongsToFocused = item1Constellation === state.focusedConstellation ||
                                   item2Constellation === state.focusedConstellation;
          if (!belongsToFocused) {
            bundleLine.classList.add('connection-no-transition');
            bundleLine.style.animation = 'none';
          }
        }

        // Add bundle indicator
        bundleLine.setAttribute('data-bundle-count', bundleConnections.length.toString());
        bundleLine.style.filter = 'drop-shadow(0 0 4px rgba(100, 181, 246, 0.5))';
        
        // Add hover event for bundle
        bundleLine.addEventListener('mouseenter', () => {
          bundleLine.setAttribute('stroke-width', (Math.min(8, Math.max(3, totalImportance * 0.5)) + 2).toString());
          bundleLine.setAttribute('opacity', '0.9');
        });
        
        bundleLine.addEventListener('mouseleave', () => {
          bundleLine.setAttribute('stroke-width', Math.min(8, Math.max(3, totalImportance * 0.5)).toString());
          bundleLine.setAttribute('opacity', '0.6');
        });
        
        connectionsGroup.appendChild(bundleLine);
      } else {
        // Render individual connection
        const conn = bundleConnections[0];
        const { item1, item2, pos1, pos2, importance, connectionType, item1Constellation, item2Constellation } = conn;
        const isHighlighted = isConnectionHighlighted([item1.id, item2.id]);
        const belongsToFocusedConstellation = !state.focusedConstellation ||
          item1Constellation === state.focusedConstellation ||
          item2Constellation === state.focusedConstellation;

        // Calculate visual properties
        const depthLayer1 = getItemDepthLayer(item1);
        const depthLayer2 = getItemDepthLayer(item2);
        const avgDepthLayer = (depthLayer1 + depthLayer2) / 2;
        let connectionOpacity = getConnectionOpacity(avgDepthLayer);
        
        // Enhance opacity based on importance and type
        const importanceMultiplier = 0.3 + (importance * 0.2); // 0.5 to 1.3
        connectionOpacity = Math.min(1, connectionOpacity * importanceMultiplier);
        
        // Determine stroke width based on importance
        const strokeWidth = isHighlighted ? importance + 1 : Math.max(1, importance * 0.8);
        
        // Get connection color
        let strokeColor = getConnectionColor(item1, item2, connectionType);
        
        // Create line element
        const line = document.createElementNS('http://www.w3.org/2000/svg', 'line');
        line.setAttribute('x1', pos1.x.toString());
        line.setAttribute('y1', pos1.y.toString());
        line.setAttribute('x2', pos2.x.toString());
        line.setAttribute('y2', pos2.y.toString());
        line.setAttribute('stroke-width', strokeWidth.toString());
        line.setAttribute('opacity', connectionOpacity.toString());
        line.classList.add('connection-line', `connection-${connectionType}`);

        // Add Knowledge Base connection class if applicable
        const isKnowledgeBaseConnection =
          (item1.isCenter && (item1.title === 'Knowledge Base' || item1.depthLayer === 0)) ||
          (item2.isCenter && (item2.title === 'Knowledge Base' || item2.depthLayer === 0)) ||
          item1.id === 'virtual-knowledge-base-root_center' ||
          item2.id === 'virtual-knowledge-base-root_center';

        if (isKnowledgeBaseConnection) {
          line.classList.add('connection-knowledge-base');
        }

        if (!belongsToFocusedConstellation) {
          line.classList.add('connection-no-transition');
          line.style.animation = 'none';
        }

        // Store connection metadata for hover interactions
        line.setAttribute('data-connection-id1', item1.id);
        line.setAttribute('data-connection-id2', item2.id);
        line.setAttribute('data-connection-type', connectionType);
        line.setAttribute('data-connection-importance', importance.toString());
        
        // Apply connection-specific styling
        switch (connectionType) {
          case 'parent-child':
            line.setAttribute('stroke', strokeColor);
            line.setAttribute('stroke-dasharray', '0'); // Solid line
            break;
            
          case 'intra-constellation':
            line.setAttribute('stroke', strokeColor);
            line.setAttribute('stroke-dasharray', isHighlighted ? '0' : '3,2'); // Subtle dash
            break;
            
          case 'cross-constellation':
            // Create gradient for cross-constellation connections
            if (item1.color && item2.color && item1.color !== item2.color) {
              strokeColor = createGradientConnection(svg, item1.id, item2.id, item1.color, item2.color);
            }
            line.setAttribute('stroke', strokeColor);
            line.setAttribute('stroke-dasharray', isHighlighted ? '0' : '5,3'); // Dashed
            break;
            
          case 'semantic':
            line.setAttribute('stroke', strokeColor);
            line.setAttribute('stroke-dasharray', isHighlighted ? '0' : '2,4'); // Dotted
            break;
        }
        
        // Add animation for high-importance or highlighted connections
        if ((importance >= 4 || isHighlighted) && belongsToFocusedConstellation) {
          line.style.animation = 'connectionPulse 3s ease-in-out infinite';
        } else {
          line.style.animation = 'none';
        }
        
        // Apply depth blur
        const avgDepthBlur = getDepthBlur(Math.round(avgDepthLayer));
        if (avgDepthBlur !== 'none') {
          line.style.filter = avgDepthBlur;
        }

        // Add hover event listeners for connection metadata
        line.addEventListener('mouseenter', (e) => {
          const target = e.target as SVGLineElement;
          target.style.strokeWidth = (parseFloat(target.getAttribute('stroke-width') || '1') + 2).toString();
          target.style.opacity = '1';
          target.style.filter = `${avgDepthBlur !== 'none' ? avgDepthBlur + ' ' : ''}drop-shadow(0 0 6px currentColor)`;
          
          // Show connection tooltip
          if (state.onConnectionHover) {
            state.onConnectionHover({
              item1: item1.title,
              item2: item2.title,
              type: connectionType,
              importance,
              x: (pos1.x + pos2.x) / 2,
              y: (pos1.y + pos2.y) / 2
            });
          }
        });
        
        line.addEventListener('mouseleave', (e) => {
          const target = e.target as SVGLineElement;
          target.style.strokeWidth = strokeWidth.toString();
          target.style.opacity = connectionOpacity.toString();
          target.style.filter = avgDepthBlur !== 'none' ? avgDepthBlur : 'none';
          
          if (state.onConnectionHover) {
            state.onConnectionHover(null);
          }
        });

        connectionsGroup.appendChild(line);
      }
    });
  }, [connections, allItems, state, shouldShowConnection, bundleConnections, getConnectionType, getConnectionImportance, getConnectionColor, createGradientConnection, isConnectionHighlighted, getConnectionOpacity, getItemDepthLayer, getDepthBlur]);

  // Enhanced nodes rendering with proper event handler lifecycle
  const renderNodes = useCallback((svg: SVGSVGElement) => {
    // Sort items by depth for proper rendering order
    const sortedItems = allItems.map(item => ({
        item,
      pos: transformPoint(
        getNodePosition(item, state.nodePositions, allItems).x,
        getNodePosition(item, state.nodePositions, allItems).y,
        getConstellationDepthZ(item, getItemDepthLayer(item)),
        state
      ),
      depthLayer: getItemDepthLayer(item)
    })).sort((a, b) => b.pos.depth - a.pos.depth);

    sortedItems.forEach(({ item, pos, depthLayer }) => {
      const depthScale = getDepthScale(depthLayer, item.isCenter);
      const baseSize = getItemSize(item);
      const size = baseSize * depthScale;
      const opacity = getItemOpacity(item);
      const color = getItemColor(item);
      const depthBlur = getDepthBlur(depthLayer);

      const isHovered = state.hoveredItem === item;
      const isSelected = state.selectedItem === item;
      const isDragged = state.draggedNode === item.id;
      const isFocused = state.focusedItems.has(item.id);
      const isExpanded = state.expandedConstellations.has(item.id) || 
                        (item.isCenter && item.constellation && state.expandedConstellations.has(item.constellation));
      
      // Group selection indicators
      const isGroupSelected = state.selectedGroupItems.has(item.id);
      const isGroupParent = state.groupParentId === item.id;
      
      // Constellation focus indicators
      const itemConstellation = item.constellation || (item.isCenter ? item.id.replace('_center', '') : null);
      
      // Get or create node group
      let nodeGroup = nodeElementsRef.current.get(item.id) as SVGGElement;
      
      if (!nodeGroup) {
        nodeGroup = document.createElementNS('http://www.w3.org/2000/svg', 'g');
        nodeGroup.classList.add('node-group');
        svg.appendChild(nodeGroup);
        nodeElementsRef.current.set(item.id, nodeGroup);
      }
      
      // CRITICAL: Update data attributes on every render for event delegation
      nodeGroup.setAttribute('data-id', item.id);
      nodeGroup.setAttribute('data-type', item.type || '');
      nodeGroup.setAttribute('data-is-folder', (item.type === 'folder' || item.isFolder) ? 'true' : 'false');
      nodeGroup.setAttribute('data-title', item.title);
      
      // Ensure proper pointer events configuration
      nodeGroup.style.pointerEvents = 'all';
      
      // Clear existing content
      nodeGroup.innerHTML = '';
      
      // Position the group
      nodeGroup.setAttribute('transform', `translate(${pos.x}, ${pos.y})`);
      
      // Make sure the node is visible
      nodeGroup.style.display = 'block';

      // Apply depth transitions with CSS - only animate nodes in the focused constellation
      // When a constellation is focused, only animate nodes that belong to that constellation
      const shouldAnimate = state.depthAnimationActive &&
        (state.focusedConstellation === null || state.focusedConstellation === itemConstellation);
      nodeGroup.style.transition = shouldAnimate ? 'all 0.6s cubic-bezier(0.4, 0, 0.2, 1)' : 'none';
      
      // Apply depth blur effect
      if (depthLayer > 0 && depthBlur !== 'none') {
        nodeGroup.style.filter = depthBlur;
      } else {
        nodeGroup.style.filter = 'none';
      }
      
      // Create expansion ring for expanded constellation centers
      if (isExpanded) {
        const expansionRing = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
        expansionRing.setAttribute('r', (size + 20).toString());
        expansionRing.setAttribute('fill', 'none');
        expansionRing.setAttribute('stroke', color);
        expansionRing.setAttribute('stroke-width', '1');
        expansionRing.setAttribute('opacity', '0.3');
        expansionRing.setAttribute('stroke-dasharray', '3,3');
        expansionRing.style.animation = 'pulse 2s ease-in-out infinite';
        nodeGroup.appendChild(expansionRing);
      }
      
      // Create focus ring for focused items
      if (isFocused) {
        const focusRing = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
        focusRing.setAttribute('r', (size + 15).toString());
        focusRing.setAttribute('fill', 'none');
        focusRing.setAttribute('stroke', '#fbbf24');
        focusRing.setAttribute('stroke-width', '2');
        focusRing.setAttribute('opacity', '0.8');
        focusRing.style.animation = 'glow 1.5s ease-in-out infinite alternate';
        nodeGroup.appendChild(focusRing);
      }

      // Create constellation focus ring with progressive levels
      if (itemConstellation && state.constellationFocusLevels && state.constellationFocusLevels[itemConstellation]) {
        const focusLevel = state.constellationFocusLevels[itemConstellation];
        
        // Create multiple rings for higher focus levels
        for (let i = 1; i <= focusLevel; i++) {
          const constellationRing = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
          constellationRing.setAttribute('r', (size + 20 + (i * 8)).toString());
          constellationRing.setAttribute('fill', 'none');
          constellationRing.setAttribute('stroke', '#60a5fa');
          constellationRing.setAttribute('stroke-width', (3 - i * 0.5).toString());
          constellationRing.setAttribute('opacity', (0.7 - i * 0.1).toString());
          constellationRing.setAttribute('stroke-dasharray', '5,5');
          constellationRing.style.animation = `spin ${10 + i * 5}s linear infinite`;
          nodeGroup.appendChild(constellationRing);
        }
        
        // Add level indicator for focused constellations
        if (focusLevel > 1) {
          const levelIndicator = document.createElementNS('http://www.w3.org/2000/svg', 'text');
          levelIndicator.setAttribute('x', (size + 25).toString());
          levelIndicator.setAttribute('y', (-size - 15).toString());
          levelIndicator.setAttribute('text-anchor', 'middle');
          levelIndicator.setAttribute('dominant-baseline', 'central');
          levelIndicator.setAttribute('fill', '#60a5fa');
          levelIndicator.setAttribute('font-size', '10');
          levelIndicator.setAttribute('font-weight', 'bold');
          levelIndicator.textContent = `F${focusLevel}`;
          levelIndicator.style.pointerEvents = 'none';
          nodeGroup.appendChild(levelIndicator);
        }
      }

      // Create group selection indicators
      if (isGroupSelected) {
        // Golden ring for group parent (folder)
        if (isGroupParent) {
          const groupParentRing = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
          groupParentRing.setAttribute('r', (size + 18).toString());
          groupParentRing.setAttribute('fill', 'none');
          groupParentRing.setAttribute('stroke', '#fbbf24');
          groupParentRing.setAttribute('stroke-width', '4');
          groupParentRing.setAttribute('opacity', '0.9');
          groupParentRing.setAttribute('stroke-dasharray', '8,4');
          groupParentRing.style.animation = 'spin 3s linear infinite';
          nodeGroup.appendChild(groupParentRing);
          
          // Add group indicator badge
          const groupBadge = document.createElementNS('http://www.w3.org/2000/svg', 'text');
          groupBadge.setAttribute('x', (size + 30).toString());
          groupBadge.setAttribute('y', (-size - 20).toString());
          groupBadge.setAttribute('text-anchor', 'middle');
          groupBadge.setAttribute('dominant-baseline', 'central');
          groupBadge.setAttribute('fill', '#fbbf24');
          groupBadge.setAttribute('font-size', '12');
          groupBadge.setAttribute('font-weight', 'bold');
          groupBadge.textContent = `📁${state.selectedGroupItems.size}`;
          groupBadge.style.pointerEvents = 'none';
          nodeGroup.appendChild(groupBadge);
        } else {
          // Orange ring for group children
          const groupChildRing = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
          groupChildRing.setAttribute('r', (size + 12).toString());
          groupChildRing.setAttribute('fill', 'none');
          groupChildRing.setAttribute('stroke', '#f97316');
          groupChildRing.setAttribute('stroke-width', '2');
          groupChildRing.setAttribute('opacity', '0.7');
          groupChildRing.setAttribute('stroke-dasharray', '4,2');
          groupChildRing.style.animation = 'pulse 2s ease-in-out infinite';
          nodeGroup.appendChild(groupChildRing);
        }
      }
      
      // Create glow circle (background)
      if (isHovered || isSelected || isDragged) {
        const glowCircle = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
        glowCircle.setAttribute('r', (size + 8).toString());
        glowCircle.setAttribute('fill', color);
        glowCircle.setAttribute('opacity', '0.3');
        glowCircle.setAttribute('filter', 'url(#blur)');
        nodeGroup.appendChild(glowCircle);
      }
      
      // Create drag ring (for dragged items)
      if (isDragged) {
        const dragRing = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
        dragRing.setAttribute('r', (size + 12).toString());
        dragRing.setAttribute('fill', 'none');
        dragRing.setAttribute('stroke', '#ff6b35');
        dragRing.setAttribute('stroke-width', '2');
        dragRing.setAttribute('opacity', '0.8');
        dragRing.setAttribute('stroke-dasharray', '5,5');
        dragRing.style.animation = 'spin 2s linear infinite';
        nodeGroup.appendChild(dragRing);
      }
      
      // Create main circle
      const circle = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
      circle.setAttribute('r', size.toString());
      circle.setAttribute('fill', 'url(#nodeGradient)');
      circle.setAttribute('stroke', color);
      circle.setAttribute('stroke-width', isSelected ? '3' : '2');
      circle.setAttribute('opacity', opacity.toString());
      
      // Keep pointer events on circle so it's clickable
      circle.style.pointerEvents = 'all';
      
      // Apply special effects
      if (isHovered && depthLayer === 0) {
        circle.setAttribute('filter', 'url(#glow)');
        circle.style.animation = 'pulse 1.5s ease-in-out infinite';
      }
      
      // Special styling for folders to make them more clickable
      if (item.type === 'folder' || item.isFolder) {
        circle.style.cursor = 'pointer';
        circle.setAttribute('stroke-width', isExpanded ? '4' : '3');
        circle.setAttribute('stroke', isExpanded ? '#10b981' : '#fbbf24'); // Green when expanded, gold when collapsed
        
        // Add subtle animation for expanded folders
        if (isExpanded) {
          circle.style.animation = 'pulse 2s ease-in-out infinite';
        }
        
        // Add expansion indicator (+ or -)
        const indicator = document.createElementNS('http://www.w3.org/2000/svg', 'text');
        indicator.setAttribute('x', (size * 0.5).toString());
        indicator.setAttribute('y', (-size * 0.5).toString());
        indicator.setAttribute('text-anchor', 'middle');
        indicator.setAttribute('dominant-baseline', 'central');
        indicator.setAttribute('fill', '#ffffff');
        indicator.setAttribute('font-size', '12');
        indicator.setAttribute('font-weight', 'bold');
        indicator.textContent = isExpanded ? '−' : '+';
        indicator.style.pointerEvents = 'none'; // Text shouldn't block clicks
        nodeGroup.appendChild(indicator);
      }
      
      // Add Shift indicator for constellation centers
      if (item.isCenter && state.isShiftPressed) {
        circle.style.cursor = 'pointer';
        circle.setAttribute('stroke-dasharray', '2,2');
      } else if (!(item.type === 'folder' || item.isFolder)) {
        circle.style.cursor = 'default';
        circle.removeAttribute('stroke-dasharray');
      }
      
      nodeGroup.appendChild(circle);
      
      // Create icon/text
      const text = document.createElementNS('http://www.w3.org/2000/svg', 'text');
      text.setAttribute('text-anchor', 'middle');
      text.setAttribute('dominant-baseline', 'central');
      text.setAttribute('fill', '#ffffff');
      
      // Scale font size with depth
      const baseFontSize = item.isCenter ? 16 : 12;
      const fontSize = baseFontSize * depthScale;
      text.setAttribute('font-size', `${fontSize}px`);
      text.setAttribute('font-weight', item.isCenter ? '600' : 'normal');
      text.setAttribute('opacity', Math.max(opacity, 0.7).toString());
      text.textContent = item.isCenter ? item.icon || '⭐' : getItemIcon(item);
      
      nodeGroup.appendChild(text);

      // Hover preview toolbar for non-folder nodes
      const isPreviewable = !(item.type === 'folder' || item.isFolder) && !item.isCenter;
      if (isPreviewable && isHovered) {
        const hoverBridge = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
        hoverBridge.setAttribute('x', '-18');
        hoverBridge.setAttribute('y', `${-size - 46}`); // Extended to cover full gap to toolbar
        hoverBridge.setAttribute('width', '36');
        hoverBridge.setAttribute('height', '46'); // Increased from 18 to 46 to reach toolbar
        hoverBridge.setAttribute('fill', 'transparent');
        hoverBridge.style.pointerEvents = 'all';
        nodeGroup.appendChild(hoverBridge);

        const toolbarGroup = document.createElementNS('http://www.w3.org/2000/svg', 'g');
        toolbarGroup.setAttribute('class', 'preview-toolbar');
        toolbarGroup.setAttribute('transform', `translate(0, ${-size - 32})`);

        const previewButton = document.createElementNS('http://www.w3.org/2000/svg', 'g');
        previewButton.style.pointerEvents = 'all';
        previewButton.style.cursor = 'pointer';

        const buttonBackground = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
        buttonBackground.setAttribute('x', '-14');
        buttonBackground.setAttribute('y', '-14');
        buttonBackground.setAttribute('width', '28');
        buttonBackground.setAttribute('height', '28');
        buttonBackground.setAttribute('rx', '8');
        buttonBackground.setAttribute('fill', 'rgba(15, 23, 42, 0.9)');
        buttonBackground.setAttribute('stroke', 'rgba(148, 163, 184, 0.6)');
        buttonBackground.setAttribute('stroke-width', '1.5');
        previewButton.appendChild(buttonBackground);

        const buttonIcon = document.createElementNS('http://www.w3.org/2000/svg', 'text');
        buttonIcon.setAttribute('text-anchor', 'middle');
        buttonIcon.setAttribute('dominant-baseline', 'central');
        buttonIcon.setAttribute('fill', '#cbd5f5');
        buttonIcon.setAttribute('font-size', '14');
        buttonIcon.textContent = '👁';
        previewButton.appendChild(buttonIcon);

        // Tooltip - positioned relative to node position in world space
        const tooltipGroup = document.createElementNS('http://www.w3.org/2000/svg', 'g');
        // Initial position - will be updated dynamically
        tooltipGroup.setAttribute('transform', `translate(${pos.x - 100}, ${pos.y - size - 108})`);
        tooltipGroup.style.pointerEvents = 'none';
        tooltipGroup.style.opacity = '0';

        const tooltipBackground = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
        tooltipBackground.setAttribute('width', '200');
        tooltipBackground.setAttribute('height', '120'); // Increased from 80 to 120 (50% more)
        tooltipBackground.setAttribute('rx', '12');
        tooltipBackground.setAttribute('fill', 'rgba(15, 23, 42, 0.96)');
        tooltipBackground.setAttribute('stroke', 'rgba(59, 130, 246, 0.45)');
        tooltipBackground.setAttribute('stroke-width', '1.2');
        tooltipBackground.setAttribute('filter', 'url(#blur)');
        tooltipGroup.appendChild(tooltipBackground);

        const tooltipTitle = document.createElementNS('http://www.w3.org/2000/svg', 'text');
        tooltipTitle.setAttribute('x', '16');
        tooltipTitle.setAttribute('y', '24');
        tooltipTitle.setAttribute('fill', '#e2e8f0');
        tooltipTitle.setAttribute('font-size', '13');
        tooltipTitle.setAttribute('font-weight', '600');
        tooltipTitle.textContent = item.title || 'Preview';
        tooltipGroup.appendChild(tooltipTitle);

        const tooltipMeta = document.createElementNS('http://www.w3.org/2000/svg', 'text');
        tooltipMeta.setAttribute('x', '16');
        tooltipMeta.setAttribute('y', '42');
        tooltipMeta.setAttribute('fill', '#94a3b8');
        tooltipMeta.setAttribute('font-size', '11');
        const metaPieces: string[] = [];
        if (item.type) metaPieces.push(item.type);
        if (item.tags && item.tags.length > 0) metaPieces.push(item.tags.slice(0, 2).join(', '));
        tooltipMeta.textContent = metaPieces.join(' • ') || 'Quick preview';
        tooltipGroup.appendChild(tooltipMeta);

        // Use foreignObject for proper text wrapping
        const foreignObject = document.createElementNS('http://www.w3.org/2000/svg', 'foreignObject');
        foreignObject.setAttribute('x', '16');
        foreignObject.setAttribute('y', '56'); // Moved down from 42 to give more space
        foreignObject.setAttribute('width', '168'); // 200 - 32 (16px padding on each side)
        foreignObject.setAttribute('height', '52'); // Increased from 35 to 52 to fill the extra space

        const tooltipSnippetDiv = document.createElement('div');
        tooltipSnippetDiv.style.cssText = `
          color: #cbd5f5;
          font-size: 11.5px;
          line-height: 1.4;
          overflow: hidden;
          text-overflow: ellipsis;
          display: -webkit-box;
          -webkit-line-clamp: 3;
          -webkit-box-orient: vertical;
          word-wrap: break-word;
          max-height: 52px;
        `;

        // Initial placeholder text
        tooltipSnippetDiv.textContent = 'Loading preview...';
        foreignObject.appendChild(tooltipSnippetDiv);
        tooltipGroup.appendChild(foreignObject);

        previewButton.addEventListener('mouseenter', async () => {
          // Hide any previously active tooltip
          hideActiveTooltip();

          tooltipGroup.style.opacity = '1';

          // Track this as the active tooltip
          activeTooltipRef.current = { element: tooltipGroup, itemId: item.id };

          // Check if content is already cached
          if (contentCacheRef.current.has(item.id)) {
            const cachedContent = contentCacheRef.current.get(item.id)!;
            const snippet = cachedContent.trim() || 'No preview available.';
            tooltipSnippetDiv.textContent = snippet;
          } else {
            // Fetch actual content from API
            try {
              const response = await fetch(`/api/items/${item.id}/content`);
              const data = await response.json();

              if (data.success && data.content) {
                // Cache the content
                contentCacheRef.current.set(item.id, data.content);

                // Update tooltip with real content (let CSS handle truncation)
                tooltipSnippetDiv.textContent = data.content.trim() || 'No preview available.';
              } else {
                tooltipSnippetDiv.textContent = 'No preview available.';
              }
            } catch (error) {
              console.error('Failed to fetch content:', error);
              tooltipSnippetDiv.textContent = 'Failed to load preview.';
            }
          }
        });

        previewButton.addEventListener('mouseleave', () => {
          tooltipGroup.style.opacity = '0';
          // Clear active tooltip reference
          if (activeTooltipRef.current?.itemId === item.id) {
            activeTooltipRef.current = null;
          }
        });

        toolbarGroup.appendChild(previewButton);
        nodeGroup.appendChild(toolbarGroup);

        // Append tooltip to SVG root (not nodeGroup) so it's always on top
        // We'll position it absolutely when shown
        tooltipGroup.setAttribute('id', `tooltip-${item.id}`);
        svg.appendChild(tooltipGroup);
      }
      
      // Add depth indicator rings for nested items
      if (depthLayer > 1 && depthLayer < 999) {
        // Create concentric rings to show depth
        for (let i = 1; i < depthLayer; i++) {
          const depthRing = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
          depthRing.setAttribute('r', (size + (i * 4)).toString());
          depthRing.setAttribute('fill', 'none');
          depthRing.setAttribute('stroke', '#334155'); // Subtle gray
          depthRing.setAttribute('stroke-width', '0.5');
          depthRing.setAttribute('opacity', (0.3 / i).toString()); // Fade with depth
          depthRing.setAttribute('stroke-dasharray', '2,2');
          nodeGroup.appendChild(depthRing);
        }
      }

      // Add depth level number
      if (depthLayer > 1 && depthLayer < 999) {
        const depthIndicator = document.createElementNS('http://www.w3.org/2000/svg', 'text');
        depthIndicator.setAttribute('x', (size * 0.8).toString());
        depthIndicator.setAttribute('y', (-size * 0.8).toString());
        depthIndicator.setAttribute('text-anchor', 'middle');
        depthIndicator.setAttribute('font-size', '9');
        depthIndicator.setAttribute('fill', '#64748b');
        depthIndicator.setAttribute('opacity', '0.7');
        depthIndicator.textContent = `D${depthLayer}`;
        nodeGroup.appendChild(depthIndicator);
      }
    });
  }, [allItems, state, getItemOpacity, getItemDepthLayer, getDepthScale, getDepthBlur, hideActiveTooltip]);

  // CRITICAL: Use event delegation instead of individual handlers
  useEffect(() => {
    const svg = svgRef.current;
    if (!svg) return;

    // Single event handler for all clicks using event delegation
    const handleSvgClick = (e: MouseEvent) => {
      console.log('🎯 CLICK EVENT FIRED:', e.shiftKey);

      // Hide any active tooltip when clicking anywhere
      hideActiveTooltip();

      const target = e.target as SVGElement;
      let nodeGroup = target.closest('.node-group') as SVGElement;

      if (!nodeGroup) {
        // Clicked on empty background - clear group selection if any
        if (onClearGroupSelection) {
          console.log('🎯 Background click - clearing group selection');
          onClearGroupSelection();
        }
        return;
      }
      
      const itemId = nodeGroup.getAttribute('data-id');
      const itemType = nodeGroup.getAttribute('data-type');
      const isFolder = nodeGroup.getAttribute('data-is-folder') === 'true';
      
      if (!itemId) return;
      
      const item = allItems.find(i => i.id === itemId);
      if (!item) return;

      // Check if item is groupable (folder OR constellation center)
      const isGroupable = isFolder || (item.isCenter && item.type === 'constellation');

      // Log click to database
      fetch('/api/debug/log', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          component: 'ConstellationVisualization',
          action: 'item_clicked',
          content_preview: `Clicked: ${item.title}`,
          metadata: {
            itemId: item.id,
            title: item.title,
            shift: e.shiftKey,
            type: itemType,
            isGroupable,
            isOverflowNode: item.isOverflowNode,
            hasAllChildren: !!item.allChildren
          }
        })
      });

      // Handle shift+click for groupable items (folders and constellation centers)
      if (e.shiftKey && isGroupable) {
        e.preventDefault();
        e.stopPropagation();
        onItemClick(item, e as any);
        return;
      }

      // Regular click - log before calling handler
      fetch('/api/debug/log', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          component: 'ConstellationVisualization',
          action: 'calling_onItemClick',
          content_preview: `Calling handler for: ${item.title}`,
          metadata: {
            itemId: item.id,
            isOverflowNode: item.isOverflowNode
          }
        })
      });

      onItemClick(item, e as any);
    };

    // Single event handler for all mousedowns
    const handleSvgMouseDown = (e: MouseEvent) => {
      console.log('🖱️ MOUSEDOWN EVENT:', {
        shiftKey: e.shiftKey,
        altKey: e.altKey,
        ctrlKey: e.ctrlKey,
        metaKey: e.metaKey,
        buttons: e.buttons,
        button: e.button
      });
      
      const target = e.target as SVGElement;
      let nodeGroup = target.closest('.node-group') as SVGElement;
      
      if (!nodeGroup) {
        // Canvas click - start rotation/pan
        onMouseDown(e as any, svg);
        return;
      }
      
      const itemId = nodeGroup.getAttribute('data-id');
      const isFolder = nodeGroup.getAttribute('data-is-folder') === 'true';
      
      if (!itemId) return;
      
      const item = allItems.find(i => i.id === itemId);
      if (!item) return;
      
      // Check if item is groupable (folder OR constellation center)
      const isGroupable = isFolder || (item.isCenter && item.type === 'constellation');
      
      console.log('🖱️ Delegated mousedown:', item.title, 'Shift:', e.shiftKey, 'IsFolder:', isFolder, 'IsGroupable:', isGroupable, 'IsOverflow:', item.isOverflowNode);

      // Handle overflow nodes - call onItemClick immediately, no drag
      if (item.isOverflowNode) {
        console.log('📋 Overflow node in delegated mousedown - calling onItemClick immediately');
        e.preventDefault();
        e.stopPropagation();

        // Call onItemClick directly (same pattern as shift+folder below)
        onItemClick(item, {
          shiftKey: e.shiftKey,
          preventDefault: () => e.preventDefault(),
          stopPropagation: () => e.stopPropagation(),
          clientX: e.clientX,
          clientY: e.clientY
        } as any);

        return;
      }

      // Handle shift+groupable item in mousedown directly to avoid race condition
      if (e.shiftKey && isGroupable) {
        console.log('📁 Shift+folder mousedown - triggering group selection immediately');
        e.preventDefault();
        e.stopPropagation();
        
        // Trigger group selection through click event to maintain existing logic
        onItemClick(item, {
          shiftKey: e.shiftKey,
          preventDefault: () => e.preventDefault(),
          stopPropagation: () => e.stopPropagation(),
          clientX: e.clientX,
          clientY: e.clientY
        } as any);
        
        return;
      }
      
      // Normal mousedown - start drag
      onMouseDown({
        clientX: e.clientX,
        clientY: e.clientY,
        button: e.button,
        detail: (e as any).detail || 1,
        preventDefault: () => e.preventDefault(),
        stopPropagation: () => e.stopPropagation(),
        shiftKey: e.shiftKey,
        altKey: e.altKey,
        target: e.target,
        currentTarget: e.currentTarget,
        nodeId: item.id,
        nodeItem: item
      } as any, svg);
    };

    // Single event handler for hover
    const handleSvgMouseOver = (e: MouseEvent) => {
      const target = e.target as SVGElement;
      const nodeGroup = target.closest('.node-group') as SVGElement;

      if (!nodeGroup) {
        onItemHover(null);
        // Hide tooltip when not hovering over any node
        hideActiveTooltip();
        return;
      }

      const itemId = nodeGroup.getAttribute('data-id');
      if (!itemId) return;

      const item = allItems.find(i => i.id === itemId);

      // Hide tooltip when switching to a different node
      if (item && activeTooltipRef.current && activeTooltipRef.current.itemId !== item.id) {
        hideActiveTooltip();
      }

      if (item) onItemHover(item);
    };

    // Add event listeners with capture phase for better control
    svg.addEventListener('click', handleSvgClick, true);
    svg.addEventListener('mousedown', handleSvgMouseDown, true);
    svg.addEventListener('mouseover', handleSvgMouseOver, true);
    svg.addEventListener('mouseout', (e) => {
      if (!e.relatedTarget || !(e.relatedTarget as Element).closest('.node-group')) {
        onItemHover(null);
      }
    }, true);

    // Cleanup
    return () => {
      svg.removeEventListener('click', handleSvgClick, true);
      svg.removeEventListener('mousedown', handleSvgMouseDown, true);
      svg.removeEventListener('mouseover', handleSvgMouseOver, true);
    };
  }, [allItems, onItemClick, onItemHover, onMouseDown, hideActiveTooltip]);

  // Enhanced labels rendering with depth awareness
  const renderLabels = useCallback((svg: SVGSVGElement) => {
    allItems.forEach(item => {
      const nodePos = getNodePosition(item, state.nodePositions, allItems);
      const depthLayer = getItemDepthLayer(item);
      const zPosition = getConstellationDepthZ(item, depthLayer); // Use getConstellationDepthZ to include global offset
      const pos = transformPoint(nodePos.x, nodePos.y, zPosition, state);

      const depthScale = getDepthScale(depthLayer, item.isCenter);
      const baseSize = getItemSize(item);
      const size = baseSize * depthScale;
      const opacity = getItemOpacity(item);
      
      const isDragged = state.draggedNode === item.id;
      const isHovered = state.hoveredItem === item;
      const isFocused = state.focusedItems.has(item.id);
      
      // Get or create label
      let label = labelElementsRef.current.get(item.id) as SVGTextElement;
      if (!label) {
        label = document.createElementNS('http://www.w3.org/2000/svg', 'text');
        label.classList.add('node-label');
        svg.appendChild(label);
        labelElementsRef.current.set(item.id, label);
      }
      
      // Update label position
      label.setAttribute('x', pos.x.toString());
      label.setAttribute('y', (pos.y - size - 5).toString());
      label.setAttribute('text-anchor', 'middle');
      label.textContent = item.title;

      // Constellation centers always have full opacity labels for readability
      const labelOpacity = item.isCenter ? 1.0 : Math.max(opacity * 0.9, 0.4);
      label.setAttribute('opacity', labelOpacity.toString());
      
      // Apply depth blur to labels (but not to constellation centers)
      const depthBlur = getDepthBlur(depthLayer);
      if (depthBlur !== 'none' && !item.isCenter) {
        label.style.filter = depthBlur;
      } else {
        label.style.filter = 'none';
      }
      
      // Special styling for different states
      if (isDragged) {
        label.setAttribute('fill', '#ff6b35');
        label.style.fontSize = `${13 * depthScale}px`;
        label.style.fontWeight = '600';
      } else if (isHovered) {
        label.setAttribute('fill', '#fbbf24');
        label.style.fontSize = `${12 * depthScale}px`;
        label.style.fontWeight = '500';
      } else if (isFocused) {
        label.setAttribute('fill', '#fbbf24');
        label.style.fontSize = `${(item.isCenter ? 14 : 12) * depthScale}px`;
        label.style.fontWeight = '600';
      } else {
        label.setAttribute('fill', '#e2e8f0');
        label.style.fontSize = `${(item.isCenter ? 14 : 12) * depthScale}px`;
        label.style.fontWeight = item.isCenter ? '600' : 'normal';
      }
      
      // Show/hide based on state and depth
      const shouldShowLabel = state.showLabels || isHovered || state.selectedItem === item || isDragged || isFocused;
      // Always show labels for constellation centers, even when pushed back
      const showForDepth = item.isCenter || depthLayer <= 2;

      if (shouldShowLabel && showForDepth) {
        label.classList.remove('hidden');
      } else {
        label.classList.add('hidden');
      }
    });
  }, [allItems, state, getItemOpacity, getItemDepthLayer, getDepthScale, getDepthBlur, getConstellationDepthZ]);

  // Main render function
  const render = useCallback(() => {
    const svg = svgRef.current;
    if (!svg) return;
    
    // Clear and recreate elements efficiently
    if (state.showConnections) {
      renderConnections(svg);
    } else {
      // Remove all connection lines
      svg.querySelectorAll('.connection-line').forEach(el => el.remove());
    }
    
    renderNodes(svg);
    
    if (state.showLabels) {
      renderLabels(svg);
    } else {
      // Hide all labels except for focused items
      labelElementsRef.current.forEach((label, itemId) => {
        if (state.focusedItems.has(itemId)) {
          label.classList.remove('hidden');
        } else {
          label.classList.add('hidden');
        }
      });
    }
  }, [state.showConnections, state.showLabels, state.focusedItems, renderConnections, renderNodes, renderLabels]);

  // Render when state changes
  useEffect(() => {
    render();
  }, [render]);

  // Test function to verify folder expansion is working
  const testFolderExpansion = useCallback(() => {
    console.log('🧪 Testing folder expansion...');
    
    // Find all folders
    const folders = allItems.filter(item => item.type === 'folder' || item.isFolder);
    console.log('📁 Found folders:', folders.map(f => f.title));
    
    // Find all children
    const children = allItems.filter(item => item.parentId);
    console.log('👶 Found children:', children.map(c => ({
      title: c.title,
      parent: c.parentId,
      currentDepth: getItemDepthLayer(c)
    })));
    
    // Test expanding first folder
    if (folders.length > 0) {
      const testFolder = folders[0];
      console.log('🧪 Testing expansion of:', testFolder.title);
      
      // Show expanded state
      console.log('📊 Before expansion - expanded folders:', Array.from(state.expandedConstellations));
      
      // Check children visibility before expansion
      const childrenBefore = allItems.filter(item => item.parentId === testFolder.id);
      childrenBefore.forEach(child => {
        const depth = getItemDepthLayer(child);
        console.log('👶 Child before expansion:', child.title, 'depth:', depth, 'visible:', depth < 3);
      });
    }
  }, [allItems, getItemDepthLayer, state.expandedConstellations]);

  // Call this on component mount
  useEffect(() => {
    // Delay the test to ensure everything is rendered
    const timer = setTimeout(() => {
      testFolderExpansion();
    }, 1000);
    
    return () => clearTimeout(timer);
  }, [testFolderExpansion]);

  // Initialize SVG and set up event listeners
  useEffect(() => {
    const svg = svgRef.current;
    if (!svg) return;

    // Create or get the connections group (render first so it's behind nodes)
    let connectionsGroup = svg.querySelector('.connections-group') as SVGGElement;
    if (!connectionsGroup) {
      connectionsGroup = document.createElementNS('http://www.w3.org/2000/svg', 'g');
      connectionsGroup.classList.add('connections-group');
      svg.appendChild(connectionsGroup);
    }
    connectionElementsRef.current = connectionsGroup;

    const handleResize = () => {
      // Update center position when window resizes
      const rect = svg.getBoundingClientRect();
      // Trigger re-render if needed
    };

    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);

  return (
    <div className="relative w-full h-full overflow-hidden">
      <svg
        ref={svgRef}
        id="constellation"
        className="w-full h-full cursor-grab active:cursor-grabbing"
        onMouseDown={(e) => onMouseDown(e, svgRef.current)}
        onMouseMove={onMouseMove}
        onMouseUp={onMouseUp}
        onWheel={onWheel}
        onContextMenu={(e) => e.preventDefault()}
        onClick={(e) => {
          // console.log('=================================');
          // console.log('🌐 SVG CLICK EVENT:', {
          //   shiftKey: e.shiftKey,
          //   altKey: e.altKey,
          //   ctrlKey: e.ctrlKey,
          //   button: e.button,
          //   clientX: e.clientX,
          //   clientY: e.clientY
          // });
          
          // Event delegation - let browser handle hit detection naturally
          const target = e.target as SVGElement;
          // console.log('🎯 Click target:', target);
          
          // Walk up the DOM tree to find a node group
          let current = target;
          while (current && current !== svgRef.current) {
            if (current.classList?.contains('node-group')) {
              const itemId = current.getAttribute('data-id');
              const item = allItems.find(i => i.id === itemId);
              // console.log('📍 Found node group:', itemId, item?.title, 'Type:', item?.type);
              
              if (item) {
                e.stopPropagation();

                // Special handling for overflow nodes
                if (item.isOverflowNode) {
                  console.log('📋 onClick detected overflow node:', item.title);
                }

                // Log what type of click this is
                if (e.shiftKey) {
                  console.log('⇧ SHIFT+CLICK detected on:', item.title, 'Constellation:', item.constellation);
                }

                // ALWAYS call onItemClick for ANY item when found
                // The handler will determine what to do based on item type and modifiers
                console.log('🔥 Calling onItemClick for:', item.title, 'with event, shiftKey:', e.shiftKey, 'isOverflowNode:', item.isOverflowNode);
                onItemClick(item, e as any);
                return;
              }
            }
            const parent = current.parentElement;
            if (!parent) break;
            current = parent as unknown as SVGElement;
          }
          
          // If no node was clicked, log it
          // console.log('❌ No node found at click position');
        }}
      >
        <defs>
          <filter id="glow">
            <feGaussianBlur stdDeviation="3" result="coloredBlur"/>
            <feMerge>
              <feMergeNode in="coloredBlur"/>
              <feMergeNode in="SourceGraphic"/>
            </feMerge>
          </filter>
          <radialGradient id="nodeGradient">
            <stop offset="0%" style={{stopColor: '#ffffff', stopOpacity: 0.8}}/>
            <stop offset="100%" style={{stopColor: '#3b82f6', stopOpacity: 1}}/>
          </radialGradient>
          <filter id="blur">
            <feGaussianBlur in="SourceGraphic" stdDeviation="2" />
          </filter>
          {/* Additional depth blur filters */}
          <filter id="depthBlur1">
            <feGaussianBlur in="SourceGraphic" stdDeviation="0.5" />
          </filter>
          <filter id="depthBlur2">
            <feGaussianBlur in="SourceGraphic" stdDeviation="1" />
          </filter>
          <filter id="depthBlur3">
            <feGaussianBlur in="SourceGraphic" stdDeviation="2" />
          </filter>
        </defs>
      </svg>

      {/* Enhanced hint overlay with depth instructions - DISABLED per user request */}
      {/* {state.showHint && (
        <div className="fixed top-5 right-5 z-40 bg-black/95 backdrop-blur-lg px-6 py-4 rounded-xl border border-blue-400/30 shadow-2xl pointer-events-none max-w-sm">
          <div className="text-blue-400 text-base font-medium mb-2">
            {state.hintText}
          </div>
          <div className="text-slate-400 text-sm">
            {state.dragMode === 'node' ? (
              <>🎯 Dragging individual node<br/>Position will be saved automatically</>
            ) : state.dragMode === 'rotate' ? (
              <>🖱️ Left-click drag: Rotate space<br/>🖱️ Right-click drag: Pan view<br/>⭐ Click constellation centers to expand</>
            ) : (
              <>🖱️ Right-click drag: Pan view<br/>👆👆 Two fingers: Pan & Zoom<br/>⭐ Click constellation centers to expand<br/>⇧ Shift+Click ANY item to focus its constellation</>
            )}
          </div>
        </div>
      )} */}
      
      {/* Debug panel showing all folders */}
      {state.showDebugPanel && (
        <div
          className="absolute top-20 right-5 bg-slate-800/90 backdrop-blur-sm border border-slate-600/50 rounded-lg p-3 max-w-xs relative"
          style={{ zIndex: Z_INDEX.CONSTELLATION }}
        >
          {onCloseDebugPanel && (
            <button
              onClick={onCloseDebugPanel}
              className="absolute top-2 right-2 text-slate-400 hover:text-white transition-colors text-lg leading-none w-5 h-5 flex items-center justify-center"
            >
              ×
            </button>
          )}
          <div className="text-xs text-slate-400 mb-2 pr-6">Debug: Folders in Data</div>
          <div className="space-y-1 text-xs max-h-40 overflow-y-auto">
            {allItems.filter(item => item.type === 'folder' || item.isFolder).map(folder => (
              <div key={folder.id} className="text-green-400">
                📁 {folder.title} (ID: {folder.id})
                <br />
                <span className="text-slate-500">Type: {folder.type}, IsFolder: {folder.isFolder ? 'true' : 'false'}</span>
              </div>
            ))}
          </div>
          
          {/* Constellation Focus State */}
          {(state.focusedConstellation || Object.keys(state.constellationDepthOffsets || {}).length > 0) && (
            <div className="mt-3 pt-3 border-t border-slate-600/50">
              <div className="text-xs text-slate-400 mb-2">Constellation Focus</div>
              <div className="space-y-1 text-xs">
                <div className="text-blue-400">
                  Focused: {state.focusedConstellation || 'None'}
                </div>
                {Object.entries(state.constellationFocusLevels || {}).map(([id, level]) => (
                  <div key={id} className="text-green-400">
                    {id}: Level {level} (Offset: {state.constellationDepthOffsets[id]}z)
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Group Selection Debug */}
          {state.selectedGroupItems.size > 0 && (
            <div className="mt-3 pt-3 border-t border-slate-600/50">
              <div className="text-xs text-slate-400 mb-2">Group Selection ({state.selectedGroupItems.size} items)</div>
              <div className="space-y-1 text-xs max-h-40 overflow-y-auto">
                <div className="text-yellow-400">
                  Parent: {state.groupParentId}
                </div>
                {Array.from(state.selectedGroupItems as Set<string>).map((itemId) => {
                  const item = allItems.find(i => i.id === itemId);
                  const pos = item ? getNodePosition(item, state.nodePositions, allItems) : null;
                  return (
                    <div key={itemId} className="text-orange-400">
                      {item?.title || itemId} @ ({pos?.x?.toFixed(0)}, {pos?.y?.toFixed(0)})
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* Z-Depth Debug */}
          <div className="mt-3 pt-3 border-t border-slate-600/50">
            <div className="text-xs text-slate-400 mb-2">Z-Depth Debug</div>
            <div className="space-y-1 text-xs">
              {allItems.filter(item => item.isCenter).map(centerItem => {
                const constellation = centerItem.constellation || centerItem.id.replace('_center', '');
                const offset = state.constellationDepthOffsets[constellation] || 0;
                const level = state.constellationFocusLevels[constellation] || 0;
                return (
                  <div key={constellation} className={offset > 0 ? 'text-green-400' : offset < 0 ? 'text-red-400' : 'text-slate-400'}>
                    {constellation}: Z={offset} L={level}
                  </div>
                );
              })}
            </div>
          </div>
          
          {/* Depth layer legend */}
          {(state.expandedConstellations.size > 0 || state.focusedItems.size > 0) && (
            <div className="mt-3 pt-3 border-t border-slate-600/50">
              <div className="text-xs text-slate-400 mb-2">Depth Layers</div>
              <div className="space-y-1 text-xs">
                <div className="flex items-center gap-2">
                  <div className="w-3 h-3 rounded-full bg-blue-400"></div>
                  <span className="text-slate-300">Foreground</span>
                </div>
                <div className="flex items-center gap-2">
                  <div className="w-3 h-3 rounded-full bg-blue-400/60"></div>
                  <span className="text-slate-400">Middle</span>
                </div>
                <div className="flex items-center gap-2">
                  <div className="w-3 h-3 rounded-full bg-blue-400/30"></div>
                  <span className="text-slate-500">Background</span>
                </div>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
} 
