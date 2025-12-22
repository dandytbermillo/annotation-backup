"use client"

import React, { useRef, useState, useEffect, useCallback } from 'react'
import { X, Minimize2, Maximize2, Lock, Unlock } from 'lucide-react'
import { Calculator } from './components/calculator'
import { Timer } from './components/timer'
import { StickyNote } from './components/sticky-note'
import { DragTest } from './components/drag-test'
import { PerformanceTest } from './components/performance-test'
import { useAutoScroll } from './use-auto-scroll'
import { useCanvas } from './canvas-context'
import { useIsolation, useRegisterWithIsolation } from '@/lib/isolation/context'
import { Z_INDEX } from '@/lib/constants/z-index'
import { useCanvasCamera } from '@/lib/hooks/use-canvas-camera'
import { useLayerManager, useCanvasNode } from '@/lib/hooks/use-layer-manager'
import type { ComponentType } from '@/types/canvas-items'
import { debugLog } from '@/lib/utils/debug-logger'

interface ComponentPanelProps {
  id: string
  type: ComponentType
  position: { x: number; y: number }
  workspaceId?: string | null
  initialState?: any
  onClose?: (id: string) => void
  onPositionChange?: (id: string, position: { x: number; y: number }) => void
  onStateChange?: (id: string, state: any) => void
}

// Global variable to track which component is currently being dragged
let globalDraggingComponentId: string | null = null

