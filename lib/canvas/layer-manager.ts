/**
 * LayerManager - Centralized layer/z-index management for canvas nodes
 * Provides consistent ordering, multi-select operations, and persistence
 */

import { CanvasNode, Z_INDEX_BANDS } from './canvas-node'

export class LayerManager {
  private nodes: Map<string, CanvasNode>
  private maxZ: number
  private schemaVersion: number = 1

  constructor() {
    this.nodes = new Map()
    this.maxZ = Z_INDEX_BANDS.CONTENT_MIN
  }

  /**
   * Register a new node or update existing
   */
  registerNode(nodeData: Partial<CanvasNode> & { id: string; type: 'panel' | 'component' }): CanvasNode {
    const existing = this.nodes.get(nodeData.id)
    
    const node: CanvasNode = {
      id: nodeData.id,
      type: nodeData.type,
      position: nodeData.position || existing?.position || { x: 0, y: 0 },
      zIndex: nodeData.zIndex ?? existing?.zIndex ?? this.getNextZIndex(nodeData.pinned),
      createdAt: nodeData.createdAt || existing?.createdAt || Date.now(),
      lastFocusedAt: nodeData.lastFocusedAt || existing?.lastFocusedAt || Date.now(),
      pinned: nodeData.pinned || false,
      pinnedPriority: nodeData.pinnedPriority,
      metadata: nodeData.metadata || existing?.metadata
    }

    this.nodes.set(node.id, node)
    this.updateMaxZ()
    
    return node
  }

  /**
   * Get a node by ID
   */
  getNode(id: string): CanvasNode | undefined {
    return this.nodes.get(id)
  }

  /**
   * Get all nodes
   */
  getNodes(): Map<string, CanvasNode> {
    return new Map(this.nodes)
  }

  /**
   * Update a node's properties
   */
  updateNode(id: string, updates: Partial<CanvasNode>): void {
    const node = this.nodes.get(id)
    if (!node) {
      console.warn(`[LayerManager] Node ${id} not found`)
      return
    }

    // Don't allow changing id or type
    const { id: _id, type: _type, ...safeUpdates } = updates
    
    Object.assign(node, safeUpdates)
    
    if (updates.zIndex !== undefined) {
      this.updateMaxZ()
    }
  }

  /**
   * Bring a node to the front of its layer band
   */
  bringToFront(id: string): void {
    const node = this.nodes.get(id)
    if (!node || node.pinned) return // Pinned nodes don't move
    
    // Get next z-index (may trigger renumbering)
    const newZ = this.getNextZIndex(false)
    node.zIndex = newZ
    node.lastFocusedAt = Date.now()
    // maxZ is updated by getNextZIndex or renumbering
  }

  /**
   * Bring multiple nodes to front while preserving their relative order
   */
  bringSelectionToFront(ids: string[]): void {
    // Filter to valid, non-pinned nodes
    const nodes = ids
      .map(id => this.nodes.get(id))
      .filter((node): node is CanvasNode => !!node && !node.pinned)
    
    if (nodes.length === 0) return
    
    // Sort by current z-index to preserve relative order
    nodes.sort((a, b) => a.zIndex - b.zIndex)
    
    // Check if we have room for all nodes
    const roomNeeded = nodes.length
    const roomAvailable = Z_INDEX_BANDS.CONTENT_MAX - this.maxZ
    
    if (roomNeeded > roomAvailable) {
      // Not enough room, renumber first
      console.log('[LayerManager] Renumbering before multi-select bring to front')
      this.renumberContentNodes()
      this.updateMaxZ()
    }
    
    // Assign new z-indices maintaining order
    let nextZ = this.maxZ + 1
    nodes.forEach(node => {
      node.zIndex = nextZ++
      node.lastFocusedAt = Date.now()
    })
    
    this.maxZ = nextZ - 1
  }

  /**
   * Focus a node (updates timestamp and brings to front unless pinned)
   */
  focusNode(id: string): void {
    const node = this.nodes.get(id)
    if (!node) return
    
    node.lastFocusedAt = Date.now()
    
    if (!node.pinned) {
      this.bringToFront(id)
    }
  }

  /**
   * Send a node to the back of its layer band
   */
  sendToBack(id: string): void {
    const node = this.nodes.get(id)
    if (!node || node.pinned) return
    
    const contentNodes = Array.from(this.nodes.values()).filter(n => !n.pinned)
    
    // If this is the only content node, just pin it to the band minimum
    if (contentNodes.length <= 1) {
      node.zIndex = Z_INDEX_BANDS.CONTENT_MIN
      node.lastFocusedAt = Date.now()
      this.updateMaxZ()
      return
    }
    
    const otherNodes = contentNodes.filter(n => n.id !== id)
    const minOtherZ = Math.min(...otherNodes.map(n => n.zIndex))
    
    if (node.zIndex <= minOtherZ || minOtherZ <= Z_INDEX_BANDS.CONTENT_MIN) {
      // Not enough room at the bottom; renumber and place this node there
      node.zIndex = Z_INDEX_BANDS.CONTENT_MIN - 1 // temporary marker to make it the lowest
      this.renumberContentNodes()
      this.updateMaxZ()
      node.lastFocusedAt = Date.now()
      return
    }
    
    node.zIndex = Math.max(Z_INDEX_BANDS.CONTENT_MIN, minOtherZ - 1)
    node.lastFocusedAt = Date.now()
    this.updateMaxZ()
  }

