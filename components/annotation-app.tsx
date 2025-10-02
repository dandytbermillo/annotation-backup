"use client"

import { useState, useRef, useEffect, useCallback } from "react"
import dynamic from 'next/dynamic'
// Phase 1: Using notes explorer with API integration and feature flag
import { FloatingToolbar } from "./floating-toolbar"
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
