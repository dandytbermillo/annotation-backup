"use client"

import { useState, useRef, useEffect, useCallback, useMemo } from "react"
import dynamic from 'next/dynamic'
// Phase 1: Using notes explorer with API integration and feature flag
import { FloatingToolbar, type OverlayPopup, type OrgItem } from "./floating-toolbar"
import { PopupOverlay } from "@/components/canvas/popup-overlay"
import { CoordinateBridge } from "@/lib/utils/coordinate-bridge"
import { Menu } from "lucide-react"
import { LayerProvider, useLayer } from "@/components/canvas/layer-provider"

const ModernAnnotationCanvas = dynamic(
  () => import('./annotation-canvas-modern'),
  { 
    ssr: false,
    loading: () => (
      <div className="w-full h-full flex items-center justify-center bg-gradient-to-br from-indigo-500 via-purple-500 to-pink-500">
        <div className="text-white text-2xl font-semibold animate-pulse">Loading canvas...</div>
      </div>
    )
  }
)

function AnnotationAppContent() {
  const [selectedNoteId, setSelectedNoteId] = useState<string | null>(null)
  const [canvasState, setCanvasState] = useState({
    zoom: 1,
    showConnections: true
  })
  const [showAddComponentMenu, setShowAddComponentMenu] = useState(false)

  // Floating notes widget state
  const [showNotesWidget, setShowNotesWidget] = useState(false)
  const [notesWidgetPosition, setNotesWidgetPosition] = useState({ x: 100, y: 100 })

  // Overlay popups state - persists independently of toolbar (like selectedNoteId)
  const [overlayPopups, setOverlayPopups] = useState<OverlayPopup[]>([])
  const [draggingPopup, setDraggingPopup] = useState<string | null>(null)
  const dragOffsetRef = useRef<{ x: number; y: number }>({ x: 0, y: 0 })
  const draggingPopupRef = useRef<string | null>(null)
  const dragScreenPosRef = useRef<{ x: number; y: number }>({ x: 0, y: 0 })

  // Force re-center trigger - increment to force effect to run
  const [centerTrigger, setCenterTrigger] = useState(0)
  
  // Ref to access canvas methods
  const canvasRef = useRef<any>(null)

  // Ref to track last centered note to avoid repeated centering during normal flow
  const lastCenteredRef = useRef<string | null>(null)
  
  // Determine collaboration mode from environment
  const collabMode = process.env.NEXT_PUBLIC_COLLAB_MODE || 'plain'
  const isPlainMode = collabMode === 'plain'
  
  // Multi-layer canvas is always enabled
  const multiLayerEnabled = true
  const layerContext = useLayer()

  // Adapt overlay popups for PopupOverlay component
  const adaptedPopups = useMemo(() => {
    if (!multiLayerEnabled || !layerContext) return null

    const adapted = new Map()
    overlayPopups.forEach((popup) => {
      adapted.set(popup.id, {
        ...popup,
        folder: popup.folder || {
          id: popup.folderId,
          name: popup.folderName,
          type: 'folder' as const,
          children: popup.children
        },
        canvasPosition: popup.canvasPosition
      })
    })
    return adapted
  }, [overlayPopups, multiLayerEnabled, layerContext])

  // Auto-switch layers based on overlay popup count
  useEffect(() => {
    if (!multiLayerEnabled || !layerContext) return

    if (overlayPopups.length > 0) {
      if (layerContext.activeLayer !== 'popups') {
        layerContext.setActiveLayer('popups')
      }
    } else {
      if (layerContext.activeLayer !== 'notes') {
        layerContext.setActiveLayer('notes')
      }
    }
  }, [overlayPopups.length, multiLayerEnabled, layerContext])

  // Keep draggingPopupRef in sync
  useEffect(() => {
    draggingPopupRef.current = draggingPopup
  }, [draggingPopup])

  // Handle global mouse events for dragging popup
  useEffect(() => {
    if (!draggingPopup) return

    const handleGlobalMouseMove = (e: MouseEvent) => {
      e.preventDefault()

      const sharedTransform = layerContext?.transforms.popups || { x: 0, y: 0, scale: 1 }

      // Calculate new screen position
      const newScreenPosition = {
        x: e.clientX - dragOffsetRef.current.x,
        y: e.clientY - dragOffsetRef.current.y
      }

      // Convert to canvas coordinates
      const newCanvasPosition = CoordinateBridge.screenToCanvas(newScreenPosition, sharedTransform)

      // Update popup position
      setOverlayPopups(prev =>
        prev.map(p =>
          p.id === draggingPopup
            ? { ...p, canvasPosition: newCanvasPosition, position: newScreenPosition, isDragging: true }
            : p
        )
      )

      dragScreenPosRef.current = newScreenPosition
    }

    const handleGlobalMouseUp = () => {
      if (!draggingPopup) return

      // Mark popup as no longer dragging
      setOverlayPopups(prev =>
        prev.map(p =>
          p.id === draggingPopup
            ? { ...p, isDragging: false }
            : p
        )
      )

      setDraggingPopup(null)
      draggingPopupRef.current = null
      document.body.style.cursor = ''
      document.body.style.userSelect = ''
    }

    // Use capture phase for better responsiveness
    document.addEventListener('mousemove', handleGlobalMouseMove, true)
    document.addEventListener('mouseup', handleGlobalMouseUp, true)

    return () => {
      document.removeEventListener('mousemove', handleGlobalMouseMove, true)
      document.removeEventListener('mouseup', handleGlobalMouseUp, true)
    }
  }, [draggingPopup, layerContext]) // Stable during drag - only refs used inside
  
  // Handle note selection with force re-center support
  const handleNoteSelect = (noteId: string) => {
    if (noteId === selectedNoteId) {
      // Same note clicked - force re-center by incrementing trigger
      setCenterTrigger(prev => prev + 1)
    } else {
      // Different note - normal selection
      setSelectedNoteId(noteId)
    }
  }
  
  // Center panel when note selection changes or when forced
  useEffect(() => {
    if (!selectedNoteId) return
    
    // Always center when this effect runs (triggered by selectedNoteId change or centerTrigger change)
    lastCenteredRef.current = selectedNoteId
    
    // Use a slight delay to ensure panel has time to mount
    const timeoutId = setTimeout(() => {
      canvasRef.current?.centerOnPanel?.('main')
    }, 50) // Small delay to allow React to render the panel
    return () => clearTimeout(timeoutId)
  }, [selectedNoteId, centerTrigger]) // Also watch centerTrigger

  // Handle right-click to show notes widget
  const handleContextMenu = useCallback((e: React.MouseEvent) => {
    e.preventDefault()
    setNotesWidgetPosition({ x: e.clientX, y: e.clientY })
    setShowNotesWidget(true)
  }, [])

  // Handle closing notes widget
  const handleCloseNotesWidget = useCallback(() => {
    setShowNotesWidget(false)
  }, [])

  // Handle creating overlay popup (callback from FloatingToolbar)
  const handleCreateOverlayPopup = useCallback((popup: OverlayPopup) => {
    setOverlayPopups(prev => {
      // Check if popup with same ID already exists (update it)
      const existingIndex = prev.findIndex(p => p.id === popup.id)
      if (existingIndex >= 0) {
        // Update existing popup (e.g., when children are loaded)
        const updated = [...prev]
        updated[existingIndex] = popup
        return updated
      }
      // Check if popup with same folder already exists (prevent duplicates)
      const folderExists = prev.some(p => p.folderId === popup.folderId)
      if (folderExists) return prev
      // Add new popup
      return [...prev, popup]
    })
  }, [])

  // Handle closing overlay popup
  const handleCloseOverlayPopup = useCallback((popupId: string) => {
    setOverlayPopups(prev => prev.filter(p => p.id !== popupId))
  }, [])

  // Handle popup drag start
  const handlePopupDragStart = useCallback((popupId: string, event: React.MouseEvent) => {
    event.preventDefault()
    event.stopPropagation()

    const popup = overlayPopups.find(p => p.id === popupId)
    if (!popup) return

    // Get the shared transform for coordinate conversion
    const sharedTransform = layerContext?.transforms.popups || { x: 0, y: 0, scale: 1 }

    // Calculate offset between mouse position and popup position
    const screenPosition = CoordinateBridge.canvasToScreen(popup.canvasPosition, sharedTransform)
    const offset = {
      x: event.clientX - screenPosition.x,
      y: event.clientY - screenPosition.y
    }

    dragOffsetRef.current = offset
    setDraggingPopup(popupId)
    draggingPopupRef.current = popupId
    dragScreenPosRef.current = { x: screenPosition.x, y: screenPosition.y }

    // Mark popup as dragging
    setOverlayPopups(prev =>
      prev.map(p => p.id === popupId ? { ...p, isDragging: true } : p)
    )

    // Prevent text selection
    document.body.style.cursor = 'grabbing'
    document.body.style.userSelect = 'none'
  }, [overlayPopups, layerContext])

  // Navigation control functions
  const handleZoomIn = () => {
    setCanvasState(prev => ({ ...prev, zoom: Math.min(prev.zoom * 1.1, 2) }))
    if (canvasRef.current?.zoomIn) {
      canvasRef.current.zoomIn()
    }
  }

  const handleZoomOut = () => {
    setCanvasState(prev => ({ ...prev, zoom: Math.max(prev.zoom * 0.9, 0.3) }))
    if (canvasRef.current?.zoomOut) {
      canvasRef.current.zoomOut()
    }
  }

  const handleResetView = () => {
    setCanvasState(prev => ({ ...prev, zoom: 1 }))
    if (canvasRef.current?.resetView) {
      canvasRef.current.resetView()
    }
  }

  const handleToggleConnections = () => {
    setCanvasState(prev => ({ ...prev, showConnections: !prev.showConnections }))
    if (canvasRef.current?.toggleConnections) {
      canvasRef.current.toggleConnections()
    }
  }

  // Feature flag for Phase 1 API (can be toggled via environment variable or UI)
  const usePhase1API = process.env.NEXT_PUBLIC_USE_PHASE1_API === 'true' || false
  const isPopupLayerActive = multiLayerEnabled && layerContext?.activeLayer === 'popups'
  
  return (
    <div
      className="flex h-screen w-screen overflow-hidden relative"
      onContextMenu={handleContextMenu}
    >
      {/* Floating Toolbar */}
      {showNotesWidget && (
        <FloatingToolbar
          x={notesWidgetPosition.x}
          y={notesWidgetPosition.y}
          onClose={handleCloseNotesWidget}
          onSelectNote={handleNoteSelect}
          onCreateOverlayPopup={handleCreateOverlayPopup}
        />
      )}
      
      {/* Canvas Area - Full width when explorer is closed */}
      <div 
        className="flex-1 relative transition-all duration-300 ease-in-out"
        style={{
          // Disable pointer events when popup layer is active
          pointerEvents: isPopupLayerActive ? 'none' : 'auto',
          // Ensure canvas stays below popups even with z-index escalation
          position: 'relative',
          zIndex: 1,
          isolation: 'isolate',
        }}
      >
        {selectedNoteId ? (
          <ModernAnnotationCanvas
            key={selectedNoteId}
            noteId={selectedNoteId}
            ref={canvasRef}
            isNotesExplorerOpen={false}
            onCanvasStateChange={setCanvasState}
            showAddComponentMenu={showAddComponentMenu}
            onToggleAddComponentMenu={() => setShowAddComponentMenu(!showAddComponentMenu)}
          />
        ) : (
          <div className="w-full h-full flex items-center justify-center bg-gray-950">
            <div className="text-center">
              <h2 className="text-3xl font-bold text-gray-600 mb-4">
                Welcome to Annotation Canvas
              </h2>
              <p className="text-gray-500 mb-6">
                Right-click anywhere to open Notes Explorer and create a new note
              </p>
            </div>
          </div>
        )}
      </div>

      {/* Overlay canvas popups - persists independently of toolbar */}
      {multiLayerEnabled && adaptedPopups && (
        <PopupOverlay
          popups={adaptedPopups}
          draggingPopup={draggingPopup}
          onClosePopup={handleCloseOverlayPopup}
          onDragStart={handlePopupDragStart}
          onHoverFolder={() => {}}
          onLeaveFolder={() => {}}
          sidebarOpen={false}
        />
      )}
    </div>
  )
}

export function AnnotationApp() {
  // Always provide LayerProvider - it will internally check feature flag
  return (
    <LayerProvider initialPopupCount={0}>
      <AnnotationAppContent />
    </LayerProvider>
  )
} 
