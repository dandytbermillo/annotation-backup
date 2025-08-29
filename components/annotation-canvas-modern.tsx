"use client"

import { useEffect, useState, forwardRef, useImperativeHandle } from "react"
import { CanvasProvider, useCanvas } from "./canvas/canvas-context"
import { CanvasPanel } from "./canvas/canvas-panel"
import { AnnotationToolbar } from "./canvas/annotation-toolbar"
import { CollaborationProvider, clearEditorDocsForNote } from "@/lib/yjs-provider"
import { CanvasControls } from "./canvas/canvas-controls"
import { Minimap } from "./canvas/minimap"
import { ConnectionLines } from "./canvas/connection-lines"
import { panToPanel } from "@/lib/canvas/pan-animations"
import { getPlainProvider } from "@/lib/provider-switcher"

interface ModernAnnotationCanvasProps {
  noteId: string
  isNotesExplorerOpen?: boolean
  onCanvasStateChange?: (state: { zoom: number; showConnections: boolean }) => void
}

interface CanvasImperativeHandle {
  zoomIn: () => void
  zoomOut: () => void
  resetView: () => void
  toggleConnections: () => void
}

const ModernAnnotationCanvas = forwardRef<CanvasImperativeHandle, ModernAnnotationCanvasProps>(({ 
  noteId, 
  isNotesExplorerOpen = false,
  onCanvasStateChange 
}, ref) => {
  const [canvasState, setCanvasState] = useState({
    zoom: 1,
    translateX: -1000,
    translateY: -1200,
    isDragging: false,
    lastMouseX: 0,
    lastMouseY: 0,
    showConnections: true
  })

  const [panels, setPanels] = useState<string[]>([])

  useEffect(() => {
    // Note: We no longer clear editor docs when switching notes
    // The composite key system (noteId-panelId) already isolates docs between notes
    // This allows content to load immediately when switching back to a previously viewed note
    
    // Initialize collaboration provider with YJS persistence
    const provider = CollaborationProvider.getInstance()
    
    // Define default data for new notes
    const defaultData = {
      'main': {
        title: 'New Document',
        type: 'main',
        content: '', // Start with empty content instead of placeholder
        branches: [],
        position: { x: 2000, y: 1500 },
        isEditable: true
      }
    }

    // Initialize the note with YJS persistence providers
    // This will either restore from persistence or create with defaults
    provider.initializeDefaultData(noteId, defaultData)
    
    // Set main panel as the initial panel
    setPanels(['main'])

    return () => {
      // Don't destroy note when switching - only cleanup when truly unmounting
      // The provider's smart cache management will handle memory efficiently
      // This allows content to persist when switching between notes
    }
  }, [noteId])

  const handleCanvasMouseDown = (e: React.MouseEvent) => {
    // Only start dragging if clicking on canvas background
    if ((e.target as HTMLElement).closest('.panel')) return
    
    setCanvasState(prev => ({
      ...prev,
      isDragging: true,
      lastMouseX: e.clientX,
      lastMouseY: e.clientY
    }))
    
    document.body.style.userSelect = 'none'
    e.preventDefault()
  }

  const handleCanvasMouseMove = (e: MouseEvent) => {
    if (!canvasState.isDragging) return
    
    const deltaX = e.clientX - canvasState.lastMouseX
    const deltaY = e.clientY - canvasState.lastMouseY

    setCanvasState(prev => ({
      ...prev,
      translateX: prev.translateX + deltaX,
      translateY: prev.translateY + deltaY,
      lastMouseX: e.clientX,
      lastMouseY: e.clientY
    }))
  }

  const handleCanvasMouseUp = () => {
    setCanvasState(prev => ({ ...prev, isDragging: false }))
    document.body.style.userSelect = ''
  }

  const handleWheel = (e: React.WheelEvent) => {
    e.preventDefault()
    
    const zoomFactor = e.deltaY > 0 ? 0.9 : 1.1
    const newZoom = Math.max(0.3, Math.min(2, canvasState.zoom * zoomFactor))
    
    const rect = e.currentTarget.getBoundingClientRect()
    const mouseX = e.clientX - rect.left
    const mouseY = e.clientY - rect.top
    
    const zoomChange = newZoom / canvasState.zoom
    
    setCanvasState(prev => ({
      ...prev,
      zoom: newZoom,
      translateX: mouseX - (mouseX - prev.translateX) * zoomChange,
      translateY: mouseY - (mouseY - prev.translateY) * zoomChange
    }))
  }

  useEffect(() => {
    document.addEventListener('mousemove', handleCanvasMouseMove)
    document.addEventListener('mouseup', handleCanvasMouseUp)
    
    return () => {
      document.removeEventListener('mousemove', handleCanvasMouseMove)
      document.removeEventListener('mouseup', handleCanvasMouseUp)
    }
  }, [canvasState.isDragging, canvasState.lastMouseX, canvasState.lastMouseY])

  const handlePanelClose = (panelId: string) => {
    setPanels(prev => prev.filter(id => id !== panelId))
  }

  const handleCreatePanel = (panelId: string) => {
    console.log('[AnnotationCanvas] Creating panel:', panelId)
    
    // Check if we're in plain mode
    const plainProvider = getPlainProvider()
    const isPlainMode = !!plainProvider
    
    setPanels(prev => {
      // Only add if not already present
      if (prev.includes(panelId)) {
        return prev
      }
      
      if (isPlainMode) {
        // Plain mode: Check if panel data exists
        // Note: We'll need to get dataStore from context provider
        console.log('[Plain mode] Creating panel:', panelId)
      } else {
        // Ensure the provider knows about the current note
        const provider = CollaborationProvider.getInstance()
        provider.setCurrentNote(noteId)
        
        // Get the panel data from YJS
        const branchesMap = provider.getBranchesMap()
        const panelData = branchesMap.get(panelId)
        
        if (!panelData) {
          console.warn(`No data found for panel ${panelId}`)
          return prev
        }
      }
      
      // After adding panel, smoothly pan to it
      setTimeout(() => {
        const getPanelPosition = (id: string) => {
          if (isPlainMode) {
            // In plain mode, use dataStore position
            const dataStore = (window as any).canvasDataStore
            const panel = dataStore?.get(id)
            return panel?.position || { x: 2000, y: 1500 }
          } else {
            const panel = CollaborationProvider.getInstance().getBranchesMap().get(id)
            return panel?.position || null
          }
        }
        
        panToPanel(
          panelId,
          getPanelPosition,
          canvasState,
          (updates) => setCanvasState(prev => ({ ...prev, ...updates })),
          {
            duration: 600,
            callback: () => {
              console.log('[AnnotationCanvas] Finished panning to panel:', panelId)
            }
          }
        )
      }, 100) // Small delay to ensure panel is rendered
      
      return [...prev, panelId]
    })
  }

  // Subscribe to panel creation events
  useEffect(() => {
    const handlePanelEvent = (event: CustomEvent) => {
      if (event.detail?.panelId) {
        handleCreatePanel(event.detail.panelId)
      }
    }

    window.addEventListener('create-panel' as any, handlePanelEvent)
    return () => {
      window.removeEventListener('create-panel' as any, handlePanelEvent)
    }
  }, [noteId]) // Add noteId dependency to ensure we're using the correct note

  // Expose methods via ref
  useImperativeHandle(ref, () => ({
    zoomIn: () => {
      setCanvasState(prev => {
        const newZoom = Math.min(prev.zoom * 1.1, 2)
        const newState = { ...prev, zoom: newZoom }
        onCanvasStateChange?.({ zoom: newZoom, showConnections: prev.showConnections })
        return newState
      })
    },
    zoomOut: () => {
      setCanvasState(prev => {
        const newZoom = Math.max(prev.zoom * 0.9, 0.3)
        const newState = { ...prev, zoom: newZoom }
        onCanvasStateChange?.({ zoom: newZoom, showConnections: prev.showConnections })
        return newState
      })
    },
    resetView: () => {
      setCanvasState(prev => {
        const newState = { ...prev, zoom: 1, translateX: -1000, translateY: -1200 }
        onCanvasStateChange?.({ zoom: 1, showConnections: prev.showConnections })
        return newState
      })
    },
    toggleConnections: () => {
      setCanvasState(prev => {
        const newShowConnections = !prev.showConnections
        const newState = { ...prev, showConnections: newShowConnections }
        onCanvasStateChange?.({ zoom: prev.zoom, showConnections: newShowConnections })
        return newState
      })
    }
  }), [onCanvasStateChange])

  return (
    <CanvasProvider noteId={noteId}>
      <div className="w-screen h-screen overflow-hidden bg-gradient-to-br from-indigo-500 via-purple-500 to-pink-500">
        {/* Demo Header */}
        <div className="fixed top-0 left-0 right-0 bg-black/90 backdrop-blur-xl text-white p-3 text-xs font-medium z-[1000] border-b border-white/10">
          🚀 Yjs-Ready Unified Knowledge Canvas • Collaborative-Ready Architecture with Tiptap Editor
        </div>

        {/* Canvas Controls - Only show when notes explorer is closed */}
        {!isNotesExplorerOpen && (
          <CanvasControls 
            zoom={canvasState.zoom}
            onZoomIn={() => setCanvasState(prev => ({ ...prev, zoom: Math.min(prev.zoom * 1.1, 2) }))}
            onZoomOut={() => setCanvasState(prev => ({ ...prev, zoom: Math.max(prev.zoom * 0.9, 0.3) }))}
            onResetView={() => setCanvasState(prev => ({ ...prev, zoom: 1, translateX: -1000, translateY: -1200 }))}
            onToggleConnections={() => setCanvasState(prev => ({ ...prev, showConnections: !prev.showConnections }))}
            showConnections={canvasState.showConnections}
          />
        )}

        {/* Minimap */}
        <Minimap 
          panels={panels}
          canvasState={canvasState}
          onNavigate={(x, y) => setCanvasState(prev => ({ ...prev, translateX: x, translateY: y }))}
        />

        {/* Canvas Container */}
        <div 
          id="canvas-container"
          className={`relative w-full h-full cursor-grab overflow-hidden ${canvasState.isDragging ? 'cursor-grabbing' : ''}`}
          onMouseDown={handleCanvasMouseDown}
          onWheel={handleWheel}
          onContextMenu={(e) => e.preventDefault()}
        >
          {/* Infinite Canvas */}
          <div 
            id="infinite-canvas"
            style={{
              position: 'absolute',
              transform: `translate(${canvasState.translateX}px, ${canvasState.translateY}px) scale(${canvasState.zoom})`,
              transformOrigin: '0 0',
              transition: canvasState.isDragging ? 'none' : 'transform 0.3s ease',
            }}
          >
            {/* Connection Lines */}
            {canvasState.showConnections && (
              <ConnectionLines panels={panels} />
            )}

            {/* Panels */}
            <PanelsRenderer
              noteId={noteId}
              panels={panels}
              onClose={handlePanelClose}
            />
          </div>
        </div>

        {/* Annotation Toolbar */}
        <AnnotationToolbar />
      </div>
    </CanvasProvider>
  )
})

