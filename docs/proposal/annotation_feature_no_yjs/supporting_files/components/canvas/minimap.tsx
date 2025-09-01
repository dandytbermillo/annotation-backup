"use client"

import { CollaborationProvider } from "@/lib/yjs-provider"
import { useState, useEffect } from "react"

interface MinimapProps { panels: string[]; canvasState: { zoom: number; translateX: number; translateY: number }; onNavigate: (x: number, y: number) => void }

export function Minimap({ panels, canvasState, onNavigate }: MinimapProps) {
  const scale = 0.05
  const [windowSize, setWindowSize] = useState({ width: 1920, height: 1080 })
  useEffect(() => { const update = () => setWindowSize({ width: window.innerWidth, height: window.innerHeight }); update(); window.addEventListener('resize', update); return () => window.removeEventListener('resize', update) }, [])
  const handleMinimapClick = (e: React.MouseEvent<HTMLDivElement>) => { const rect = e.currentTarget.getBoundingClientRect(); const x = (e.clientX - rect.left) / scale; const y = (e.clientY - rect.top) / scale; onNavigate(-x + windowSize.width / 2, -y + windowSize.height / 2) }
  return (
    <div className="fixed bottom-4 right-4 bg-white/90 backdrop-blur-xl rounded-lg shadow-lg border border-gray-200 overflow-hidden z-[900]">
      <div className="relative cursor-pointer" style={{ width: '200px', height: '150px' }} onClick={handleMinimapClick}>
        <div className="absolute inset-0 bg-gradient-to-br from-indigo-100 to-purple-100" style={{ transform: `scale(${scale})`, transformOrigin: '0 0', width: `${100 / scale}%`, height: `${100 / scale}%` }}>
          {panels.map(panelId => {
            const provider = CollaborationProvider.getInstance()
            const branch = provider.getBranchesMap().get(panelId)
            if (!branch) return null
            const colors: any = { main: 'bg-gradient-to-br from-indigo-500 to-purple-600', note: 'bg-gradient-to-br from-blue-500 to-blue-600', explore: 'bg-gradient-to-br from-orange-500 to-orange-600', promote: 'bg-gradient-to-br from-green-500 to-green-600' }
            return (<div key={panelId} className={`absolute rounded ${colors[branch.type] || 'bg-gray-500'}`} style={{ left: `${branch.position.x}px`, top: `${branch.position.y}px`, width: '800px', height: '600px', opacity: 0.8 }} />)
          })}
        </div>
        <div className="absolute border-2 border-red-500 bg-red-500/10" style={{ left: `${(-canvasState.translateX) * scale}px`, top: `${(-canvasState.translateY) * scale}px`, width: `${(windowSize.width / canvasState.zoom) * scale}px`, height: `${(windowSize.height / canvasState.zoom) * scale}px` }} />
      </div>
    </div>
  )
}

