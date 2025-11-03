/**
 * Z-Index Design Tokens for Multi-Layer Canvas System
 * 
 * Consistent z-index values across all documentation and implementation.
 * These tokens ensure proper visual layering and prevent stacking conflicts.
 */

export const Z_INDEX = {
  // Base layers - normalized values
  NOTES_CANVAS: 1,                 // Bottom layer - world space for panels

  // Canvas nodes (panels and components)
  CANVAS_NODE_BASE: 110,           // Base z-index for all canvas nodes
  CANVAS_NODE_ACTIVE: 160,         // Z-index for active/dragged nodes

  // Canvas UI controls
  CANVAS_UI: 280,                  // Generic canvas HUD widgets
  CANVAS_MINIMAP: 320,             // Annotation minimap + HUD variants

  // Overlay canvas + popups
  POPUP_OVERLAY: 1800,             // Overlay canvas host (legacy name retained)
  OVERLAY_CANVAS: 1800,            // Alias for clarity in new code
  OVERLAY_MINIMAP: 1820,           // Reserved for future overlay minimap / HUD

  // Constellation / global visualization layers
  CONSTELLATION: 2200,             // Constellation canvas + HUD overlays

  // Sidebar + global UI
  SIDEBAR: 2400,                   // Sidebar + docked chrome
  DROPDOWN: 2600,                  // Dropdowns above sidebar
  TOAST: 3000,                     // Toast notifications
  MODAL: 4000,                     // Modal dialogs - highest priority

  // Popup specifics - aligned with overlay base
  POPUP_BASE: 1800,                // Same as POPUP_OVERLAY for consistency
  POPUP_LEVEL_INCREMENT: 25,       // Each nested popup level adds this
  POPUP_DRAGGING_BOOST: 1000,      // Added when dragging a popup
} as const;

// Type for z-index keys
export type ZIndexKey = keyof typeof Z_INDEX;

// Helper to get layer z-index
export const getLayerZIndex = (layer: 'notes' | 'popups' | 'sidebar'): number => {
  switch (layer) {
    case 'notes':
      return Z_INDEX.NOTES_CANVAS;
    case 'popups':
      return Z_INDEX.POPUP_OVERLAY;
    case 'sidebar':
      return Z_INDEX.SIDEBAR;
    default:
      const _exhaustive: never = layer;
      return Z_INDEX.NOTES_CANVAS;
  }
};

// Helper to calculate popup z-index based on level and state
export const getPopupZIndex = (
  level: number,
  isDragging: boolean,
  useMultiLayer: boolean
): number => {
  if (!useMultiLayer) {
    // Legacy z-index calculation for backward compatibility
    return 9999 + level + (isDragging ? 1000 : 0);
  }
  
  // New layered z-index using design tokens
  const baseZ = Z_INDEX.POPUP_BASE;
  const levelOffset = level * Z_INDEX.POPUP_LEVEL_INCREMENT;
  const dragBoost = isDragging ? Z_INDEX.POPUP_DRAGGING_BOOST : 0;
  
  return baseZ + levelOffset + dragBoost;
};