ModernAnnotationCanvas.displayName = 'ModernAnnotationCanvas'

// Renders panels using plain dataStore in plain mode, Yjs map otherwise
function PanelsRenderer({
  noteId,
  panels,
  onClose,
}: {
  noteId: string
  panels: string[]
  onClose: (id: string) => void
}) {
  const { dataStore } = useCanvas()
  const plainProvider = getPlainProvider()
  const isPlainMode = !!plainProvider
  
  // Yjs access only when not in plain mode
  const provider = CollaborationProvider.getInstance()
  if (!isPlainMode) {
    provider.setCurrentNote(noteId)
  }
  const branchesMap = !isPlainMode ? provider.getBranchesMap() : null
  
  return (
    <>
      {panels.map((panelId) => {
        const branch = isPlainMode ? dataStore.get(panelId) : branchesMap?.get(panelId)
        if (!branch) {
          console.warn(`[PanelsRenderer] Branch ${panelId} not found in ${isPlainMode ? 'plain' : 'yjs'} store`)
          return null
        }
        const position = branch.position || { x: 2000, y: 1500 }
        return (
          <CanvasPanel
            key={panelId}
            panelId={panelId}
            branch={branch}
            position={position}
            noteId={noteId}
            onClose={panelId !== 'main' ? () => onClose(panelId) : undefined}
          />
        )
      })}
    </>
  )
}

export default ModernAnnotationCanvas 