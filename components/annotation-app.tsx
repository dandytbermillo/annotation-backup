"use client"

import { useState, useRef } from "react"
import dynamic from 'next/dynamic'
import { NotesExplorer } from "./notes-explorer"
import { Menu } from "lucide-react"

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

export function AnnotationApp() {
  const [selectedNoteId, setSelectedNoteId] = useState<string | null>(null)
  const [isNotesExplorerOpen, setIsNotesExplorerOpen] = useState(true)
  const [canvasState, setCanvasState] = useState({
    zoom: 1,
    showConnections: true
  })
  
  // Ref to access canvas methods
  const canvasRef = useRef<any>(null)

  const openNotesExplorer = () => {
    setIsNotesExplorerOpen(true)
  }

  const closeNotesExplorer = () => {
    setIsNotesExplorerOpen(false)
  }

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

  return (
    <div className="flex h-screen w-screen overflow-hidden relative">
      {/* Backdrop Overlay */}
      {isNotesExplorerOpen && (
        <div 
          className="fixed inset-0 bg-black bg-opacity-30 z-40 lg:hidden"
          onClick={closeNotesExplorer}
        />
      )}
      
      {/* Notes Explorer - Sliding Panel */}
      <NotesExplorer 
        onNoteSelect={setSelectedNoteId} 
        isOpen={isNotesExplorerOpen}
        onClose={closeNotesExplorer}
        zoom={canvasState.zoom * 100}
        onZoomIn={handleZoomIn}
        onZoomOut={handleZoomOut}
        onResetView={handleResetView}
        onToggleConnections={handleToggleConnections}
        showConnections={canvasState.showConnections}
      />
      
      {/* Toggle Button - Shows when explorer is closed */}
      {!isNotesExplorerOpen && (
        <button
          onClick={openNotesExplorer}
          className="fixed top-4 left-4 z-30 p-2 bg-indigo-600 hover:bg-indigo-700 text-white rounded-lg shadow-lg transition-colors"
        >
          <Menu size={20} />
        </button>
      )}
      
      {/* Canvas Area - Full width when explorer is closed */}
      <div className={`flex-1 relative transition-all duration-300 ease-in-out ${
        isNotesExplorerOpen ? 'lg:ml-80' : 'ml-0'
      }`}>
        {selectedNoteId ? (
          <ModernAnnotationCanvas 
            key={selectedNoteId} 
            noteId={selectedNoteId}
            ref={canvasRef}
            isNotesExplorerOpen={isNotesExplorerOpen}
            onCanvasStateChange={setCanvasState}
          />
        ) : (
          <div className="w-full h-full flex items-center justify-center bg-gray-950">
            <div className="text-center">
              <h2 className="text-3xl font-bold text-gray-600 mb-4">
                Welcome to Annotation Canvas
              </h2>
              <p className="text-gray-500 mb-6">
                Select a note from the explorer or create a new one to get started
              </p>
              {!isNotesExplorerOpen && (
                <button
                  onClick={openNotesExplorer}
                  className="px-6 py-3 bg-indigo-600 hover:bg-indigo-700 text-white rounded-lg transition-colors"
                >
                  Open Notes Explorer
                </button>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  )
} 