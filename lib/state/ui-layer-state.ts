/**
 * UI Layer State Management - Ephemeral state for multi-layer canvas
 * 
 * Complies with PostgreSQL-only persistence policy (CLAUDE.md).
 * UI state remains in memory/React state only.
 * Optional PostgreSQL preferences API for persistent settings.
 */

import { useCallback, useState } from 'react';
import { Transform } from '@/lib/utils/coordinate-bridge';

// Types
export type LayerId = 'sidebar' | 'notes' | 'popups';

export interface LayerState {
  id: LayerId;
  visible: boolean;
  locked: boolean;
  opacity: number;
  transform: Transform;
}

export interface CanvasState {
  activeLayer: 'notes' | 'popups';
  layers: Map<LayerId, LayerState>;
  syncPan: boolean;
  syncZoom: boolean;
  migrationMode?: 'legacy' | 'hybrid' | 'new';
}

/**
 * Singleton UI state manager
 * Ephemeral - no persistence to localStorage/IndexedDB
 */
export class UILayerState {
  private static instance: UILayerState;
  private state: CanvasState | null = null;
  
  private constructor() {
    this.state = this.getDefaultState();
  }
  
  static getInstance(): UILayerState {
    if (!this.instance) {
      this.instance = new UILayerState();
    }
    return this.instance;
  }
  
  private getDefaultState(): CanvasState {
    return {
      activeLayer: 'notes',
      syncPan: true,
      syncZoom: true,
      migrationMode: 'hybrid',
      layers: new Map([
        ['sidebar', {
          id: 'sidebar',
          visible: true,
          locked: true, // Sidebar never pans/zooms
          opacity: 1,
          transform: { x: 0, y: 0, scale: 1 },
        }],
        ['notes', {
          id: 'notes',
          visible: true,
          locked: false,
          opacity: 1,
          transform: { x: 0, y: 0, scale: 1 },
        }],
        ['popups', {
          id: 'popups',
          visible: true,
          locked: false,
          opacity: 1,
          transform: { x: 0, y: 0, scale: 1 },
        }],
      ]),
    };
  }
  
  get(): CanvasState {
    return this.state || this.getDefaultState();
  }
  
  update(updates: Partial<CanvasState>): void {
    this.state = { 
      ...this.state!, 
      ...updates,
      // Preserve layers map if not explicitly updated
      layers: updates.layers || this.state!.layers,
    };
  }
  
  updateLayer(layerId: LayerId, updates: Partial<LayerState>): void {
    const layer = this.state?.layers.get(layerId);
    if (layer) {
      const updatedLayer = { ...layer, ...updates };
      this.state!.layers.set(layerId, updatedLayer);
    }
  }
  
  updateTransform(layerId: LayerId, transform: Partial<Transform>): void {
    const layer = this.state?.layers.get(layerId);
    if (layer && !layer.locked) {
      const updatedTransform = { ...layer.transform, ...transform };
      this.updateLayer(layerId, { transform: updatedTransform });
    }
  }
  
  switchLayer(targetLayer: 'notes' | 'popups'): void {
    this.update({ activeLayer: targetLayer });
  }
  
  toggleSyncPan(): void {
    this.update({ syncPan: !this.state?.syncPan });
  }
  
  toggleSyncZoom(): void {
    this.update({ syncZoom: !this.state?.syncZoom });
  }
  
  reset(): void {
    this.state = this.getDefaultState();
  }
  
  // Helper methods for common operations
  isLayerActive(layerId: LayerId): boolean {
    return layerId === this.state?.activeLayer || layerId === 'sidebar';
  }
  
  getLayerTransform(layerId: LayerId): Transform {
    return this.state?.layers.get(layerId)?.transform || { x: 0, y: 0, scale: 1 };
  }
  
  getLayerOpacity(layerId: LayerId): number {
    const layer = this.state?.layers.get(layerId);
    if (!layer) return 1;
    
    // Dim inactive layers (except sidebar)
    if (layerId !== 'sidebar' && layerId !== this.state?.activeLayer) {
      return 0.6;
    }
    
    return layer.opacity;
  }
}

/**
 * React hook for UI layer state
 */
export const useUILayerState = () => {
  const [state, setState] = useState<CanvasState>(() => 
    UILayerState.getInstance().get()
  );
  
  const updateState = useCallback((updates: Partial<CanvasState>) => {
    UILayerState.getInstance().update(updates);
    setState(UILayerState.getInstance().get());
  }, []);
  
  const updateLayer = useCallback((layerId: LayerId, updates: Partial<LayerState>) => {
    UILayerState.getInstance().updateLayer(layerId, updates);
    setState(UILayerState.getInstance().get());
  }, []);
  
  const updateTransform = useCallback((layerId: LayerId, transform: Partial<Transform>) => {
    UILayerState.getInstance().updateTransform(layerId, transform);
    setState(UILayerState.getInstance().get());
  }, []);
  
  const switchLayer = useCallback((targetLayer: 'notes' | 'popups') => {
    UILayerState.getInstance().switchLayer(targetLayer);
    setState(UILayerState.getInstance().get());
  }, []);
  
  const toggleSyncPan = useCallback(() => {
    UILayerState.getInstance().toggleSyncPan();
    setState(UILayerState.getInstance().get());
  }, []);
  
  const toggleSyncZoom = useCallback(() => {
    UILayerState.getInstance().toggleSyncZoom();
    setState(UILayerState.getInstance().get());
  }, []);
  
  const resetState = useCallback(() => {
    UILayerState.getInstance().reset();
    setState(UILayerState.getInstance().get());
  }, []);
  
  return {
    state,
    updateState,
    updateLayer,
    updateTransform,
    switchLayer,
    toggleSyncPan,
    toggleSyncZoom,
    resetState,
    // Helper methods
    isLayerActive: (layerId: LayerId) => UILayerState.getInstance().isLayerActive(layerId),
    getLayerTransform: (layerId: LayerId) => UILayerState.getInstance().getLayerTransform(layerId),
    getLayerOpacity: (layerId: LayerId) => UILayerState.getInstance().getLayerOpacity(layerId),
  };
};

/**
 * Optional: PostgreSQL-backed preferences for persistent settings
 * These would be loaded once on app start and saved on change
 */
export interface LayerPreferences {
  defaultActiveLayer?: 'notes' | 'popups';
  defaultSyncPan?: boolean;
  defaultSyncZoom?: boolean;
  sidebarVisible?: boolean;
}

// API functions would be implemented when PostgreSQL preferences are needed
export async function saveLayerPreferences(
  userId: string,
  prefs: LayerPreferences
): Promise<void> {
  // This would make an API call to save preferences to PostgreSQL
  // Implementation deferred until PostgreSQL preferences API is set up
  console.log('Layer preferences API not yet implemented', { userId, prefs });
}

export async function loadLayerPreferences(
  userId: string
): Promise<LayerPreferences | null> {
  // This would make an API call to load preferences from PostgreSQL
  // Implementation deferred until PostgreSQL preferences API is set up
  console.log('Layer preferences API not yet implemented', { userId });
  return null;
}