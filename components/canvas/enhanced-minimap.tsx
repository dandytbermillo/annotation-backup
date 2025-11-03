"use client"

import React, { useRef, useState, useEffect, useCallback, useMemo } from 'react'
import { useCanvas } from './canvas-context'
import { ChevronUp, ChevronDown } from 'lucide-react'
import { CanvasItem, isPanel, isComponent } from '@/types/canvas-items'
import { useIsolatedIds } from '@/lib/isolation/context'
import { ensurePanelKey } from '@/lib/canvas/composite-id'
import { Z_INDEX } from '@/lib/constants/z-index'

interface MinimapProps {
  canvasItems: CanvasItem[]
  canvasState: {
    zoom: number
    translateX: number
    translateY: number
  }
  onNavigate: (x: number, y: number) => void
}

export function EnhancedMinimap({ canvasItems, canvasState, onNavigate }: MinimapProps) {
  const { state, dataStore, noteId } = useCanvas()
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const minimapSize = 280
  const minimapPadding = 20
  
  // Minimap state
  const [isDraggingMinimap, setIsDraggingMinimap] = useState(false)
  const [minimapDragStart, setMinimapDragStart] = useState({ x: 0, y: 0 })
  const [initialViewportOffset, setInitialViewportOffset] = useState({ x: 0, y: 0 })
  const [isExpanded, setIsExpanded] = useState(true)
  const isolatedComponents = useIsolatedIds()
  
  // Use ref to track dragging state for immediate access in event handlers
  const isDraggingRef = useRef(false)
  const mouseMoveHandlerRef = useRef<((e: MouseEvent) => void) | null>(null)
  const mouseUpHandlerRef = useRef<(() => void) | null>(null)

  // CRITICAL FIX: Use refs for canvasState and viewport to avoid infinite loop
  // These values are read when callback executes, but don't need to trigger recreation
  const canvasStateRef = useRef(canvasState)
  // Initialize viewportRef with placeholder, will be updated in useEffect
  const viewportRef = useRef({ x: 0, y: 0, width: 0, height: 0 })

  useEffect(() => {
    canvasStateRef.current = canvasState
  }, [canvasState])
  
  // Status tracking states
  const [isShiftPressed, setIsShiftPressed] = useState(false)
  const [isHovering, setIsHovering] = useState(false)
  const [hoveredComponent, setHoveredComponent] = useState<string | null>(null)
  const [isInteracting, setIsInteracting] = useState(false)
  const [isPinned, setIsPinned] = useState(false)
  const [isPreviewShown, setIsPreviewShown] = useState(false)
  
  // Track Shift key
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Shift') setIsShiftPressed(true)
    }
    
    const handleKeyUp = (e: KeyboardEvent) => {
      if (e.key === 'Shift') setIsShiftPressed(false)
    }
    
    window.addEventListener('keydown', handleKeyDown)
    window.addEventListener('keyup', handleKeyUp)
    
    return () => {
      window.removeEventListener('keydown', handleKeyDown)
      window.removeEventListener('keyup', handleKeyUp)
    }
  }, [])
  
  // No polling; useIsolatedIds() updates via provider subscription
  
  // Extract panels and components from canvasItems
  const panels = useMemo(() => canvasItems.filter(isPanel), [canvasItems])
  const components = useMemo(() => canvasItems.filter(isComponent), [canvasItems])
  
  // Calculate bounds for all items
  const bounds = useMemo(() => {
    if (canvasItems.length === 0) {
      return { minX: 1500, maxX: 3500, minY: 1000, maxY: 2500 }
    }
    
    let minX = Infinity
    let maxX = -Infinity
    let minY = Infinity
    let maxY = -Infinity
    
    // Process panels
    panels.forEach(panel => {
      const panelStoreKey = ensurePanelKey(noteId || '', panel.panelId!)
      const branch = dataStore.get(panelStoreKey)
      if (branch && branch.position) {
        minX = Math.min(minX, branch.position.x)
        maxX = Math.max(maxX, branch.position.x + (branch.dimensions?.width || 500))
        minY = Math.min(minY, branch.position.y)
        maxY = Math.max(maxY, branch.position.y + (branch.dimensions?.height || 400))
      }
    })
    
    // Process components
    components.forEach(component => {
      if (!component.position) return
      const width = component.dimensions?.width || 350
      const height = component.dimensions?.height || 300
      minX = Math.min(minX, component.position.x)
      maxX = Math.max(maxX, component.position.x + width)
      minY = Math.min(minY, component.position.y)
      maxY = Math.max(maxY, component.position.y + height)
    })
    
    const padding = 200
    return {
      minX: minX - padding,
      maxX: maxX + padding,
      minY: minY - padding,
      maxY: maxY + padding
    }
  }, [canvasItems, panels, components, dataStore])
  
  // Calculate scale to fit all panels
  const scale = useMemo(() => {
    const contentWidth = bounds.maxX - bounds.minX
    const contentHeight = bounds.maxY - bounds.minY
    const availableSize = minimapSize - minimapPadding * 2
    
    return Math.min(availableSize / contentWidth, availableSize / contentHeight)
  }, [bounds, minimapSize, minimapPadding])
  
  // Convert world to minimap coordinates
  const worldToMinimap = useCallback((worldX: number, worldY: number) => {
    return {
      x: (worldX - bounds.minX) * scale + minimapPadding,
      y: (worldY - bounds.minY) * scale + minimapPadding
    }
  }, [bounds, scale, minimapPadding])
  
  // Convert minimap to world coordinates
  const minimapToWorld = useCallback((minimapX: number, minimapY: number) => {
    return {
      x: (minimapX - minimapPadding) / scale + bounds.minX,
      y: (minimapY - minimapPadding) / scale + bounds.minY
    }
  }, [bounds, scale, minimapPadding])
  
  // Calculate viewport - FIXED coordinate system
  const viewport = useMemo(() => {
    const viewportWidth = typeof window !== 'undefined' ? window.innerWidth : 1920
    const viewportHeight = typeof window !== 'undefined' ? window.innerHeight : 1080
    
    const viewWidth = viewportWidth / canvasState.zoom
    const viewHeight = viewportHeight / canvasState.zoom
    
    // In our system, translateX/Y positive means canvas moved right/down
    // So viewport position in world space is negative of translate
    return {
      x: -canvasState.translateX,
      y: -canvasState.translateY,
      width: viewWidth,
      height: viewHeight
    }
  }, [canvasState])

  // Update viewportRef when viewport changes
  useEffect(() => {
    viewportRef.current = viewport
  }, [viewport])

  // Draw minimap
  const drawMinimap = useCallback(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    
    const ctx = canvas.getContext('2d')
    if (!ctx) return
    
    // Clear canvas
    ctx.clearRect(0, 0, minimapSize, minimapSize)
    
    // Draw background
    ctx.fillStyle = 'rgba(0, 0, 0, 0.9)'
    ctx.fillRect(0, 0, minimapSize, minimapSize)
    
    // Draw border
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.2)'
    ctx.lineWidth = 1
    ctx.strokeRect(0.5, 0.5, minimapSize - 1, minimapSize - 1)
    
    // Draw panels
    panels.forEach(panel => {
      const panelStoreKey = ensurePanelKey(noteId || '', panel.panelId!)
      const branch = dataStore.get(panelStoreKey)
      if (!branch || !branch.position) return

      const pos = worldToMinimap(branch.position.x, branch.position.y)
      const width = (branch.dimensions?.width || 500) * scale
      const height = (branch.dimensions?.height || 400) * scale
      
      // Check if panel is isolated
      const isIsolated = isolatedComponents.includes(panel.panelId!)
      
      // Color based on type
      let fillColor = 'rgba(100, 100, 100, 0.8)'
      if (isIsolated) {
        // Yellow with transparency for isolated panels
        fillColor = 'rgba(250, 204, 21, 0.4)'
      } else {
        switch (branch.type) {
          case 'main':
            fillColor = 'rgba(168, 85, 247, 0.8)' // Purple
            break
          case 'note':
            fillColor = 'rgba(59, 130, 246, 0.8)' // Blue
            break
          case 'explore':
            fillColor = 'rgba(245, 158, 11, 0.8)' // Orange
            break
          case 'promote':
            fillColor = 'rgba(34, 197, 94, 0.8)' // Green
            break
        }
      }
      
      // Special colors for states (only if not isolated)
      if (!isIsolated) {
        if (panel.panelId === hoveredComponent) {
          fillColor = 'rgba(251, 191, 36, 0.9)' // Yellow for hover
        }
        if (branch.selected) {
          fillColor = 'rgba(239, 68, 68, 0.9)' // Red for selected
        }
      }
      
      ctx.fillStyle = fillColor
      ctx.fillRect(pos.x, pos.y, Math.max(width, 3), Math.max(height, 3))
      
      // Draw isolation pattern if isolated
      if (isIsolated) {
        ctx.save()
        ctx.strokeStyle = 'rgba(250, 204, 21, 0.8)' // Yellow
        ctx.lineWidth = 1
        ctx.setLineDash([2, 2])
        
        // Draw diagonal stripes
        const stripeSpacing = 4
        for (let i = 0; i < width + height; i += stripeSpacing) {
          ctx.beginPath()
          ctx.moveTo(pos.x + Math.min(i, width), pos.y + Math.max(0, i - width))
          ctx.lineTo(pos.x + Math.max(0, i - height), pos.y + Math.min(i, height))
          ctx.stroke()
        }
        
        ctx.restore()
      }
      
      // Draw border
      ctx.strokeStyle = isIsolated ? 'rgba(250, 204, 21, 1)' :
                       branch.selected ? 'rgba(255, 255, 255, 0.8)' : 
                       'rgba(255, 255, 255, 0.2)'
      ctx.lineWidth = isIsolated ? 2 : branch.selected ? 2 : 1
      if (isIsolated) {
        ctx.setLineDash([4, 2])
      }
      ctx.strokeRect(pos.x, pos.y, Math.max(width, 3), Math.max(height, 3))
      ctx.setLineDash([])
    })
    
    // Draw components
    components.forEach(component => {
      if (!component.position) return
      const pos = worldToMinimap(component.position.x, component.position.y)
      const width = (component.dimensions?.width || 350) * scale
      const height = (component.dimensions?.height || 300) * scale
      
      // Check if component is isolated
      const isIsolated = isolatedComponents.includes(component.id)
      
      // Different colors for different component types
      let fillColor = 'rgba(100, 100, 100, 0.8)'
      if (isIsolated) {
        // Yellow with stripes for isolated components
        fillColor = 'rgba(250, 204, 21, 0.4)' // Yellow with transparency
      } else {
        switch (component.componentType) {
          case 'calculator':
            fillColor = 'rgba(59, 130, 246, 0.8)' // Blue
            break
          case 'timer':
            fillColor = 'rgba(34, 197, 94, 0.8)' // Green
            break
          case 'editor':
            fillColor = 'rgba(168, 85, 247, 0.8)' // Purple
            break
          case 'dragtest':
            fillColor = 'rgba(251, 146, 60, 0.8)' // Orange
            break
        }
      }
      
      // Highlight on hover
      if (component.id === hoveredComponent && !isIsolated) {
        fillColor = 'rgba(251, 191, 36, 0.9)' // Yellow for hover
      }
      
      ctx.fillStyle = fillColor
      ctx.fillRect(pos.x, pos.y, Math.max(width, 3), Math.max(height, 3))
      
      // Draw isolation pattern if isolated
      if (isIsolated) {
        ctx.save()
        ctx.strokeStyle = 'rgba(250, 204, 21, 0.8)' // Yellow
        ctx.lineWidth = 1
        ctx.setLineDash([2, 2])
        
        // Draw diagonal stripes
        const stripeSpacing = 4
        for (let i = 0; i < width + height; i += stripeSpacing) {
          ctx.beginPath()
          ctx.moveTo(pos.x + Math.min(i, width), pos.y + Math.max(0, i - width))
          ctx.lineTo(pos.x + Math.max(0, i - height), pos.y + Math.min(i, height))
          ctx.stroke()
        }
        
        ctx.restore()
      }
      
      // Draw border
      ctx.strokeStyle = isIsolated ? 'rgba(250, 204, 21, 1)' : 
                       component.id === hoveredComponent ? 'rgba(255, 255, 255, 0.8)' : 
                       'rgba(255, 255, 255, 0.2)'
      ctx.lineWidth = isIsolated ? 2 : component.id === hoveredComponent ? 2 : 1
      if (isIsolated) {
        ctx.setLineDash([4, 2])
      }
      ctx.strokeRect(pos.x, pos.y, Math.max(width, 3), Math.max(height, 3))
      ctx.setLineDash([])
    })
    
    // Draw viewport rectangle
    const viewportMinimap = worldToMinimap(viewport.x, viewport.y)
    const viewportSize = {
      width: viewport.width * scale,
      height: viewport.height * scale
    }
    
    ctx.strokeStyle = 'rgba(239, 68, 68, 0.8)'
    ctx.lineWidth = 2
    ctx.setLineDash([5, 5])
    ctx.strokeRect(viewportMinimap.x, viewportMinimap.y, viewportSize.width, viewportSize.height)
    ctx.setLineDash([])
    
    // Fill viewport with semi-transparent overlay
    ctx.fillStyle = 'rgba(239, 68, 68, 0.1)'
    ctx.fillRect(viewportMinimap.x, viewportMinimap.y, viewportSize.width, viewportSize.height)
  }, [canvasItems, panels, components, dataStore, worldToMinimap, scale, viewport, hoveredComponent, isolatedComponents])
  
  // Redraw when dependencies change
  useEffect(() => {
    drawMinimap()
  }, [drawMinimap])
  
  // Remove any existing listeners when component unmounts or dependencies change
  useEffect(() => {
    return () => {
      if (mouseMoveHandlerRef.current) {
        document.removeEventListener('mousemove', mouseMoveHandlerRef.current)
        mouseMoveHandlerRef.current = null
      }
      if (mouseUpHandlerRef.current) {
        document.removeEventListener('mouseup', mouseUpHandlerRef.current)
        mouseUpHandlerRef.current = null
      }
    }
  }, [])
  
  // Handle minimap mouse down
  const handleMinimapMouseDown = useCallback((event: React.MouseEvent) => {
    const canvas = canvasRef.current
    if (!canvas) return
    
    const rect = canvas.getBoundingClientRect()
    const minimapX = event.clientX - rect.left
    const minimapY = event.clientY - rect.top
    
    // Check if clicking within viewport rectangle for dragging
    // CRITICAL FIX: Read from viewportRef to avoid infinite loop
    const viewportMinimap = worldToMinimap(viewportRef.current.x, viewportRef.current.y)
    const viewportSize = {
      width: viewportRef.current.width * scale,
      height: viewportRef.current.height * scale
    }
    
    const isInViewport = minimapX >= viewportMinimap.x && 
                        minimapX <= viewportMinimap.x + viewportSize.width &&
                        minimapY >= viewportMinimap.y && 
                        minimapY <= viewportMinimap.y + viewportSize.height
    
    if (isInViewport) {
      // Start dragging the viewport
      isDraggingRef.current = true
      setIsDraggingMinimap(true)
      
      // Store drag start position and initial viewport offset
      const dragStartX = minimapX
      const dragStartY = minimapY
      // CRITICAL FIX: Read from canvasStateRef to avoid infinite loop
      const initialX = canvasStateRef.current.translateX
      const initialY = canvasStateRef.current.translateY
      
      setMinimapDragStart({ x: dragStartX, y: dragStartY })
      setInitialViewportOffset({ x: initialX, y: initialY })
      
      // Create mouse move handler with captured values
      const handleMouseMove = (e: MouseEvent) => {
        if (!isDraggingRef.current) return
        
        const currentRect = canvas.getBoundingClientRect()
        const currentMinimapX = e.clientX - currentRect.left
        const currentMinimapY = e.clientY - currentRect.top
        
        // Calculate the delta in minimap coordinates
        const deltaMinimapX = currentMinimapX - dragStartX
        const deltaMinimapY = currentMinimapY - dragStartY
        
        // Convert delta to world coordinates
        const deltaWorldX = deltaMinimapX / scale
        const deltaWorldY = deltaMinimapY / scale
        
        // Update canvas translate
        const newTranslateX = initialX - deltaWorldX
        const newTranslateY = initialY - deltaWorldY
        
        onNavigate(newTranslateX, newTranslateY)
      }
      
      // Create mouse up handler
      const handleMouseUp = () => {
        isDraggingRef.current = false
        setIsDraggingMinimap(false)
        
        // Remove event listeners
        if (mouseMoveHandlerRef.current) {
          document.removeEventListener('mousemove', mouseMoveHandlerRef.current)
          mouseMoveHandlerRef.current = null
        }
        if (mouseUpHandlerRef.current) {
          document.removeEventListener('mouseup', mouseUpHandlerRef.current)
          mouseUpHandlerRef.current = null
        }
      }
      
      // Store handlers in refs and add listeners
      mouseMoveHandlerRef.current = handleMouseMove
      mouseUpHandlerRef.current = handleMouseUp
      
      document.addEventListener('mousemove', handleMouseMove)
      document.addEventListener('mouseup', handleMouseUp)
    } else {
      // Click outside viewport - center viewport on clicked position
      const worldPos = minimapToWorld(minimapX, minimapY)
      
      const viewportWidth = window.innerWidth
      const viewportHeight = window.innerHeight
      
      // To center viewport at worldPos, we need to set canvas translate
      // such that worldPos appears at center of screen
      // CRITICAL FIX: Read from canvasStateRef to avoid infinite loop
      const newTranslateX = -worldPos.x + (viewportWidth / canvasStateRef.current.zoom) / 2
      const newTranslateY = -worldPos.y + (viewportHeight / canvasStateRef.current.zoom) / 2
      
      onNavigate(newTranslateX, newTranslateY)
    }
    
    event.preventDefault()
  }, [worldToMinimap, minimapToWorld, scale, onNavigate])
  // NOTE: viewport and canvasState deliberately excluded from dependencies
  // We read them via refs to avoid infinite loop when minimap dragging causes state changes
  
  // Handle mouse move for hover detection
  const handleMouseMoveOnCanvas = useCallback((e: React.MouseEvent) => {
    if (isDraggingMinimap) return // Don't detect hover while dragging
    
    const canvas = canvasRef.current
    if (!canvas) return
    
    const rect = canvas.getBoundingClientRect()
    const minimapX = e.clientX - rect.left
    const minimapY = e.clientY - rect.top
    
    // Find item at position
    let foundItem: string | null = null
    
    // Check panels
    panels.forEach(panel => {
      const panelStoreKey = ensurePanelKey(noteId || '', panel.panelId!)
      const branch = dataStore.get(panelStoreKey)
      if (!branch || !branch.position) return

      const pos = worldToMinimap(branch.position.x, branch.position.y)
      const width = (branch.dimensions?.width || 500) * scale
      const height = (branch.dimensions?.height || 400) * scale
      
      if (minimapX >= pos.x && minimapX <= pos.x + width &&
          minimapY >= pos.y && minimapY <= pos.y + height) {
        foundItem = panel.panelId!
      }
    })
    
    // Check components
    components.forEach(component => {
      if (!component.position) return
      const pos = worldToMinimap(component.position.x, component.position.y)
      const width = (component.dimensions?.width || 350) * scale
      const height = (component.dimensions?.height || 300) * scale
      
      if (minimapX >= pos.x && minimapX <= pos.x + width &&
          minimapY >= pos.y && minimapY <= pos.y + height) {
        foundItem = component.id
      }
    })
    
    setHoveredComponent(foundItem)
  }, [panels, components, dataStore, worldToMinimap, scale, isDraggingMinimap])
  
  if (!isExpanded) {
    return (
      <div
        className="fixed bottom-4 right-4"
        style={{ zIndex: Z_INDEX.CANVAS_MINIMAP }}
      >
        <button
          onClick={() => setIsExpanded(true)}
          className="bg-gray-900 text-white p-2 rounded-lg shadow-lg hover:bg-gray-800 transition-colors"
        >
          <ChevronUp size={20} />
        </button>
      </div>
    )
  }
  
  return (
    <div
      className="fixed bottom-4 right-4 bg-gray-900 text-white rounded-lg shadow-2xl overflow-hidden"
      style={{ zIndex: Z_INDEX.CANVAS_MINIMAP }}
    >
      {/* Header */}
      <div className="bg-gray-800 px-4 py-2 flex items-center justify-between border-b border-gray-700">
        <h3 className="text-sm font-semibold">Minimap</h3>
        <button
          onClick={() => setIsExpanded(false)}
          className="text-gray-400 hover:text-white transition-colors"
        >
          <ChevronDown size={16} />
        </button>
      </div>
      
      {/* Minimap Canvas */}
      <div className="p-3">
        <canvas
          ref={canvasRef}
          width={minimapSize}
          height={minimapSize}
          className="rounded border border-gray-700"
          onMouseDown={handleMinimapMouseDown}
          onMouseMove={handleMouseMoveOnCanvas}
          onMouseEnter={() => setIsHovering(true)}
          onMouseLeave={() => {
            setIsHovering(false)
            setHoveredComponent(null)
          }}
          style={{
            width: minimapSize,
            height: minimapSize,
            imageRendering: 'pixelated',
            cursor: isDraggingMinimap ? 'grabbing' : 'pointer'
          }}
        />
      </div>
      
      {/* Status Indicators - Disabled per user request */}
      
      {/* Instructions */}
      <div className="bg-gray-800 px-4 py-2 border-t border-gray-700">
        <div className="text-xs text-center space-y-1">
          <p className="text-gray-400">Click to focus</p>
          <p className="text-yellow-400">Hold Shift + hover for preview</p>
          <button 
            onClick={() => {
              setIsInteracting(false)
              setIsPinned(false)
              setIsPreviewShown(false)
              setHoveredComponent(null)
            }}
            className="text-red-400 hover:text-red-300 underline text-xs"
          >
            Reset Preview
          </button>
        </div>
      </div>
    </div>
  )
}