export function ComponentPanel({ id, type, position, workspaceId, initialState, onClose, onPositionChange, onStateChange }: ComponentPanelProps) {
  const panelRef = useRef<HTMLDivElement>(null)
  const [isMinimized, setIsMinimized] = useState(false)
  const [componentState, setComponentState] = useState(initialState ?? {})

  // DEBUG: Log workspaceId received by ComponentPanel
  useEffect(() => {
    void debugLog({
      component: 'ComponentPanelDiagnostic',
      action: 'component_panel_workspaceId_check',
      metadata: {
        id,
        type,
        workspaceId: workspaceId ?? 'NULL',
        workspaceIdTruthy: !!workspaceId,
      },
    })
  }, [id, type, workspaceId])

  useEffect(() => {
    setComponentState(initialState ?? {})
  }, [initialState])

  // Notify parent when component state changes (for persistence to canvas items)
  const handleStateUpdate = useCallback((newState: any) => {
    setComponentState(newState)
    onStateChange?.(id, newState)
  }, [id, onStateChange])
  const { isIsolated, level, placeholder } = useIsolation(id)
  // Register with isolation manager for heuristic metrics
  useRegisterWithIsolation(id, panelRef as any, type === 'sticky-note' ? 'high' : 'normal', type)
  
  // Layer management integration
  const layerManager = useLayerManager()
  const { node: canvasNode } = useCanvasNode(id, 'component', position)

  useEffect(() => {
    if (!layerManager.isEnabled) return
    const existing = layerManager.getNode(id)
    if (!existing) return
    const previousMetadata = (existing.metadata as Record<string, unknown>) ?? {}
    if (previousMetadata.componentType === type) return
    layerManager.updateNode(id, {
      metadata: {
        ...previousMetadata,
        componentType: type,
      },
    })
  }, [id, type, layerManager])
  
  // State to track render position and prevent snap-back during drag
  const [renderPosition, setRenderPosition] = useState(position)
  
  // Update render position when position prop changes (but not during drag)
  const dragStateRef = useRef<any>(null) // Will be set to dragState later
  useEffect(() => {
    if (!dragStateRef.current?.isDragging) {
      // Use LayerManager position if available, otherwise fall back to prop
      const nodePosition = canvasNode?.position ?? position
      setRenderPosition(nodePosition)
    }
  }, [position, canvasNode?.position])
  
  // Canvas context for disabling transition during drag
  const { dispatch } = useCanvas()

  // Camera-based panning
  const {
    panCameraBy,
    resetPanAccumulation,
    getPanAccumulation,
    isCameraEnabled
  } = useCanvasCamera()
  
  
  // Simplified drag state - no RAF accumulation
  const dragState = useRef({
    isDragging: false,
    startX: 0,
    startY: 0,
    initialPosition: { x: position.x, y: position.y },
    pointerDelta: { x: 0, y: 0 },
    autoScrollOffset: { x: 0, y: 0 },
  })
  
  // Link dragStateRef to dragState for the useEffect above
  dragStateRef.current = dragState.current
  
  // Auto-scroll functionality for component dragging
  const handleAutoScroll = useCallback((deltaX: number, deltaY: number) => {
    if (!dragState.current.isDragging) return
    
    if (isCameraEnabled) {
      // Use camera-based panning (pan opposite to pointer delta)
      panCameraBy({ dxScreen: -deltaX, dyScreen: -deltaY })

      const state = dragState.current
      state.autoScrollOffset.x += deltaX
      state.autoScrollOffset.y += deltaY

      if (state.isDragging && panelRef.current) {
        const { pointerDelta, initialPosition, autoScrollOffset } = state
        const nextLeft = initialPosition.x + pointerDelta.x - autoScrollOffset.x
        const nextTop = initialPosition.y + pointerDelta.y - autoScrollOffset.y

        panelRef.current.style.left = `${nextLeft}px`
        panelRef.current.style.top = `${nextTop}px`
        setRenderPosition({ x: nextLeft, y: nextTop })
      }
    } else {
      // Legacy: Move ALL panels and components to simulate canvas panning
      const allPanels = document.querySelectorAll('[data-panel-id]')
      const allComponents = document.querySelectorAll('[data-component-panel]')
      
      // Update panels
      allPanels.forEach(panel => {
        const panelEl = panel as HTMLElement
        const currentLeft = parseInt(panelEl.style.left || '0', 10)
        const currentTop = parseInt(panelEl.style.top || '0', 10)
        panelEl.style.left = (currentLeft + deltaX) + 'px'
        panelEl.style.top = (currentTop + deltaY) + 'px'
      })
      
      // Update components
      allComponents.forEach(component => {
        const componentEl = component as HTMLElement
        
        if (componentEl.id === `component-${id}` && dragState.current.isDragging) {
          // For the dragging component, update its initial position
          dragState.current.initialPosition.x += deltaX
          dragState.current.initialPosition.y += deltaY
        } else {
          // For other components, update their actual position
          const currentLeft = parseInt(componentEl.style.left || '0', 10)
          const currentTop = parseInt(componentEl.style.top || '0', 10)
          componentEl.style.left = (currentLeft + deltaX) + 'px'
          componentEl.style.top = (currentTop + deltaY) + 'px'
        }
      })
    }
  }, [id, isCameraEnabled, panCameraBy])
  
  const { checkAutoScroll, stopAutoScroll } = useAutoScroll({
    enabled: true,
    threshold: 80,
    speedPxPerSec: 480,
    onScroll: handleAutoScroll,
    containerId: 'canvas-container' // Use container-relative edge detection for embedded canvas
  })
  
  
  // Handle dragging
  useEffect(() => {
    const panel = panelRef.current
    if (!panel) return
    
    const header = panel.querySelector('.component-header') as HTMLElement
    if (!header) return
    
    const handleMouseDown = (e: MouseEvent) => {
      // Don't start dragging if clicking on any button or controls
      const target = e.target instanceof Element ? e.target : null
      if (target && (target.closest('button') || target.closest('.component-controls'))) return
      
      // Stop propagation to prevent canvas from dragging
      e.stopPropagation()
      e.preventDefault()
      
      dragState.current.isDragging = true
      globalDraggingComponentId = id

      // Disable canvas transition during component drag for snappy auto-scroll
      dispatch({ type: 'SET_CANVAS_STATE', payload: { isDragging: true } })
      
      const currentLeft = parseInt(panel.style.left || position.x.toString(), 10)
      const currentTop = parseInt(panel.style.top || position.y.toString(), 10)
      
      dragState.current.initialPosition = { x: currentLeft, y: currentTop }
      dragState.current.startX = e.clientX
      dragState.current.startY = e.clientY
      dragState.current.pointerDelta = { x: 0, y: 0 }
      dragState.current.autoScrollOffset = { x: 0, y: 0 }
      
      // Update render position to current position when starting drag
      setRenderPosition({ x: currentLeft, y: currentTop })
      
      // Prepare for dragging
      panel.style.transition = 'none'
      // Always use LayerManager for focus/z-index management
      layerManager.focusNode(id) // This brings to front and updates focus time
      
      document.body.style.userSelect = 'none'
      document.body.style.cursor = 'move'
    }
    
    const handleMouseMove = (e: MouseEvent) => {
      // Only handle move if this specific component is being dragged
      if (!dragState.current.isDragging || globalDraggingComponentId !== id) return
      
      // Prevent canvas from also handling this
      e.stopPropagation()
      e.preventDefault()
      
      // Check for auto-scroll when near edges
      checkAutoScroll(e.clientX, e.clientY)
      
      // Direct position update - no RAF accumulation
      const state = dragState.current
      const deltaX = e.clientX - state.startX
      const deltaY = e.clientY - state.startY

      state.pointerDelta = { x: deltaX, y: deltaY }

      const baseX = state.initialPosition.x + deltaX
      const baseY = state.initialPosition.y + deltaY
      const newLeft = isCameraEnabled ? baseX - state.autoScrollOffset.x : baseX
      const newTop = isCameraEnabled ? baseY - state.autoScrollOffset.y : baseY
      
      // Update render position to prevent snap-back during drag
      setRenderPosition({ x: newLeft, y: newTop })
      
      panel.style.left = newLeft + 'px'
      panel.style.top = newTop + 'px'
      
      e.preventDefault()
    }
    
    const handleMouseUp = (e: MouseEvent) => {
      // Only handle if this component is being dragged
      if (!dragState.current.isDragging || globalDraggingComponentId !== id) return
      
      // Stop propagation to prevent canvas from handling
      e.stopPropagation()
      e.preventDefault()
      
      globalDraggingComponentId = null
      
      // Stop auto-scroll
      stopAutoScroll()
      
      dragState.current.isDragging = false

      // Re-enable canvas transition after drag ends
      dispatch({ type: 'SET_CANVAS_STATE', payload: { isDragging: false } })

      // Get final position from current style
      const finalX = parseInt(panel.style.left, 10)
      const finalY = parseInt(panel.style.top, 10)
      
      // Update position in LayerManager if enabled
      // Update position through LayerManager
      layerManager.updateNode(id, { position: { x: finalX, y: finalY } })
      
      // Update render position to final position
      setRenderPosition({ x: finalX, y: finalY })
      
      onPositionChange?.(id, { x: finalX, y: finalY })
      
      // Reset camera pan accumulation if using camera mode
      if (isCameraEnabled) {
        resetPanAccumulation()
      }

      dragState.current.pointerDelta = { x: 0, y: 0 }
      dragState.current.autoScrollOffset = { x: 0, y: 0 }
      
      document.body.style.userSelect = ''
      document.body.style.cursor = ''
      
      e.preventDefault()
    }
    
    // Use capture phase to ensure we handle events first
    header.addEventListener('mousedown', handleMouseDown, true)
    document.addEventListener('mousemove', handleMouseMove, true)
    document.addEventListener('mouseup', handleMouseUp, true)
    
    return () => {
      header.removeEventListener('mousedown', handleMouseDown, true)
      document.removeEventListener('mousemove', handleMouseMove, true)
      document.removeEventListener('mouseup', handleMouseUp, true)
      
      
      // Clear global dragging ID if this component was being dragged
      if (globalDraggingComponentId === id) {
        globalDraggingComponentId = null
      }
      
      document.body.style.userSelect = ''
      document.body.style.cursor = ''
    }
  }, [position, onPositionChange, id, checkAutoScroll, stopAutoScroll, isCameraEnabled, resetPanAccumulation, dispatch])
  
  const renderComponent = () => {
    switch (type) {
      case 'calculator':
        // Phase 3 Unification: Pass position to component for runtime ledger registration
        return <Calculator componentId={id} workspaceId={workspaceId} position={renderPosition} state={componentState} onStateUpdate={handleStateUpdate} />
      case 'timer':
        // Phase 3 Unification: Pass position to component for runtime ledger registration
        return <Timer componentId={id} workspaceId={workspaceId} position={renderPosition} state={componentState} onStateUpdate={handleStateUpdate} />
      case 'sticky-note':
        // Phase 5: Pass workspaceId and position for store integration
        return <StickyNote componentId={id} workspaceId={workspaceId} position={renderPosition} state={componentState} onStateUpdate={handleStateUpdate} />
      case 'dragtest':
        return <DragTest componentId={id} state={componentState} onStateUpdate={handleStateUpdate} />
      case 'perftest':
        return <PerformanceTest componentId={id} />
      default:
        return <div className="p-4 text-white">Unknown component type</div>
    }
  }
  
  const getComponentColor = () => {
    switch (type) {
      case 'calculator': return 'from-blue-600 to-blue-700'
      case 'timer': return 'from-green-600 to-green-700'
      case 'sticky-note': return 'from-yellow-500 to-yellow-600'
      case 'dragtest': return 'from-orange-600 to-orange-700'
      case 'perftest': return 'from-red-600 to-red-700'
      default: return 'from-gray-600 to-gray-700'
    }
  }
  
  const getComponentTitle = () => {
    switch (type) {
      case 'calculator': return 'Calculator'
      case 'timer': return 'Timer'
      case 'sticky-note': return 'Sticky Note'
      case 'dragtest': return 'Drag Test'
      case 'perftest': return 'Performance Test'
      default: return 'Component'
    }
  }
  
  return (
    <div
      ref={panelRef}
      id={`component-${id}`}
      data-component-panel
      className={`absolute bg-gray-800 rounded-lg shadow-2xl overflow-hidden ${
        isIsolated ? 'ring-2 ring-red-500' : ''
      }`}
      style={{
        left: `${renderPosition.x}px`,
        top: `${renderPosition.y}px`,
        width: '350px',
        minHeight: isMinimized ? '40px' : '300px',
        zIndex: canvasNode?.zIndex ?? Z_INDEX.CANVAS_NODE_BASE,
        backgroundColor: isIsolated ? '#2a1a1a' : '#1f2937',
        borderColor: isIsolated ? '#ef4444' : 'transparent',
        borderWidth: isIsolated ? '2px' : '0',
        borderStyle: 'solid'
      }}
      onMouseDown={(e) => e.stopPropagation()}
    >
      {/* Header */}
      <div 
        className={`component-header bg-gradient-to-r ${getComponentColor()} p-3 cursor-move flex items-center justify-between ${
          isIsolated ? 'ring-2 ring-red-500 ring-offset-2 ring-offset-gray-900' : ''
        }`}
      >
        <div className="flex items-center gap-2">
          <span className="text-white font-semibold text-sm select-none">
            {getComponentTitle()}
          </span>
          {isIsolated && (
            <span className="bg-red-500 text-white text-xs px-2 py-0.5 rounded-full uppercase font-bold">
              ISOLATED
            </span>
          )}
        </div>
        <div className="component-controls flex items-center gap-2">
          {/* Layer action buttons - only show when LayerManager is enabled */}
          {layerManager.isEnabled && (
            <>
              {/* Bring to Front button */}
              <button
                onClick={(e) => {
                  e.stopPropagation()
                  layerManager.bringToFront(id)
                }}
                disabled={layerManager.getLayerBandInfo(id)?.isAtTop}
                className={`${
                  layerManager.getLayerBandInfo(id)?.isAtTop 
                    ? 'text-white/30 cursor-not-allowed' 
                    : 'text-white/80 hover:text-white'
                } transition-colors`}
                title="Bring to front"
              >
                ↑
              </button>
              
              {/* Send to Back button */}
              <button
                onClick={(e) => {
                  e.stopPropagation()
                  layerManager.sendToBack(id)
                }}
                disabled={layerManager.getLayerBandInfo(id)?.isAtBottom}
                className={`${
                  layerManager.getLayerBandInfo(id)?.isAtBottom 
                    ? 'text-white/30 cursor-not-allowed' 
                    : 'text-white/80 hover:text-white'
                } transition-colors`}
                title="Send to back"
              >
                ↓
              </button>
            </>
          )}
          
          <button
            onClick={() => {
              const debug = (window as any).__isolationDebug
              if (debug) {
                if (isIsolated) {
                  debug.restore(id)
                  // Show debug table with before/after state
                  setTimeout(() => {
                    console.table([{ 
                      Action: 'Restore', 
                      ComponentID: id, 
                      Time: new Date().toLocaleTimeString(),
                      IsolatedList: debug.list().join(', ') || 'None',
                      FPS: debug.getFps().toFixed(1)
                    }])
                  }, 10)
                } else {
                  debug.isolate(id)
                  // Show debug table with before/after state
                  setTimeout(() => {
                    console.table([{ 
                      Action: 'Isolate', 
                      ComponentID: id, 
                      Time: new Date().toLocaleTimeString(),
                      IsolatedList: debug.list().join(', ') || 'None',
                      FPS: debug.getFps().toFixed(1)
                    }])
                  }, 10)
                }
              }
            }}
            className={`${
              isIsolated ? 'text-red-300 hover:text-red-100' : 'text-white/80 hover:text-white'
            } transition-colors`}
            title={isIsolated ? 'Restore component' : 'Isolate component'}
          >
            {isIsolated ? <Unlock size={16} /> : <Lock size={16} />}
          </button>
          <button
            onClick={() => setIsMinimized(!isMinimized)}
            className="text-white/80 hover:text-white transition-colors"
          >
            {isMinimized ? <Maximize2 size={16} /> : <Minimize2 size={16} />}
          </button>
          <button
            onClick={() => onClose?.(id)}
            className="text-white/80 hover:text-white transition-colors"
          >
            <X size={16} />
          </button>
        </div>
      </div>
      
      {/* Content */}
      {!isMinimized && (
        <div className="component-content">
          {isIsolated ? (
            <div className="p-4">
              {placeholder}
            </div>
          ) : (
            renderComponent()
          )}
        </div>
      )}
    </div>
  )
}
