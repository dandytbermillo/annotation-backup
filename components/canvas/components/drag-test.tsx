"use client"

import React, { useState } from 'react'
import { MousePointer2, Zap, Activity, Move } from 'lucide-react'

interface DragTestProps {
  componentId: string
  state?: any
  onStateUpdate?: (state: any) => void
}

export function DragTest({ componentId, state, onStateUpdate }: DragTestProps) {
  const [dragCount, setDragCount] = useState(state?.dragCount || 0)
  const [lastDragTime, setLastDragTime] = useState<number | null>(null)
  const [dragSpeed, setDragSpeed] = useState(0)
  const [isDragging, setIsDragging] = useState(false)
  const [position, setPosition] = useState({ x: 0, y: 0 })
  const [dragDistance, setDragDistance] = useState(0)

  const handleDragStart = (e: React.MouseEvent) => {
    setIsDragging(true)
    setLastDragTime(Date.now())
    setPosition({ x: e.clientX, y: e.clientY })
  }

  const handleDragMove = (e: React.MouseEvent) => {
    if (!isDragging) return
    
    const now = Date.now()
    const deltaTime = lastDragTime ? now - lastDragTime : 0
    const deltaX = e.clientX - position.x
    const deltaY = e.clientY - position.y
    const distance = Math.sqrt(deltaX * deltaX + deltaY * deltaY)
    
    setDragDistance(prev => prev + distance)
    setPosition({ x: e.clientX, y: e.clientY })
    
    if (deltaTime > 0) {
      const speed = distance / deltaTime * 1000 // pixels per second
      setDragSpeed(Math.round(speed))
    }
    
    setLastDragTime(now)
  }

  const handleDragEnd = () => {
    if (isDragging) {
      setDragCount(prev => prev + 1)
      setIsDragging(false)
      onStateUpdate?.({ 
        dragCount: dragCount + 1,
        totalDistance: dragDistance
      })
    }
  }

  const resetStats = () => {
    setDragCount(0)
    setDragDistance(0)
    setDragSpeed(0)
  }

  return (
    <div className="drag-test-component p-4 bg-gray-900 rounded-lg">
      <div className="flex items-center mb-3">
        <MousePointer2 size={16} className="text-orange-400 mr-2" />
        <span className="text-xs text-gray-400">Drag Performance Test</span>
      </div>
      
      {/* Drag area */}
      <div 
        className={`
          relative h-32 mb-4 rounded-lg border-2 border-dashed
          ${isDragging ? 'border-orange-400 bg-orange-950/30' : 'border-gray-700 bg-gray-800'}
          cursor-move transition-colors
        `}
        onMouseDown={handleDragStart}
        onMouseMove={handleDragMove}
        onMouseUp={handleDragEnd}
        onMouseLeave={handleDragEnd}
      >
        <div className="absolute inset-0 flex items-center justify-center">
          <Move size={32} className={`${isDragging ? 'text-orange-400' : 'text-gray-600'}`} />
          <div className="absolute bottom-2 left-2 right-2 text-xs text-gray-400 text-center">
            {isDragging ? 'Dragging...' : 'Click and drag to test'}
          </div>
        </div>
      </div>
      
      {/* Stats */}
      <div className="grid grid-cols-2 gap-3 mb-3">
        <div className="bg-gray-800 p-2 rounded">
          <div className="flex items-center mb-1">
            <Activity size={14} className="text-blue-400 mr-1" />
            <span className="text-xs text-gray-400">Drag Count</span>
          </div>
          <div className="text-xl font-mono text-white">{dragCount}</div>
        </div>
        
        <div className="bg-gray-800 p-2 rounded">
          <div className="flex items-center mb-1">
            <Zap size={14} className="text-yellow-400 mr-1" />
            <span className="text-xs text-gray-400">Speed (px/s)</span>
          </div>
          <div className="text-xl font-mono text-white">{dragSpeed}</div>
        </div>
      </div>
      
      <div className="bg-gray-800 p-2 rounded mb-3">
        <div className="flex items-center mb-1">
          <Move size={14} className="text-green-400 mr-1" />
          <span className="text-xs text-gray-400">Total Distance</span>
        </div>
        <div className="text-xl font-mono text-white">{Math.round(dragDistance)}px</div>
      </div>
      
      {/* Reset button */}
      <button
        onClick={resetStats}
        className="w-full py-2 px-3 bg-gray-800 hover:bg-gray-700 text-white text-sm rounded transition-colors"
      >
        Reset Statistics
      </button>
    </div>
  )
}