  /**
   * Get ordered list of nodes (for rendering/debugging)
   * Order: Pinned first (by priority desc), then non-pinned (by z-index desc)
   */
  getOrderedNodes(): CanvasNode[] {
    return Array.from(this.nodes.values()).sort((a, b) => {
      // FIXED: Pinned nodes FIRST (negative return value sorts first)
      if (a.pinned && !b.pinned) return -1  // a is pinned, b is not -> a first
      if (!a.pinned && b.pinned) return 1   // b is pinned, a is not -> b first
      
      // Within pinned, sort by priority (descending) then creation
      if (a.pinned && b.pinned) {
        if (a.pinnedPriority !== b.pinnedPriority) {
          return (b.pinnedPriority || 0) - (a.pinnedPriority || 0)  // Higher priority first
        }
        return a.createdAt - b.createdAt  // Older first
      }
      
      // FIXED: Non-pinned: sort by z-index DESCENDING (highest on top)
      if (a.zIndex !== b.zIndex) {
        return b.zIndex - a.zIndex  // Higher z-index first
      }
      
      // Tiebreaker: most recently focused first
      return b.lastFocusedAt - a.lastFocusedAt  // More recent first
    })
  }

  /**
   * Serialize nodes for persistence
   */
  serializeNodes(): {
    schemaVersion: number
    nodes: CanvasNode[]
    maxZ: number
  } {
    return {
      schemaVersion: this.schemaVersion,
      nodes: Array.from(this.nodes.values()),
      maxZ: this.maxZ
    }
  }

  /**
   * Deserialize nodes from storage
   */
  deserializeNodes(data: {
    schemaVersion?: number
    nodes: CanvasNode[]
    maxZ?: number
  }): void {
    this.nodes.clear()
    
    // Load nodes with validation
    data.nodes.forEach(node => {
      // Validate and clamp z-index to appropriate band
      if (node.pinned) {
        node.zIndex = Math.min(
          Math.max(node.zIndex, Z_INDEX_BANDS.PINNED_MIN),
          Z_INDEX_BANDS.PINNED_MAX
        )
      } else {
        node.zIndex = Math.min(
          Math.max(node.zIndex, Z_INDEX_BANDS.CONTENT_MIN),
          Z_INDEX_BANDS.CONTENT_MAX
        )
      }
      
      this.nodes.set(node.id, node)
    })
    
    // Recompute maxZ to ensure consistency
    this.updateMaxZ()
  }

  /**
   * Remove a node
   */
  removeNode(id: string): void {
    this.nodes.delete(id)
  }

  /**
   * Clear all nodes
   */
  clear(): void {
    this.nodes.clear()
    this.maxZ = Z_INDEX_BANDS.CONTENT_MIN
  }

  /**
   * Get next available z-index (with automatic renumbering on saturation)
   */
  private getNextZIndex(pinned?: boolean): number {
    if (pinned) {
      // Find max in pinned band
      const pinnedNodes = Array.from(this.nodes.values()).filter(n => n.pinned)
      if (pinnedNodes.length === 0) return Z_INDEX_BANDS.PINNED_MIN
      
      const maxPinnedZ = Math.max(...pinnedNodes.map(n => n.zIndex))
      const nextZ = maxPinnedZ + 1
      
      // Check for saturation and renumber if needed
      if (nextZ > Z_INDEX_BANDS.PINNED_MAX) {
        this.renumberPinnedNodes()
        return this.getMaxPinnedZ() + 1
      }
      
      return nextZ
    } else {
      // Check if we need to renumber due to saturation
      const nextZ = this.maxZ + 1
      
      if (nextZ > Z_INDEX_BANDS.CONTENT_MAX) {
        console.log('[LayerManager] Z-index saturated, renumbering content nodes...')
        this.renumberContentNodes()
        // After renumbering, get the new max
        this.updateMaxZ()
        const newZ = Math.min(this.maxZ + 1, Z_INDEX_BANDS.CONTENT_MAX)
        this.maxZ = newZ
        return newZ
      }
      
      this.maxZ = nextZ
      return nextZ
    }
  }
  
  /**
   * Renumber content nodes to free up z-index space
   */
  private renumberContentNodes(): void {
    const contentNodes = Array.from(this.nodes.values())
      .filter(n => !n.pinned)
      .sort((a, b) => {
        // Intentional ascending sort: keep existing stack order before reassigning z
        if (a.zIndex !== b.zIndex) return a.zIndex - b.zIndex
        return a.lastFocusedAt - b.lastFocusedAt
      })
    
    if (contentNodes.length === 0) return
    
    // Distribute evenly across half the range to leave room for growth
    const rangeSize = Z_INDEX_BANDS.CONTENT_MAX - Z_INDEX_BANDS.CONTENT_MIN
    const step = Math.floor(rangeSize / (contentNodes.length * 2)) || 1
    
    let currentZ = Z_INDEX_BANDS.CONTENT_MIN
    contentNodes.forEach(node => {
      node.zIndex = currentZ
      currentZ += step
    })
    
    console.log(`[LayerManager] Renumbered ${contentNodes.length} content nodes`)
  }
  
