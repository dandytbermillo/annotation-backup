"use client"

import { useEffect, useState, forwardRef, useImperativeHandle } from "react"
import { CanvasProvider } from "./canvas/canvas-context"
import { CanvasPanel } from "./canvas/canvas-panel"
import { AnnotationToolbar } from "./canvas/annotation-toolbar"
import { CollaborationProvider } from "@/lib/yjs-provider"
import { CanvasControls } from "./canvas/canvas-controls"
import { Minimap } from "./canvas/minimap"
import { ConnectionLines } from "./canvas/connection-lines"

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

const ModernAnnotationCanvas = forwardRef<CanvasImperativeHandle, ModernAnnotationCanvasProps>(({ noteId, isNotesExplorerOpen = false, onCanvasStateChange }, ref) => {
  const [canvasState, setCanvasState] = useState({ zoom: 1, translateX: -1000, translateY: -1200, isDragging: false, lastMouseX: 0, lastMouseY: 0, showConnections: true })
  const [panels, setPanels] = useState<string[]>([])

  useEffect(() => {
    const provider = CollaborationProvider.getInstance()
    const defaultData = { 'main': { title: 'New Document', type: 'main', content: `<p>Start writing your document here...</p>`, branches: [], position: { x: 2000, y: 1500 }, isEditable: true } }
    provider.initializeDefaultData(noteId, defaultData)
    setPanels(['main'])
    return () => { provider.destroyNote(noteId) }
  }, [noteId])

  const handleCanvasMouseDown = (e: React.MouseEvent) => { if ((e.target as HTMLElement).closest('.panel')) return; setCanvasState(prev => ({ ...prev, isDragging: true, lastMouseX: e.clientX, lastMouseY: e.clientY })); document.body.style.userSelect = 'none'; e.preventDefault() }
  const handleCanvasMouseMove = (e: MouseEvent) => { if (!canvasState.isDragging) return; const deltaX = e.clientX - canvasState.lastMouseX; const deltaY = e.clientY - canvasState.lastMouseY; setCanvasState(prev => ({ ...prev, translateX: prev.translateX + deltaX, translateY: prev.translateY + deltaY, lastMouseX: e.clientX, lastMouseY: e.clientY })) }
  const handleCanvasMouseUp = () => { setCanvasState(prev => ({ ...prev, isDragging: false })); document.body.style.userSelect = '' }
  const handleWheel = (e: React.WheelEvent) => { e.preventDefault(); const zoomFactor = e.deltaY > 0 ? 0.9 : 1.1; const newZoom = Math.max(0.3, Math.min(2, canvasState.zoom * zoomFactor)); const rect = e.currentTarget.getBoundingClientRect(); const mouseX = e.clientX - rect.left; const mouseY = e.clientY - rect.top; const zoomChange = newZoom / canvasState.zoom; setCanvasState(prev => ({ ...prev, zoom: newZoom, translateX: mouseX - (mouseX - prev.translateX) * zoomChange, translateY: mouseY - (mouseY - prev.translateY) * zoomChange })) }

  useEffect(() => { document.addEventListener('mousemove', handleCanvasMouseMove); document.addEventListener('mouseup', handleCanvasMouseUp); return () => { document.removeEventListener('mousemove', handleCanvasMouseMove); document.removeEventListener('mouseup', handleCanvasMouseUp) } }, [canvasState.isDragging, canvasState.lastMouseX, canvasState.lastMouseY])
  const handlePanelClose = (panelId: string) => { setPanels(prev => prev.filter(id => id !== panelId)) }
  const handleCreatePanel = (panelId: string) => { setPanels(prev => { if (prev.includes(panelId)) return prev; const provider = CollaborationProvider.getInstance(); provider.setCurrentNote(noteId); const panelData = provider.getBranchesMap().get(panelId); if (!panelData) return prev; return [...prev, panelId] }) }
  useEffect(() => { const handlePanelEvent = (event: CustomEvent) => { if (event.detail?.panelId) handleCreatePanel(event.detail.panelId) }; window.addEventListener('create-panel' as any, handlePanelEvent); return () => { window.removeEventListener('create-panel' as any, handlePanelEvent) } }, [noteId])

  useImperativeHandle(ref, () => ({
    zoomIn: () => setCanvasState(prev => { const newZoom = Math.min(prev.zoom * 1.1, 2); onCanvasStateChange?.({ zoom: newZoom, showConnections: prev.showConnections }); return { ...prev, zoom: newZoom } }),
    zoomOut: () => setCanvasState(prev => { const newZoom = Math.max(prev.zoom * 0.9, 0.3); onCanvasStateChange?.({ zoom: newZoom, showConnections: prev.showConnections }); return { ...prev, zoom: newZoom } }),
    resetView: () => setCanvasState(prev => { const ns = { ...prev, zoom: 1, translateX: -1000, translateY: -1200 }; onCanvasStateChange?.({ zoom: 1, showConnections: prev.showConnections }); return ns }),
    toggleConnections: () => setCanvasState(prev => { const sc = !prev.showConnections; onCanvasStateChange?.({ zoom: prev.zoom, showConnections: sc }); return { ...prev, showConnections: sc } }),
  }), [onCanvasStateChange])

  return (
    <CanvasProvider noteId={noteId}>
      <div className="w-screen h-screen overflow-hidden bg-gradient-to-br from-indigo-500 via-purple-500 to-pink-500">
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

        <Minimap panels={panels} canvasState={canvasState} onNavigate={(x, y) => setCanvasState(prev => ({ ...prev, translateX: x, translateY: y }))} />

        <div id="canvas-container" className={`relative w-full h-full cursor-grab overflow-hidden ${canvasState.isDragging ? 'cursor-grabbing' : ''}`} onMouseDown={handleCanvasMouseDown} onWheel={handleWheel} onContextMenu={(e) => e.preventDefault()}>
          <div id="infinite-canvas" style={{ position: 'absolute', transform: `translate(${canvasState.translateX}px, ${canvasState.translateY}px) scale(${canvasState.zoom})`, transformOrigin: '0 0', transition: canvasState.isDragging ? 'none' : 'transform 0.3s ease' }}>
            <ConnectionLines panels={panels} />
            {panels.map(panelId => {
              const provider = CollaborationProvider.getInstance(); provider.setCurrentNote(noteId)
              const branchesMap = provider.getBranchesMap(); const branch = branchesMap.get(panelId)
              if (!branch) { console.warn(`Branch ${panelId} not found`); return null }
              const pos = branch?.position || { x: 2000, y: 1500 }
              return (
                <CanvasPanel key={panelId} panelId={panelId} branch={branch} position={pos} noteId={noteId} onClose={panelId !== 'main' ? () => handlePanelClose(panelId) : undefined} />
              )
            })}
          </div>
        </div>

        <AnnotationToolbar />
      </div>
    </CanvasProvider>
  )
})

ModernAnnotationCanvas.displayName = 'ModernAnnotationCanvas'
export default ModernAnnotationCanvas

