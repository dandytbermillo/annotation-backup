/**
 * React hook for LayerManager integration
 * Provides layer management operations with React state updates
 */

import { useCallback, useEffect, useState } from 'react'
import { getLayerManager, LayerManager } from '@/lib/canvas/layer-manager'
import { CanvasNode } from '@/lib/canvas/canvas-node'
import { useFeatureFlag } from '@/lib/offline/feature-flags'

export interface UseLayerManagerReturn {
  /** Whether layer management is enabled */
  isEnabled: boolean
  
  /** Register or update a node */
  registerNode: (node: Partial<CanvasNode> & { id: string; type: 'panel' | 'component' }) => CanvasNode | undefined
  
  /** Get a specific node */
  getNode: (id: string) => CanvasNode | undefined
  
  /** Get all nodes */
  getNodes: () => Map<string, CanvasNode>
  
  /** Update node properties */
  updateNode: (id: string, updates: Partial<CanvasNode>) => void
  
  /** Bring node to front */
  bringToFront: (id: string) => void
  
  /** Bring multiple nodes to front */
  bringSelectionToFront: (ids: string[]) => void
  
  /** Focus a node */
  focusNode: (id: string) => void
  
  /** Send node to back */
  sendToBack: (id: string) => void
  
  /** Remove a node */
  removeNode: (id: string) => void
  
  /** Get ordered nodes for rendering */
  getOrderedNodes: () => CanvasNode[]
  
  /** Force a re-render */
  forceUpdate: () => void
}

/**
 * Hook to use the LayerManager with React integration
 */
export function useLayerManager(): UseLayerManagerReturn {
  // Feature flag to enable/disable layer management
  // LayerManager enabled by default; set NEXT_PUBLIC_LAYER_MODEL=0 to disable
  const isEnabled = useFeatureFlag('ui.layerModel' as any) ||
                    process.env.NEXT_PUBLIC_LAYER_MODEL !== '0'
  
  const [updateTrigger, setUpdateTrigger] = useState(0)
  const forceUpdate = useCallback(() => setUpdateTrigger(prev => prev + 1), [])
  
  // Get the singleton LayerManager
  const manager = isEnabled ? getLayerManager() : null
  
  // Wrapped operations that trigger React updates
  const registerNode = useCallback((node: Partial<CanvasNode> & { id: string; type: 'panel' | 'component' }) => {
    if (!manager || !isEnabled) return undefined
    const result = manager.registerNode(node)
    forceUpdate()
    return result
  }, [manager, isEnabled, forceUpdate])
  
  const getNode = useCallback((id: string) => {
    if (!manager || !isEnabled) return undefined
    return manager.getNode(id)
  }, [manager, isEnabled])
  
  const getNodes = useCallback(() => {
    if (!manager || !isEnabled) return new Map<string, CanvasNode>()
    return manager.getNodes()
  }, [manager, isEnabled])
  
  const updateNode = useCallback((id: string, updates: Partial<CanvasNode>) => {
    if (!manager || !isEnabled) return
    manager.updateNode(id, updates)
    forceUpdate()
  }, [manager, isEnabled, forceUpdate])
  
  const bringToFront = useCallback((id: string) => {
    if (!manager || !isEnabled) return
    manager.bringToFront(id)
    forceUpdate()
  }, [manager, isEnabled, forceUpdate])
  
  const bringSelectionToFront = useCallback((ids: string[]) => {
    if (!manager || !isEnabled) return
    manager.bringSelectionToFront(ids)
    forceUpdate()
  }, [manager, isEnabled, forceUpdate])
  
  const focusNode = useCallback((id: string) => {
    if (!manager || !isEnabled) return
    manager.focusNode(id)
    forceUpdate()
  }, [manager, isEnabled, forceUpdate])
  
  const sendToBack = useCallback((id: string) => {
    if (!manager || !isEnabled) return
    manager.sendToBack(id)
    forceUpdate()
  }, [manager, isEnabled, forceUpdate])
  
  const removeNode = useCallback((id: string) => {
    if (!manager || !isEnabled) return
    manager.removeNode(id)
    forceUpdate()
  }, [manager, isEnabled, forceUpdate])
  
  const getOrderedNodes = useCallback(() => {
    if (!manager || !isEnabled) return []
    return manager.getOrderedNodes()
  }, [manager, isEnabled, updateTrigger]) // Include trigger to get fresh data
  
  return {
    isEnabled,
    registerNode,
    getNode,
    getNodes,
    updateNode,
    bringToFront,
    bringSelectionToFront,
    focusNode,
    sendToBack,
    removeNode,
    getOrderedNodes,
    forceUpdate
  }
}

/**
 * Helper hook to get node data for a specific component
 */
export function useCanvasNode(id: string, type: 'panel' | 'component', initialPosition?: { x: number; y: number }) {
  const layerManager = useLayerManager()
  const [node, setNode] = useState<CanvasNode | undefined>()
  
  useEffect(() => {
    if (!layerManager.isEnabled) return
    
    // Register node on mount
    const registered = layerManager.registerNode({
      id,
      type,
      position: initialPosition || { x: 0, y: 0 }
    })
    
    setNode(registered)
    
    // CRITICAL: Remove node on unmount to prevent memory leak
    return () => {
      if (layerManager.isEnabled) {
        layerManager.removeNode(id)
        console.log(`[LayerManager] Removed node ${id} on unmount`)
      }
    }
  }, [id, type, layerManager.isEnabled, layerManager.removeNode])
  
  // Update local state when layer manager changes
  useEffect(() => {
    if (!layerManager.isEnabled) return
    
    const interval = setInterval(() => {
      const current = layerManager.getNode(id)
      if (current && (!node || current.zIndex !== node.zIndex || current.position !== node.position)) {
        setNode(current)
      }
    }, 100)
    
    return () => clearInterval(interval)
  }, [id, layerManager, node])
  
  return {
    node,
    layerManager,
    zIndex: node?.zIndex,
    position: node?.position
  }
}