  /**
   * Renumber pinned nodes to free up z-index space
   */
  private renumberPinnedNodes(): void {
    const pinnedNodes = Array.from(this.nodes.values())
      .filter(n => n.pinned)
      .sort((a, b) => {
        // Intentional ascending sort: keep pinned order stable during renumber
        if (a.pinnedPriority !== b.pinnedPriority) {
          return (a.pinnedPriority || 0) - (b.pinnedPriority || 0)
        }
        return a.zIndex - b.zIndex
      })
    
    if (pinnedNodes.length === 0) return
    
    // Distribute across the pinned range
    const rangeSize = Z_INDEX_BANDS.PINNED_MAX - Z_INDEX_BANDS.PINNED_MIN
    const step = Math.floor(rangeSize / (pinnedNodes.length * 2)) || 1
    
    let currentZ = Z_INDEX_BANDS.PINNED_MIN
    pinnedNodes.forEach(node => {
      node.zIndex = currentZ
      currentZ += step
    })
    
    console.log(`[LayerManager] Renumbered ${pinnedNodes.length} pinned nodes`)
  }
  
  /**
   * Get max z-index in pinned band
   */
  private getMaxPinnedZ(): number {
    const pinnedNodes = Array.from(this.nodes.values()).filter(n => n.pinned)
    if (pinnedNodes.length === 0) return Z_INDEX_BANDS.PINNED_MIN - 1
    return Math.max(...pinnedNodes.map(n => n.zIndex))
  }

  /**
   * Update the running maxZ value
   */
  private updateMaxZ(): void {
    const contentNodes = Array.from(this.nodes.values()).filter(n => !n.pinned)
    if (contentNodes.length === 0) {
      this.maxZ = Z_INDEX_BANDS.CONTENT_MIN
    } else {
      this.maxZ = Math.max(...contentNodes.map(n => n.zIndex))
    }
  }

  /**
   * Get information about layer bands and extremes for UI controls
   */
  getLayerBandInfo(nodeId: string): {
    isAtTop: boolean
    isAtBottom: boolean
    canMoveUp: boolean
    canMoveDown: boolean
    currentZ: number
    maxZ: number
    minZ: number
  } | null {
    const node = this.nodes.get(nodeId)
    if (!node) return null
    
    // Get all nodes in the same band (pinned or content)
    const sameTypeNodes = Array.from(this.nodes.values())
      .filter(n => n.pinned === node.pinned)
    
    if (sameTypeNodes.length === 0) {
      return null
    }
    
    const bandNodes = sameTypeNodes
      .slice()
      .sort((a, b) => {
        if (a.zIndex !== b.zIndex) return a.zIndex - b.zIndex
        if ((a.lastFocusedAt ?? 0) !== (b.lastFocusedAt ?? 0)) {
          return (a.lastFocusedAt ?? 0) - (b.lastFocusedAt ?? 0)
        }
        if ((a.createdAt ?? 0) !== (b.createdAt ?? 0)) {
          return (a.createdAt ?? 0) - (b.createdAt ?? 0)
        }
        return a.id.localeCompare(b.id)
      })
    
    const indexInBand = bandNodes.findIndex(n => n.id === nodeId)
    if (indexInBand === -1) {
      console.warn(`[LayerManager] getLayerBandInfo: node ${nodeId} missing from band ordering`)
      return null
    }
    
    const minNode = bandNodes[0] ?? node
    const maxNode = bandNodes[bandNodes.length - 1] ?? node
    
    return {
      isAtTop: indexInBand === bandNodes.length - 1,
      isAtBottom: indexInBand === 0,
      canMoveUp: indexInBand < bandNodes.length - 1,
      canMoveDown: indexInBand > 0,
      currentZ: node.zIndex,
      maxZ: maxNode.zIndex,
      minZ: minNode.zIndex
    }
  }

  /**
   * Debug helper - expose to window in development
   */
  debugLayers(): {
    nodes: CanvasNode[]
    maxZ: number
    bands: typeof Z_INDEX_BANDS
  } {
    return {
      nodes: this.getOrderedNodes(),
      maxZ: this.maxZ,
      bands: Z_INDEX_BANDS
    }
  }
}

// Singleton instance
let layerManagerInstance: LayerManager | null = null

/**
 * Get or create the LayerManager singleton
 */
export function getLayerManager(): LayerManager {
  if (!layerManagerInstance) {
    layerManagerInstance = new LayerManager()
    
    // Expose debug helper in development
    if (typeof window !== 'undefined' && process.env.NODE_ENV === 'development') {
      (window as any).debugCanvasLayers = () => layerManagerInstance?.debugLayers()
    }
  }
  
  return layerManagerInstance
}

/**
 * Reset the LayerManager (useful for testing)
 */
export function resetLayerManager(): void {
  layerManagerInstance = null
}
