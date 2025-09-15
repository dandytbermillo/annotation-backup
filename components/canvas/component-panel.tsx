"use client"

import React, { useRef, useState, useEffect, useCallback } from 'react'
import { X, Minimize2, Maximize2, Lock, Unlock } from 'lucide-react'
import { Calculator } from './components/calculator'
import { Timer } from './components/timer'
import { TextEditor } from './components/text-editor'
import { DragTest } from './components/drag-test'
import { PerformanceTest } from './components/performance-test'
import { useAutoScroll } from './use-auto-scroll'
import { useIsolation, useRegisterWithIsolation } from '@/lib/isolation/context'

interface ComponentPanelProps {
  id: string
  type: 'calculator' | 'timer' | 'editor' | 'dragtest' | 'perftest'
  position: { x: number; y: number }
  onClose?: (id: string) => void
  onPositionChange?: (id: string, position: { x: number; y: number }) => void
}

// Global variable to track which component is currently being dragged
let globalDraggingComponentId: string | null = null

export function ComponentPanel({ id, type, position, onClose, onPositionChange }: ComponentPanelProps) {
  const panelRef = useRef<HTMLDivElement>(null)
  const [isMinimized, setIsMinimized] = useState(false)
  const [componentState, setComponentState] = useState({})
  const { isIsolated, level, placeholder } = useIsolation(id)
  // Register with isolation manager for heuristic metrics
  useRegisterWithIsolation(id, panelRef as any, type === 'editor' ? 'high' : 'normal', type)
  
  
  // Dragging state
  const dragState = useRef({
    isDragging: false,
    startX: 0,
    startY: 0,
    offsetX: 0,
    offsetY: 0,
    rafId: null as number | null,
    currentTransform: { x: 0, y: 0 },
    targetTransform: { x: 0, y: 0 },
    initialPosition: { x: position.x, y: position.y }
  })
  
  // Auto-scroll functionality for component dragging
  const handleAutoScroll = useCallback((deltaX: number, deltaY: number) => {
    if (!dragState.current.isDragging) return
    
    // Move ALL panels and components to simulate canvas panning
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
  }, [id])
  
  const { checkAutoScroll, stopAutoScroll } = useAutoScroll({
    enabled: true,
    threshold: 80,
    speed: 8,
    onScroll: handleAutoScroll
  })
  
  
  // Handle dragging
  useEffect(() => {
    const panel = panelRef.current
    if (!panel) return
    
    const header = panel.querySelector('.component-header') as HTMLElement
    if (!header) return
    
    const handleMouseDown = (e: MouseEvent) => {
      // Don't start dragging if clicking on controls
      if ((e.target as HTMLElement).closest('.component-controls')) return
      
      // Stop propagation to prevent canvas from dragging
      e.stopPropagation()
      e.preventDefault()
      
      dragState.current.isDragging = true
      globalDraggingComponentId = id
      
      const currentLeft = parseInt(panel.style.left || position.x.toString(), 10)
      const currentTop = parseInt(panel.style.top || position.y.toString(), 10)
      
      dragState.current.initialPosition = { x: currentLeft, y: currentTop }
      dragState.current.currentTransform = { x: 0, y: 0 }
      dragState.current.targetTransform = { x: 0, y: 0 }
      dragState.current.startX = e.clientX
      dragState.current.startY = e.clientY
      dragState.current.offsetX = e.clientX - currentLeft
      dragState.current.offsetY = e.clientY - currentTop
      
      // Enable GPU acceleration
      panel.style.willChange = 'transform'
      panel.style.transform = 'translate3d(0, 0, 0)'
      panel.style.transition = 'none'
      panel.style.zIndex = '1000'
      
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
      
      const deltaX = e.clientX - dragState.current.startX
      const deltaY = e.clientY - dragState.current.startY
      
      dragState.current.targetTransform = { x: deltaX, y: deltaY }
      
      // Use RAF for smooth updates
      if (!dragState.current.rafId) {
        dragState.current.rafId = requestAnimationFrame(() => {
          if (!dragState.current.isDragging) return
          
          const { x, y } = dragState.current.targetTransform
          panel.style.transform = `translate3d(${x}px, ${y}px, 0)`
          
          dragState.current.currentTransform = { x, y }
          dragState.current.rafId = null
        })
      }
      
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
      
      if (dragState.current.rafId) {
        cancelAnimationFrame(dragState.current.rafId)
        dragState.current.rafId = null
      }
      
      dragState.current.isDragging = false
      
      const finalX = dragState.current.initialPosition.x + dragState.current.currentTransform.x
      const finalY = dragState.current.initialPosition.y + dragState.current.currentTransform.y
      
      panel.style.left = finalX + 'px'
      panel.style.top = finalY + 'px'
      panel.style.transform = ''
      panel.style.willChange = 'auto'
      panel.style.zIndex = ''
      
      onPositionChange?.(id, { x: finalX, y: finalY })
      
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
      
      if (dragState.current.rafId) {
        cancelAnimationFrame(dragState.current.rafId)
      }
      
      // Clear global dragging ID if this component was being dragged
      if (globalDraggingComponentId === id) {
        globalDraggingComponentId = null
      }
      
      document.body.style.userSelect = ''
      document.body.style.cursor = ''
    }
  }, [position, onPositionChange, id, checkAutoScroll, stopAutoScroll])
  
  const renderComponent = () => {
    switch (type) {
      case 'calculator':
        return <Calculator componentId={id} state={componentState} onStateUpdate={setComponentState} />
      case 'timer':
        return <Timer componentId={id} state={componentState} onStateUpdate={setComponentState} />
      case 'editor':
        return <TextEditor componentId={id} state={componentState} onStateUpdate={setComponentState} />
      case 'dragtest':
        return <DragTest componentId={id} state={componentState} onStateUpdate={setComponentState} />
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
      case 'editor': return 'from-purple-600 to-purple-700'
      case 'dragtest': return 'from-orange-600 to-orange-700'
      case 'perftest': return 'from-red-600 to-red-700'
      default: return 'from-gray-600 to-gray-700'
    }
  }
  
  const getComponentTitle = () => {
    switch (type) {
      case 'calculator': return 'Calculator'
      case 'timer': return 'Timer'
      case 'editor': return 'Text Editor'
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
        left: `${position.x}px`,
        top: `${position.y}px`,
        width: '350px',
        minHeight: isMinimized ? '40px' : '300px',
        zIndex: 100,
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
