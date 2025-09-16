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
    
    // Get next z-index and update
    const newZ = this.getNextZIndex(false)
    node.zIndex = newZ
    node.lastFocusedAt = Date.now()
    this.maxZ = newZ
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
    
    // Assign new z-indices maintaining order
    let nextZ = this.getNextZIndex(false)
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
    
    // Find minimum z-index in content band
    const contentNodes = Array.from(this.nodes.values())
      .filter(n => !n.pinned && n.id !== id)
    
    const minZ = contentNodes.length > 0
      ? Math.min(...contentNodes.map(n => n.zIndex))
      : Z_INDEX_BANDS.CONTENT_MIN
    
    node.zIndex = Math.max(Z_INDEX_BANDS.CONTENT_MIN, minZ - 1)
    node.lastFocusedAt = Date.now()
  }

  /**
   * Get ordered list of nodes (for rendering/debugging)
   */
  getOrderedNodes(): CanvasNode[] {
    return Array.from(this.nodes.values()).sort((a, b) => {
      // Pinned nodes first
      if (a.pinned && !b.pinned) return 1
      if (!a.pinned && b.pinned) return -1
      
      // Within pinned, sort by priority then creation
      if (a.pinned && b.pinned) {
        if (a.pinnedPriority !== b.pinnedPriority) {
          return (b.pinnedPriority || 0) - (a.pinnedPriority || 0)
        }
        return a.createdAt - b.createdAt
      }
      
      // Non-pinned: sort by z-index
      if (a.zIndex !== b.zIndex) {
        return a.zIndex - b.zIndex
      }
      
      // Tiebreaker: last focused
      return a.lastFocusedAt - b.lastFocusedAt
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
   * Get next available z-index
   */
  private getNextZIndex(pinned?: boolean): number {
    if (pinned) {
      // Find max in pinned band
      const pinnedNodes = Array.from(this.nodes.values()).filter(n => n.pinned)
      if (pinnedNodes.length === 0) return Z_INDEX_BANDS.PINNED_MIN
      
      const maxPinnedZ = Math.max(...pinnedNodes.map(n => n.zIndex))
      return Math.min(maxPinnedZ + 1, Z_INDEX_BANDS.PINNED_MAX)
    } else {
      // Use running maxZ for content band
      return Math.min(this.maxZ + 1, Z_INDEX_BANDS.CONTENT_MAX)
    }
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