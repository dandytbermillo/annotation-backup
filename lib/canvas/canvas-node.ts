/**
 * Canvas Node Model - Unified representation for panels and components
 * Used for consistent layering, positioning, and persistence
 */

export interface CanvasNode {
  /** Unique identifier for the node */
  id: string
  
  /** Type of node - 'panel' for annotation panels, 'component' for widgets */
  type: 'panel' | 'component'
  
  /** Position in world coordinates */
  position: {
    x: number
    y: number
  }
  
  /** Z-index for layering (higher = on top) */
  zIndex: number
  
  /** Timestamp when node was created */
  createdAt: number
  
  /** Timestamp when node was last focused/interacted with */
  lastFocusedAt: number
  
  /** Optional: For pinned nodes that stay at fixed layers */
  pinned?: boolean
  
  /** Optional: Priority for pinned nodes (higher = more on top) */
  pinnedPriority?: number
  
  /** Optional: Additional metadata specific to node type */
  metadata?: Record<string, any>
}

export interface CanvasNodesState {
  /** All canvas nodes by ID */
  nodes: Map<string, CanvasNode>
  
  /** Maximum z-index currently in use (for efficient layer raises) */
  maxZ: number
  
  /** Schema version for migrations */
  schemaVersion: number
}

/** Reserved z-index bands */
export const Z_INDEX_BANDS = {
  /** Reserved for pinned/system components (1000-1999) */
  PINNED_MIN: 1000,
  PINNED_MAX: 1999,
  
  /** Normal content range (100-999) */
  CONTENT_MIN: 100,
  CONTENT_MAX: 999,
  
  /** Dragging item temporary boost */
  DRAGGING: 2000,
} as const