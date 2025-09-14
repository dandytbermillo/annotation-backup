"use client"

import { useEffect, useState, forwardRef, useImperativeHandle, useRef, useCallback } from "react"
import { CanvasProvider, useCanvas } from "./canvas/canvas-context"
import { CanvasPanel } from "./canvas/canvas-panel"
import { AnnotationToolbar } from "./canvas/annotation-toolbar"
import { UnifiedProvider } from "@/lib/provider-switcher"
import { isPlainModeActive } from "@/lib/collab-mode"
import { CanvasControls } from "./canvas/canvas-controls"
import { EnhancedControlPanel } from "./canvas/enhanced-control-panel"
import { EnhancedMinimap } from "./canvas/enhanced-minimap"
import { ConnectionLines } from "./canvas/connection-lines"
import { panToPanel } from "@/lib/canvas/pan-animations"
import { Settings, Plus } from "lucide-react"
import { AddComponentMenu } from "./canvas/add-component-menu"
import { ComponentPanel } from "./canvas/component-panel"
import { CanvasItem, createPanelItem, createComponentItem, isPanel, isComponent } from "@/types/canvas-items"

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
  centerOnPanel: (panelId: string) => void
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

  // Unified canvas items state
  const [canvasItems, setCanvasItems] = useState<CanvasItem[]>([])
  const [showControlPanel, setShowControlPanel] = useState(false)
  const [showAddComponentMenu, setShowAddComponentMenu] = useState(false)
  // Selection guards to prevent text highlighting during canvas drag
  const selectionGuardsRef = useRef<{
    onSelectStart: (e: Event) => void;
    onDragStart: (e: Event) => void;
    prevUserSelect: string;
  } | null>(null)

  const enableSelectionGuards = useCallback(() => {
    if (typeof document === 'undefined') return
    if (selectionGuardsRef.current) return
    const onSelectStart = (e: Event) => { e.preventDefault() }
    const onDragStart = (e: Event) => { e.preventDefault() }
    selectionGuardsRef.current = { onSelectStart, onDragStart, prevUserSelect: document.body.style.userSelect }
    document.documentElement.classList.add('dragging-no-select')
    document.body.style.userSelect = 'none'
    document.addEventListener('selectstart', onSelectStart, true)
    document.addEventListener('dragstart', onDragStart, true)
    try { window.getSelection()?.removeAllRanges?.() } catch {}
  }, [])

  const disableSelectionGuards = useCallback(() => {
    if (typeof document === 'undefined') return
    const g = selectionGuardsRef.current
    if (!g) return
    document.removeEventListener('selectstart', g.onSelectStart, true)
    document.removeEventListener('dragstart', g.onDragStart, true)
    document.documentElement.classList.remove('dragging-no-select')
    document.body.style.userSelect = g.prevUserSelect || ''
    selectionGuardsRef.current = null
  }, [])

  useEffect(() => {
    // Note: We no longer clear editor docs when switching notes
    // The composite key system (noteId-panelId) already isolates docs between notes
    // This allows content to load immediately when switching back to a previously viewed note
    
    // Check if we're in plain mode (explicit flag; avoids provider init race)
    const isPlainMode = isPlainModeActive()
    
    if (!isPlainMode) {
      // Initialize collaboration provider with YJS persistence
      const provider = UnifiedProvider.getInstance()
      
      // Set the current note context
      provider.setCurrentNote(noteId)
      
      // Check if this is a new note (check localStorage for existing data)
      const existingData = localStorage.getItem(`note-data-${noteId}`)
      const isNewNote = !existingData
      
      console.log('[AnnotationCanvas] Initializing note:', {
        noteId,
        hasExistingData: !!existingData,
        isNewNote
      })
      
      // Define default data for new notes
      const defaultData = {
        'main': {
          title: 'New Document',
          type: 'main',
          content: '', // Empty content for new documents
          branches: [],
          position: { x: 2000, y: 1500 },
          isEditable: true,
          // Mark as new to force edit mode
          isNew: isNewNote
        }
      }
      
      console.log('[AnnotationCanvas] Default data for main panel:', defaultData.main)
      
      // Initialize with defaults - the provider will merge with existing data if any
      // For new notes, this sets empty content
      // For existing notes, this preserves their content
      provider.initializeDefaultData(noteId, defaultData)
    }
    
    // Set main panel as the initial panel
    setCanvasItems([createPanelItem('main', { x: 2000, y: 1500 }, 'main')])

    return () => {
      // Don't destroy note when switching - only cleanup when truly unmounting
      // The provider's smart cache management will handle memory efficiently
      // This allows content to persist when switching between notes
    }
  }, [noteId])

  const handleCanvasMouseDown = (e: React.MouseEvent) => {
    // Only start dragging if clicking on canvas background
    // Don't drag if clicking on a panel or component
    const target = e.target as HTMLElement
    if (target.closest('.panel') || target.closest('[data-component-panel]')) return
    
    setCanvasState(prev => ({
      ...prev,
      isDragging: true,
      lastMouseX: e.clientX,
      lastMouseY: e.clientY
    }))
    
    enableSelectionGuards()
    document.body.style.userSelect = 'none'
    try { window.getSelection()?.removeAllRanges?.() } catch {}
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
    disableSelectionGuards()
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
    setCanvasItems(prev => prev.filter(item => !(isPanel(item) && item.panelId === panelId)))
  }

  const handleCreatePanel = (panelId: string) => {
    console.log('[AnnotationCanvas] Creating panel:', panelId)
    
    // Check if we're in plain mode
    const isPlainMode = isPlainModeActive()
    
    setCanvasItems(prev => {
      // Only add if not already present
      if (prev.some(item => isPanel(item) && item.panelId === panelId)) {
        return prev
      }
      
      if (isPlainMode) {
        // Plain mode: Check if panel data exists
        // Note: We'll need to get dataStore from context provider
        console.log('[Plain mode] Creating panel:', panelId)
      } else {
        // Ensure the provider knows about the current note
        const provider = UnifiedProvider.getInstance()
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
            const panel = UnifiedProvider.getInstance().getBranchesMap().get(id)
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
      
      // Determine panel type based on panelId
      const panelType = panelId === 'main' ? 'main' : 
                       panelId.includes('explore') ? 'explore' : 
                       panelId.includes('promote') ? 'promote' : 'note'
      
      return [...prev, createPanelItem(panelId, { x: 2000, y: 1500 }, panelType)]
    })
  }
  
  // Handle adding components
  const handleAddComponent = (type: string, position?: { x: number; y: number }) => {
    // Calculate position - center of viewport in world coordinates
    // The canvas translate is the offset, so we need to negate it to get world position
    const viewportCenterX = window.innerWidth / 2
    const viewportCenterY = window.innerHeight / 2
    
    // Convert from screen space to world space
    // World position = (Screen position - Canvas translate) / zoom
    const worldX = (-canvasState.translateX + viewportCenterX) / canvasState.zoom
    const worldY = (-canvasState.translateY + viewportCenterY) / canvasState.zoom
    
    // Center the component (component is ~350px wide, ~300px tall)
    const finalPosition = position || {
      x: worldX - 175,
      y: worldY - 150
    }
    
    const newComponent = createComponentItem(
      type as 'calculator' | 'timer' | 'editor' | 'dragtest',
      finalPosition
    )
    
    setCanvasItems(prev => [...prev, newComponent])
  }
  
  const handleComponentClose = (id: string) => {
    setCanvasItems(prev => prev.filter(item => item.id !== id))
  }
  
  const handleComponentPositionChange = (id: string, position: { x: number; y: number }) => {
    setCanvasItems(prev => prev.map(item => 
      item.id === id ? { ...item, position } : item
    ))
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
    },
    centerOnPanel: (panelId: string) => {
      const getPanelPosition = (id: string): { x: number; y: number } | null => {
        // 1) Try collaboration map if not in plain mode
        const provider = UnifiedProvider.getInstance()
        if (!isPlainModeActive()) {
          const branchesMap = provider.getBranchesMap()
          const branch = branchesMap?.get(id)
          if (branch?.position) return branch.position
        }
        
        // 2) DOM lookup (plain mode)
        const el = document.querySelector(`[data-panel-id="${id}"]`) as HTMLElement | null
        if (el) {
          const rect = el.getBoundingClientRect()
          const container = document.getElementById('canvas-container')
          const containerRect = container?.getBoundingClientRect()
          
          // Get the center of the panel relative to the container
          const screenX = (rect.left + rect.width / 2) - (containerRect?.left ?? 0)
          const screenY = (rect.top + rect.height / 2) - (containerRect?.top ?? 0)
          
          // Convert screen coordinates to world coordinates
          // The panel's world position when canvas has translate(tx, ty) scale(zoom):
          // screenPos = (worldPos + translate) * zoom
          // Therefore: worldPos = screenPos / zoom - translate
          const worldX = (screenX / canvasState.zoom) - canvasState.translateX
          const worldY = (screenY / canvasState.zoom) - canvasState.translateY
          
          return { x: worldX, y: worldY }
        }
        
        // 3) Don't use fallback immediately - return null to trigger retry
        return null
      }

      console.log(`[Canvas] Attempting to center on panel '${panelId}'`)
      
      // Retry mechanism: wait for panel to be in DOM
      let retryCount = 0
      const maxRetries = 10
      const retryDelay = 100 // ms
      
      const attemptCenter = () => {
        const position = getPanelPosition(panelId)
        
        if (position) {
          console.log(`[Canvas] Panel '${panelId}' found, centering...`)
          panToPanel(
            panelId,
            () => position, // Direct position since we already have it
            { x: canvasState.translateX, y: canvasState.translateY, zoom: canvasState.zoom },
            (viewportState) => setCanvasState(prev => ({
              ...prev,
              translateX: viewportState.x ?? prev.translateX,
              translateY: viewportState.y ?? prev.translateY,
              zoom: viewportState.zoom ?? prev.zoom,
            })),
            { duration: 400 }
          )
        } else if (retryCount < maxRetries) {
          retryCount++
          console.log(`[Canvas] Panel '${panelId}' not found, retry ${retryCount}/${maxRetries}`)
          setTimeout(attemptCenter, retryDelay)
        } else {
          // Final fallback: calculate viewport-centered position
          console.warn(`[Canvas] Panel '${panelId}' not found after ${maxRetries} retries, using viewport center`)
          
          // Calculate position to place panel at viewport center
          const viewportWidth = window.innerWidth
          const viewportHeight = window.innerHeight
          const panelWidth = 800
          const panelHeight = 600
          
          // Calculate world position that would appear centered
          const centerWorldX = (viewportWidth / 2 - panelWidth / 2) / canvasState.zoom - canvasState.translateX
          const centerWorldY = (viewportHeight / 2 - panelHeight / 2) / canvasState.zoom - canvasState.translateY
          
          // For new panels, we actually want them to appear centered
          // So we don't pan, we just note where they should be created
          console.log(`[Canvas] Panel should be created at world position (${centerWorldX}, ${centerWorldY}) to appear centered`)
        }
      }
      
      attemptCenter()
    }
  }), [onCanvasStateChange, canvasState])

  return (
    <CanvasProvider noteId={noteId}>
      <div className="w-screen h-screen overflow-hidden bg-gradient-to-br from-indigo-500 via-purple-500 to-pink-500">
        {/* Demo Header */}
        <div className="fixed top-0 left-0 right-0 bg-black/90 text-white p-3 text-xs font-medium z-[1000] border-b border-white/10">
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
        
        {/* Control Panel Toggle Button - Always visible */}
        <button
          onClick={() => setShowControlPanel(!showControlPanel)}
          className="fixed top-16 right-4 z-[900] p-3 bg-gray-900 hover:bg-gray-800 text-white rounded-lg shadow-lg transition-all duration-200 hover:scale-110"
          title="Toggle Control Panel"
        >
          <Settings size={20} />
        </button>
        
        {/* Add Components Button */}
        <button
          onClick={() => setShowAddComponentMenu(!showAddComponentMenu)}
          className="fixed top-16 right-20 z-[900] p-3 bg-gradient-to-r from-purple-600 to-blue-600 hover:from-purple-700 hover:to-blue-700 text-white rounded-lg shadow-lg transition-all duration-200 hover:scale-110"
          title="Add Components"
        >
          <Plus size={20} />
        </button>

        {/* Enhanced Control Panel */}
        <EnhancedControlPanel 
          visible={showControlPanel}
          onClose={() => setShowControlPanel(false)}
        />

        {/* Enhanced Minimap */}
        <EnhancedMinimap 
          canvasItems={canvasItems}
          canvasState={canvasState}
          onNavigate={(x, y) => setCanvasState(prev => ({ ...prev, translateX: x, translateY: y }))}
        />
        
        {/* Add Components Menu */}
        <AddComponentMenu 
          visible={showAddComponentMenu}
          onClose={() => setShowAddComponentMenu(false)}
          onAddComponent={handleAddComponent}
        />

        {/* Canvas Container */}
        <div 
          id="canvas-container"
          className={`relative w-full h-full cursor-grab overflow-hidden ${canvasState.isDragging ? 'cursor-grabbing' : ''}`}
          style={{
            // Isolate canvas painting to avoid cross-layer re-rasterization while dragging
            contain: 'layout paint',
            isolation: 'isolate',
            // Stabilize font rendering during transforms
            WebkitFontSmoothing: 'antialiased',
            textRendering: 'optimizeLegibility',
          }}
          onMouseDown={handleCanvasMouseDown}
          onWheel={handleWheel}
          onContextMenu={(e) => e.preventDefault()}
        >
          {/* Infinite Canvas */}
          <div 
            id="infinite-canvas"
            style={{
              position: 'absolute',
              // Use translate3d without rounding for smooth motion (infinite-canvas approach)
              transform: `translate3d(${canvasState.translateX}px, ${canvasState.translateY}px, 0) scale(${canvasState.zoom})`,
              transformOrigin: '0 0',
              // Critical: NO transition during drag to prevent text blinking
              transition: canvasState.isDragging ? 'none' : 'transform 0.3s ease',
              // Optimize GPU layers only during active drag
              willChange: canvasState.isDragging ? 'transform' : 'auto',
              // Force stable GPU layer composition
              backfaceVisibility: 'hidden' as const,
              transformStyle: 'preserve-3d' as const,
              backfaceVisibility: 'hidden',
              transformStyle: 'preserve-3d',
            }}
          >
            {/* Connection Lines */}
            {canvasState.showConnections && (
              <ConnectionLines canvasItems={canvasItems} />
            )}

            {/* Panels */}
            <PanelsRenderer
              noteId={noteId}
              canvasItems={canvasItems}
              onClose={handlePanelClose}
            />
            
            {/* Component Panels */}
            {canvasItems.filter(isComponent).map(component => (
              <ComponentPanel
                key={component.id}
                id={component.id}
                type={component.componentType!}
                position={component.position}
                onClose={handleComponentClose}
                onPositionChange={handleComponentPositionChange}
              />
            ))}
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
  canvasItems,
  onClose,
}: {
  noteId: string
  canvasItems: CanvasItem[]
  onClose: (id: string) => void
}) {
  const { dataStore } = useCanvas()
  const isPlainMode = isPlainModeActive()
  
  // Yjs access only when not in plain mode
  const provider = UnifiedProvider.getInstance()
  if (!isPlainMode) {
    provider.setCurrentNote(noteId)
  }
  const branchesMap = !isPlainMode ? provider.getBranchesMap() : null
  
  const panels = canvasItems.filter(isPanel)
  
  return (
    <>
      {panels.map((panel) => {
        const panelId = panel.panelId!
        const branch = isPlainMode ? dataStore.get(panelId) : branchesMap?.get(panelId)
        if (!branch) {
          console.warn(`[PanelsRenderer] Branch ${panelId} not found in ${isPlainMode ? 'plain' : 'yjs'} store`)
          return null
        }
        
        console.log(`[PanelsRenderer] Rendering panel ${panelId}:`, {
          hasContent: !!branch.content,
          contentLength: typeof branch.content === 'string' ? branch.content.length : 'N/A',
          isNew: branch.isNew,
          isEditable: branch.isEditable
        })
        
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
