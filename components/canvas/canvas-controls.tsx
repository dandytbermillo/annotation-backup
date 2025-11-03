"use client"

import { Z_INDEX } from "@/lib/constants/z-index"

interface CanvasControlsProps {
  zoom: number
  onZoomIn: () => void
  onZoomOut: () => void
  onResetView: () => void
  onToggleConnections: () => void
  showConnections: boolean
}

export function CanvasControls({ 
  zoom, 
  onZoomIn, 
  onZoomOut, 
  onResetView, 
  onToggleConnections,
  showConnections 
}: CanvasControlsProps) {
  return (
    <div
      className="fixed top-16 left-4 flex flex-col gap-3"
      style={{ zIndex: Z_INDEX.CANVAS_MINIMAP }}
    >
      {/* Navigation Panel */}
      <div className="bg-white/90 backdrop-blur-xl rounded-lg shadow-lg p-3 border border-gray-200">
        <div className="text-xs font-semibold text-gray-700 mb-2">Navigation</div>
        <div className="flex flex-col gap-2">
        <button
            onClick={onResetView}
            className="flex items-center gap-2 px-3 py-2 bg-white hover:bg-gray-50 rounded-md text-sm font-medium text-gray-700 transition-colors border border-gray-200"
        >
          🏠 Reset View
        </button>
        <button
            onClick={onZoomIn}
            className="flex items-center gap-2 px-3 py-2 bg-white hover:bg-gray-50 rounded-md text-sm font-medium text-gray-700 transition-colors border border-gray-200"
        >
          🔍 Zoom In
        </button>
        <button
            onClick={onZoomOut}
            className="flex items-center gap-2 px-3 py-2 bg-white hover:bg-gray-50 rounded-md text-sm font-medium text-gray-700 transition-colors border border-gray-200"
        >
          🔍 Zoom Out
        </button>
          <div className="text-center py-1 px-3 bg-gray-100 rounded-md text-sm font-medium text-gray-600">
            {Math.round(zoom * 100)}%
          </div>
        </div>
      </div>

      {/* Connections Panel */}
      <div className="bg-white/90 backdrop-blur-xl rounded-lg shadow-lg p-3 border border-gray-200">
        <div className="text-xs font-semibold text-gray-700 mb-2">Connections</div>
        <button
          onClick={onToggleConnections}
          className={`w-full px-3 py-2 rounded-md text-sm font-medium transition-colors border ${
            showConnections 
              ? 'bg-indigo-500 text-white border-indigo-600 hover:bg-indigo-600' 
              : 'bg-white text-gray-700 border-gray-200 hover:bg-gray-50'
          }`}
        >
          Toggle Lines
        </button>
      </div>
    </div>
  )
}
