'use client';

import React, { createContext, useContext, useState, useCallback, useEffect, useRef } from 'react';
import { Transform } from '@/lib/utils/coordinate-bridge';
import { UILayerState, LayerId, LayerState as UILayerState_Type } from '@/lib/state/ui-layer-state';
import { PopupStateAdapter } from '@/lib/adapters/popup-state-adapter';
import { useFeatureFlag } from '@/lib/offline/feature-flags';
import { debugLog } from '@/lib/utils/debug-logger';

// Types
type LayerTransforms = Record<LayerId, Transform>;

// Gesture types
type GestureType = 'none' | 'overlay-pan' | 'popup-drag' | 'notes-pan';

interface GestureState {
  type: GestureType;
  txId: number;
}

interface LayerContextValue {
  activeLayer: 'notes' | 'popups';
  transforms: LayerTransforms;
  layers: Map<LayerId, UILayerState_Type>;
  syncPan: boolean;
  syncZoom: boolean;
  setActiveLayer: (id: 'notes' | 'popups') => void;
  updateTransform: (id: LayerId, transform: Partial<Transform>) => void;
  updateTransformByDelta: (layer: LayerId, delta: { dx: number; dy: number }, opts?: { syncPan?: boolean; txId?: number }) => void;
  updateLayerOpacity: (id: LayerId, opacity: number) => void;
  updateLayerVisibility: (id: LayerId, visible: boolean) => void;
  toggleSyncPan: () => void;
  toggleSyncZoom: () => void;
  resetView: () => void;
  toggleSidebar: () => void;
  isSidebarVisible: boolean;
  currentGesture: GestureState | null;
  setGesture: (type: GestureType) => void;
}

// Create context
const LayerContext = createContext<LayerContextValue | null>(null);

interface LayerProviderProps {
  children: React.ReactNode;
  initialPopupCount?: number;
}

/**
 * LayerProvider - Manages multi-layer canvas state
 * Provides context for layer management across the application
 */
