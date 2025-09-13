'use client';

import React, { createContext, useContext, useState, useCallback, useEffect, useRef } from 'react';
import { Transform } from '@/lib/utils/coordinate-bridge';
import { UILayerState, LayerId, LayerState as UILayerState_Type } from '@/lib/state/ui-layer-state';
import { PopupStateAdapter } from '@/lib/adapters/popup-state-adapter';
import { useFeatureFlag } from '@/lib/offline/feature-flags';

// Types
type LayerTransforms = Record<LayerId, Transform>;

interface LayerContextValue {
  activeLayer: 'notes' | 'popups';
  transforms: LayerTransforms;
  layers: Map<LayerId, UILayerState_Type>;
  syncPan: boolean;
  syncZoom: boolean;
  setActiveLayer: (id: 'notes' | 'popups') => void;
  updateTransform: (id: LayerId, transform: Partial<Transform>) => void;
  updateLayerOpacity: (id: LayerId, opacity: number) => void;
  updateLayerVisibility: (id: LayerId, visible: boolean) => void;
  toggleSyncPan: () => void;
  toggleSyncZoom: () => void;
  resetView: () => void;
  toggleSidebar: () => void;
  isSidebarVisible: boolean;
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
  
  // Initialize state from UILayerState singleton
  const [activeLayer, setActiveLayerState] = useState<'notes' | 'popups'>('notes');
  const [syncPan, setSyncPan] = useState(true);
  const [syncZoom, setSyncZoom] = useState(true);
  const [isSidebarVisible, setIsSidebarVisible] = useState(true);
  
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
  const updateTransform = useCallback((id: LayerId, transform: Partial<Transform>) => {
    if (id === 'sidebar') return; // Sidebar never transforms
    
    // Batch transform updates
    pendingTransformsRef.current[id] = {
      ...(pendingTransformsRef.current[id] || transforms[id]),
      ...transform,
    };
    
    // Cancel previous RAF if exists
    if (rafIdRef.current !== null) {
      cancelAnimationFrame(rafIdRef.current);
    }
    
    // Schedule update on next frame
    rafIdRef.current = requestAnimationFrame(() => {
      setTransforms(prev => {
        const newTransforms = { ...prev, ...pendingTransformsRef.current };
        
        // Apply sync if enabled
        if (syncPan || syncZoom) {
          const synced = PopupStateAdapter.syncTransforms(
            newTransforms.notes,
            newTransforms.popups,
            syncPan,
            syncZoom
          );
          newTransforms.notes = synced.notes;
          newTransforms.popups = synced.popups;
        }
        
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
  }, [syncPan, syncZoom, transforms]);
  
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
    updateLayerOpacity,
    updateLayerVisibility,
    toggleSyncPan,
    toggleSyncZoom,
    resetView,
    toggleSidebar,
    isSidebarVisible,
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
      updateLayerOpacity: () => {},
      updateLayerVisibility: () => {},
      toggleSyncPan: () => {},
      toggleSyncZoom: () => {},
      resetView: () => {},
      toggleSidebar: () => {},
      isSidebarVisible: true,
    };
  }
  return context;
};

// Export for use in other components
export default LayerProvider;