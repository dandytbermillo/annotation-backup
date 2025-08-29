"use client"

import { CollaborationProvider } from "@/lib/yjs-provider"
import { getPlainProvider } from "@/lib/provider-switcher"
import { getAnnotationColor } from "@/lib/models/annotation"
import { useCanvas } from "./canvas-context"

interface ConnectionLinesProps {
  panels: string[]
}

export function ConnectionLines({ panels }: ConnectionLinesProps) {
  const { dataStore } = useCanvas()
  const plainProvider = getPlainProvider()
  const isPlainMode = !!plainProvider
  
  // Get branches based on mode
  const branches = isPlainMode 
    ? dataStore 
    : CollaborationProvider.getInstance().getBranchesMap()
  
  const connections: Array<{ 
    from: { x: number; y: number }; 
    to: { x: number; y: number };
    type: 'note' | 'explore' | 'promote';
  }> = []
  
  // Build connections array
  panels.forEach(panelId => {
    const branch = branches.get(panelId)
    if (!branch || !branch.parentId) return
    
    const parentBranch = branches.get(branch.parentId)
    if (!parentBranch || !panels.includes(branch.parentId)) return
    
    // Calculate connection points
    const fromX = parentBranch.position.x + 800 // Panel width
    const fromY = parentBranch.position.y + 300 // Half panel height
    const toX = branch.position.x
    const toY = branch.position.y + 300
    
    connections.push({
      from: { x: fromX, y: fromY },
      to: { x: toX, y: toY },
      type: branch.type || 'note'
    })
  })
  
  return (
    <svg
      className="absolute inset-0 pointer-events-none"
      style={{
        width: '10000px',
        height: '10000px',
        overflow: 'visible',
      }}
    >
      <defs>
        {/* Note gradient - Blue */}
        <linearGradient id="noteGradient" x1="0%" y1="0%" x2="100%" y2="0%">
          <stop offset="0%" stopColor="#3498db" stopOpacity="0.8" />
          <stop offset="100%" stopColor="#2980b9" stopOpacity="0.6" />
        </linearGradient>
        
        {/* Explore gradient - Orange */}
        <linearGradient id="exploreGradient" x1="0%" y1="0%" x2="100%" y2="0%">
          <stop offset="0%" stopColor="#f39c12" stopOpacity="0.8" />
          <stop offset="100%" stopColor="#e67e22" stopOpacity="0.6" />
        </linearGradient>
        
        {/* Promote gradient - Green */}
        <linearGradient id="promoteGradient" x1="0%" y1="0%" x2="100%" y2="0%">
          <stop offset="0%" stopColor="#27ae60" stopOpacity="0.8" />
          <stop offset="100%" stopColor="#229954" stopOpacity="0.6" />
        </linearGradient>
      </defs>
      
      {connections.map((connection, index) => {
        const midX = (connection.from.x + connection.to.x) / 2
        const gradientId = `${connection.type}Gradient`
        const color = getAnnotationColor(connection.type)
        
        return (
          <g key={index}>
            {/* Shadow for depth */}
            <path
              d={`M ${connection.from.x} ${connection.from.y} 
                  C ${midX} ${connection.from.y}, 
                    ${midX} ${connection.to.y}, 
                    ${connection.to.x} ${connection.to.y}`}
              fill="none"
              stroke="rgba(0,0,0,0.2)"
              strokeWidth="4"
              filter="blur(2px)"
              transform="translate(2, 2)"
            />
            
            {/* Main curved line */}
            <path
              d={`M ${connection.from.x} ${connection.from.y} 
                  C ${midX} ${connection.from.y}, 
                    ${midX} ${connection.to.y}, 
                    ${connection.to.x} ${connection.to.y}`}
              fill="none"
              stroke={`url(#${gradientId})`}
              strokeWidth="3"
              strokeLinecap="round"
              className="transition-all duration-300 hover:stroke-width-4"
            />
            
            {/* Arrow head with matching color */}
            <polygon
              points={`${connection.to.x},${connection.to.y} ${connection.to.x - 10},${connection.to.y - 5} ${connection.to.x - 10},${connection.to.y + 5}`}
              fill={color}
              opacity="0.9"
            />
            
            {/* Connection point indicators */}
            <circle
              cx={connection.from.x}
              cy={connection.from.y}
              r="4"
              fill={color}
              opacity="0.8"
            />
            <circle
              cx={connection.to.x}
              cy={connection.to.y}
              r="4"
              fill={color}
              opacity="0.8"
            />
          </g>
        )
      })}
    </svg>
  )
} 