export const LayerProvider: React.FC<LayerProviderProps> = ({ 
  children,
  initialPopupCount = 0,
}) => {
  const multiLayerEnabled = useFeatureFlag('ui.multiLayerCanvas' as any);
  
  // If feature is disabled, provide minimal stub context
  if (!multiLayerEnabled) {
    return (
      <LayerContext.Provider value={{
        activeLayer: 'notes',
        layers: new Map(),
        transforms: {},
        syncPan: false,
        syncZoom: false,
        setActiveLayer: () => {},
        updateTransform: () => {},
        updateTransformByDelta: () => {},
        updateLayerOpacity: () => {},
        updateLayerVisibility: () => {},
        toggleSyncPan: () => {},
        toggleSyncZoom: () => {},
        resetView: () => {},
        toggleSidebar: () => {},
        isSidebarVisible: true,
        currentGesture: null,
        setGesture: () => {},
      }}>
        {children}
      </LayerContext.Provider>
    );
  }
  
  // Initialize state from UILayerState singleton
  const [activeLayer, setActiveLayerState] = useState<'notes' | 'popups'>('notes');
  const [syncPan, setSyncPan] = useState(true);
  const [syncZoom, setSyncZoom] = useState(true);
  const [isSidebarVisible, setIsSidebarVisible] = useState(true);
  
  // Gesture arbiter state
  const [currentGesture, setCurrentGesture] = useState<GestureState | null>(null);
  const nextTxIdRef = useRef(1);
  
  // Layer transforms
  const [transforms, setTransforms] = useState<LayerTransforms>({
    sidebar: { x: 0, y: 0, scale: 1 },
    notes: { x: 0, y: 0, scale: 1 },
    popups: { x: 0, y: 0, scale: 1 },
  });
  
  // RAF batching for smooth transforms
  const rafIdRef = useRef<number | null>(null);
  const pendingTransformsRef = useRef<Partial<LayerTransforms>>({});
  
  // Layer states
  const [layers, setLayers] = useState<Map<LayerId, UILayerState_Type>>(() => {
    const defaultLayers = new Map<LayerId, UILayerState_Type>();
    
    defaultLayers.set('sidebar', {
      id: 'sidebar',
      visible: true,
      locked: true,
      opacity: 1,
      transform: { x: 0, y: 0, scale: 1 },
    });
    
    defaultLayers.set('notes', {
      id: 'notes',
      visible: true,
      locked: false,
      opacity: 1,
      transform: { x: 0, y: 0, scale: 1 },
    });
    
    defaultLayers.set('popups', {
      id: 'popups',
      visible: true,
      locked: false,
      opacity: 1,
      transform: { x: 0, y: 0, scale: 1 },
    });
    
    return defaultLayers;
  });
  
  // Note: Auto-switch logic is now handled in notes-explorer-phase1.tsx
  // to avoid conflicts and ensure proper coordination with popup state
  
  // Update transform for a specific layer with RAF batching
  // NOTE: This treats the input as DELTA values, not absolute positions
  const updateTransform = useCallback((id: LayerId, delta: Partial<Transform>) => {
    if (id === 'sidebar') return; // Sidebar never transforms
    
    // If syncPan is enabled and we're panning (x or y delta), apply to both layers
    if (syncPan && (delta.x !== undefined || delta.y !== undefined)) {
      // Apply the same delta to both notes and popups
      ['notes', 'popups'].forEach(layerId => {
        const currentTransform = pendingTransformsRef.current[layerId as LayerId] || 
                                transforms[layerId as LayerId] || 
                                { x: 0, y: 0, scale: 1 };
        
        pendingTransformsRef.current[layerId as LayerId] = {
          x: currentTransform.x + (delta.x || 0),
          y: currentTransform.y + (delta.y || 0),
          scale: delta.scale !== undefined ? delta.scale : currentTransform.scale,
        };
      });
    } else {
      // Only update the specified layer
      const currentTransform = pendingTransformsRef.current[id] || transforms[id] || { x: 0, y: 0, scale: 1 };
      
      // Apply delta to current transform
      const newTransform = {
        x: currentTransform.x + (delta.x || 0),
        y: currentTransform.y + (delta.y || 0),
        scale: delta.scale !== undefined ? delta.scale : currentTransform.scale,
      };
      
      // Store the new absolute transform
      pendingTransformsRef.current[id] = newTransform;
    }
    
    // Cancel previous RAF if exists
    if (rafIdRef.current !== null) {
      cancelAnimationFrame(rafIdRef.current);
    }
    
    // Schedule update on next frame
    rafIdRef.current = requestAnimationFrame(() => {
      setTransforms(prev => {
        // Sync is already handled in updateTransform, just apply pending transforms
        const newTransforms = { ...prev, ...pendingTransformsRef.current };
        return newTransforms;
      });
      
      // Update layer state
      setLayers(prev => {
        const newLayers = new Map(prev);
        
        Object.entries(pendingTransformsRef.current).forEach(([layerId, transform]) => {
          const layer = newLayers.get(layerId as LayerId);
          if (layer && transform) {
            newLayers.set(layerId as LayerId, {
              ...layer,
              transform: transform as Transform,
            });
          }
        });
        
        return newLayers;
      });
      
      // Clear pending transforms
      pendingTransformsRef.current = {};
      rafIdRef.current = null;
    });
  }, [syncPan, transforms]);
  
  // New explicit delta API
  const updateTransformByDelta = useCallback((
    layer: LayerId,
    delta: { dx: number; dy: number },
    opts?: { syncPan?: boolean; txId?: number }
  ) => {
    // Check if this gesture is allowed based on current gesture state
    if (currentGesture && opts?.txId && currentGesture.txId !== opts.txId) {
      // Different gesture is in progress, ignore this update
      debugLog('LayerProvider', 'delta_ignored_wrong_gesture', {
        layer,
        currentTxId: currentGesture.txId,
        requestedTxId: opts?.txId
      });
      return;
    }
    
    // Log the delta update
    debugLog('LayerProvider', 'delta_update', {
      layer,
      delta,
      currentTransform: transforms[layer],
      txId: opts?.txId,
      syncPan
    });
    
    // Use provided sync override or default to current setting
    const shouldSync = opts?.syncPan !== undefined ? opts.syncPan : syncPan;
    
    // Convert delta to transform format and call existing updateTransform
    updateTransform(layer, { x: delta.dx, y: delta.dy });
  }, [currentGesture, syncPan, updateTransform, transforms]);
  
  // Gesture arbiter
  const setGesture = useCallback((type: GestureType) => {
    if (type === 'none') {
      setCurrentGesture(null);
    } else {
      const txId = nextTxIdRef.current++;
      setCurrentGesture({ type, txId });
    }
  }, []);
  
  // Set active layer
  const setActiveLayer = useCallback((id: 'notes' | 'popups') => {
    setActiveLayerState(id);
    
    // Update layer opacities
    setLayers(prev => {
      const newLayers = new Map(prev);
      
      newLayers.forEach((layer, layerId) => {
        if (layerId !== 'sidebar') {
          const opacity = PopupStateAdapter.getLayerOpacity(layerId, id);
          newLayers.set(layerId, { ...layer, opacity });
        }
      });
      
      return newLayers;
    });
  }, []);
  
  // Toggle sync pan
  const toggleSyncPan = useCallback(() => {
    setSyncPan(prev => !prev);
  }, []);
  
  // Toggle sync zoom
  const toggleSyncZoom = useCallback(() => {
    setSyncZoom(prev => !prev);
  }, []);
  
  // Reset view to origin
  const resetView = useCallback(() => {
    const resetTransform = { x: 0, y: 0, scale: 1 };
    
    setTransforms({
      sidebar: { x: 0, y: 0, scale: 1 },
      notes: resetTransform,
      popups: resetTransform,
    });
    
    setLayers(prev => {
      const newLayers = new Map(prev);
      newLayers.forEach((layer, id) => {
        if (id !== 'sidebar') {
          newLayers.set(id, { ...layer, transform: resetTransform });
        }
      });
      return newLayers;
    });
  }, []);
  
  // Toggle sidebar visibility
  const toggleSidebar = useCallback(() => {
    setIsSidebarVisible(prev => !prev);
    
    setLayers(prev => {
      const newLayers = new Map(prev);
      const sidebar = newLayers.get('sidebar');
      if (sidebar) {
        newLayers.set('sidebar', {
          ...sidebar,
          visible: !sidebar.visible,
        });
      }
      return newLayers;
    });
  }, []);
  
  // Update layer opacity
  const updateLayerOpacity = useCallback((id: LayerId, opacity: number) => {
    setLayers(prev => {
      const newLayers = new Map(prev);
      const layer = newLayers.get(id);
      if (layer) {
        newLayers.set(id, {
          ...layer,
          opacity: Math.max(0, Math.min(1, opacity)), // Clamp between 0 and 1
        });
      }
      return newLayers;
    });
  }, []);
  
  // Update layer visibility
  const updateLayerVisibility = useCallback((id: LayerId, visible: boolean) => {
    setLayers(prev => {
      const newLayers = new Map(prev);
      const layer = newLayers.get(id);
      if (layer) {
        newLayers.set(id, {
          ...layer,
          visible,
        });
      }
      return newLayers;
    });
  }, []);
  
  // Context value
  const value: LayerContextValue = {
    activeLayer,
    transforms,
    layers,
    syncPan,
    syncZoom,
    setActiveLayer,
    updateTransform,
    updateTransformByDelta,
    updateLayerOpacity,
    updateLayerVisibility,
    toggleSyncPan,
    toggleSyncZoom,
    resetView,
    toggleSidebar,
    isSidebarVisible,
    currentGesture,
    setGesture,
  };
  
  // Cleanup RAF on unmount
  useEffect(() => {
    return () => {
      if (rafIdRef.current !== null) {
        cancelAnimationFrame(rafIdRef.current);
      }
    };
  }, []);
  
  // Only provide context if multi-layer is enabled
  if (!multiLayerEnabled) {
    return <>{children}</>;
  }
  
  return (
    <LayerContext.Provider value={value}>
      {children}
    </LayerContext.Provider>
  );
};

/**
 * Hook to use layer context
 */
export const useLayer = () => {
  const context = useContext(LayerContext);
  if (!context) {
    // Return stub values if not in provider
    return {
      activeLayer: 'notes' as const,
      transforms: {
        sidebar: { x: 0, y: 0, scale: 1 },
        notes: { x: 0, y: 0, scale: 1 },
        popups: { x: 0, y: 0, scale: 1 },
      },
      layers: new Map(),
      syncPan: true,
      syncZoom: true,
      setActiveLayer: () => {},
      updateTransform: () => {},
      updateTransformByDelta: () => {},
      updateLayerOpacity: () => {},
      updateLayerVisibility: () => {},
      toggleSyncPan: () => {},
      toggleSyncZoom: () => {},
      resetView: () => {},
      toggleSidebar: () => {},
      isSidebarVisible: true,
      currentGesture: null,
      setGesture: () => {},
    };
  }
  return context;
};

// Export for use in other components
export default LayerProvider;