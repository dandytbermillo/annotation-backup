/**
 * React hook for LayerManager integration
 * Provides layer management operations with React state updates
 */

import { createContext, createElement, useCallback, useContext, useEffect, useState } from 'react'
import type { ReactNode } from 'react'
import { getLayerManager, LayerManager } from '@/lib/canvas/layer-manager'
import { CanvasNode } from '@/lib/canvas/canvas-node'
import { debugLog } from '@/lib/utils/debug-logger'

const LayerManagerContext = createContext<LayerManager | null>(null)

export function LayerManagerProvider({ manager, children }: { manager: LayerManager; children: ReactNode }) {
  return createElement(LayerManagerContext.Provider, { value: manager }, children)
}

export interface UseLayerManagerReturn {
  /** Underlying manager instance (note-scoped when provided) */
  manager: LayerManager
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
  
  /** Get layer band info for UI controls */
  getLayerBandInfo: (nodeId: string) => ReturnType<LayerManager['getLayerBandInfo']>
  
  /** Force a re-render */
  forceUpdate: () => void
}

/**
 * Hook to use the LayerManager with React integration
 */
export function useLayerManager(): UseLayerManagerReturn {
  const [updateTrigger, setUpdateTrigger] = useState(0)
  const forceUpdate = useCallback(() => setUpdateTrigger(prev => prev + 1), [])

  const contextManager = useContext(LayerManagerContext)
  // Fallback to singleton for legacy consumers
  const manager = contextManager ?? getLayerManager()
  const isLayerModelEnabled = true

  // Wrapped operations that trigger React updates
  const registerNode = useCallback((node: Partial<CanvasNode> & { id: string; type: 'panel' | 'component' }) => {
    if (!manager) return undefined
    const result = manager.registerNode(node)
    forceUpdate()
    return result
  }, [manager, forceUpdate])

  const getNode = useCallback((id: string) => {
    if (!manager) return undefined
    return manager.getNode(id)
  }, [manager])

  const getNodes = useCallback(() => {
    if (!manager) return new Map<string, CanvasNode>()
    return manager.getNodes()
  }, [manager])

  const updateNode = useCallback((id: string, updates: Partial<CanvasNode>) => {
    if (!manager) return
    manager.updateNode(id, updates)
    forceUpdate()
  }, [manager, forceUpdate])

  const bringToFront = useCallback((id: string) => {
    if (!manager) return
    manager.bringToFront(id)
    forceUpdate()
  }, [manager, forceUpdate])

  const bringSelectionToFront = useCallback((ids: string[]) => {
    if (!manager) return
    manager.bringSelectionToFront(ids)
    forceUpdate()
  }, [manager, forceUpdate])

  const focusNode = useCallback((id: string) => {
    if (!manager) return
    manager.focusNode(id)
    forceUpdate()
  }, [manager, forceUpdate])

  const sendToBack = useCallback((id: string) => {
    if (!manager) return
    manager.sendToBack(id)
    forceUpdate()
  }, [manager, forceUpdate])

  const removeNode = useCallback((id: string) => {
    if (!manager) return
    manager.removeNode(id)
    forceUpdate()
  }, [manager, forceUpdate])

  const getOrderedNodes = useCallback(() => {
    if (!manager) return []
    return manager.getOrderedNodes()
  }, [manager, updateTrigger]) // Include trigger to get fresh data

  const getLayerBandInfo = useCallback((nodeId: string) => {
    if (!manager) return null
    return manager.getLayerBandInfo(nodeId)
  }, [manager, updateTrigger]) // Include trigger for fresh data

  useEffect(() => {
    if (typeof window !== 'undefined') {
      ;(window as any).__canvasModel = 'multi-layer'
    }

    debugLog({
      component: 'LayerManagerHook',
      action: 'state_change',
      metadata: {
        isLayerModelEnabled,
        source: 'permanent_enable',
      },
    }).catch(() => {})
  }, [])

  return {
    manager,
    isEnabled: isLayerModelEnabled,
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
    getLayerBandInfo,
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
      // Using layerManager from closure, not from deps
      layerManager.removeNode(id)
      console.log(`[LayerManager] Removed node ${id} on unmount`)
    }
    // Only re-run if id, type, or enabled status changes, not on every render
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id, type, layerManager.isEnabled])
  
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
