/**
 * PopupStateAdapter - Migration adapter for transitioning from Map-based popup state
 * to the new multi-layer canvas architecture
 * 
 * Enables gradual migration without breaking existing functionality
 */

import { Transform } from '@/lib/utils/coordinate-bridge';

// Types for the current implementation
export interface CurrentPopupState {
  id: string;
  folder: any; // TreeNode type from existing code
  position: { x: number; y: number }; // Screen coordinates
  isLoading: boolean;
  parentId?: string;
  level: number;
  isDragging?: boolean;
  height?: number;
}

// Types for the new layer architecture
export interface LayerState {
  id: 'sidebar' | 'notes' | 'popups';
  visible: boolean;
  locked: boolean;
  opacity: number;
  transform: Transform;
}

export interface CanvasState {
  activeLayer: 'notes' | 'popups';
  layers: Map<string, LayerState>;
  syncPan: boolean;
  syncZoom: boolean;
  // Migration compatibility
  popups?: Map<string, CurrentPopupState>; // Keep old state during migration
  migrationMode?: 'legacy' | 'hybrid' | 'new';
}

/**
 * Adapter for migrating between popup state representations
 */
export class PopupStateAdapter {
  /**
   * Convert existing Map-based popup state to layered architecture
   */
  static toLayeredState(
    hoverPopovers: Map<string, CurrentPopupState>,
    currentTransform: Transform
  ): CanvasState {
    const hasPopups = hoverPopovers.size > 0;
    
    const popupLayer: LayerState = {
      id: 'popups',
      visible: hasPopups,
      locked: false,
      opacity: 1,
      transform: currentTransform,
    };
    
    const notesLayer: LayerState = {
      id: 'notes',
      visible: true,
      locked: false,
      opacity: hasPopups ? 0.6 : 1, // Dim notes when popups are active
      transform: currentTransform,
    };
    
    const sidebarLayer: LayerState = {
      id: 'sidebar',
      visible: true,
      locked: true, // Sidebar never transforms
      opacity: 1,
      transform: { x: 0, y: 0, scale: 1 }, // Fixed position
    };
    
    return {
      activeLayer: hasPopups ? 'popups' : 'notes',
      layers: new Map([
        ['sidebar', sidebarLayer],
        ['notes', notesLayer],
        ['popups', popupLayer],
      ]),
      syncPan: true,
      syncZoom: true,
      popups: hoverPopovers, // Keep original for backward compatibility
      migrationMode: 'hybrid',
    };
  }
  
  /**
   * Convert layered state back to Map-based popup state
   * for backward compatibility during migration
   */
  static fromLayeredState(canvasState: CanvasState): Map<string, CurrentPopupState> {
    return canvasState.popups || new Map();
  }
  
  /**
   * Check if we should auto-switch layers based on popup state
   */
  static shouldAutoSwitch(
    popupCount: number,
    currentLayer: 'notes' | 'popups'
  ): { shouldSwitch: boolean; targetLayer: 'notes' | 'popups'; message?: string } {
    // First popup opens - switch to popup layer
    if (popupCount === 1 && currentLayer === 'notes') {
      return {
        shouldSwitch: true,
        targetLayer: 'popups',
        message: 'Switching to popup layer',
      };
    }
    
    // Last popup closes - return to notes
    if (popupCount === 0 && currentLayer === 'popups') {
      return {
        shouldSwitch: true,
        targetLayer: 'notes',
        message: 'Returning to notes canvas',
      };
    }
    
    return {
      shouldSwitch: false,
      targetLayer: currentLayer,
    };
  }
  
  /**
   * Merge transforms when sync is enabled
   */
  static syncTransforms(
    notesTransform: Transform,
    popupsTransform: Transform,
    syncPan: boolean,
    syncZoom: boolean
  ): { notes: Transform; popups: Transform } {
    if (!syncPan && !syncZoom) {
      return { notes: notesTransform, popups: popupsTransform };
    }
    
    const synced: Transform = {
      x: syncPan ? notesTransform.x : popupsTransform.x,
      y: syncPan ? notesTransform.y : popupsTransform.y,
      scale: syncZoom ? notesTransform.scale : popupsTransform.scale,
    };
    
    return {
      notes: syncPan || syncZoom ? synced : notesTransform,
      popups: syncPan || syncZoom ? synced : popupsTransform,
    };
  }
  
  /**
   * Calculate layer opacity based on active state
   */
  static getLayerOpacity(
    layerId: 'sidebar' | 'notes' | 'popups',
    activeLayer: 'notes' | 'popups',
    userOpacity?: number
  ): number {
    // Sidebar always full opacity
    if (layerId === 'sidebar') {
      return 1;
    }
    
    // User-specified opacity takes precedence
    if (userOpacity !== undefined) {
      return userOpacity;
    }
    
    // Inactive layers are dimmed
    if (layerId !== activeLayer) {
      return 0.6;
    }
    
    return 1;
  }
  
  /**
   * Determine if a layer should capture pointer events
   */
  static getPointerEvents(
    layerId: 'sidebar' | 'notes' | 'popups',
    activeLayer: 'notes' | 'popups'
  ): 'auto' | 'none' {
    // Sidebar always interactive
    if (layerId === 'sidebar') {
      return 'auto';
    }
    
    // Only active layer is interactive
    return layerId === activeLayer ? 'auto' : 'none';
  }
}