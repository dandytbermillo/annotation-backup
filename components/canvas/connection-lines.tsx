"use client"

import { CollaborationProvider } from "@/lib/yjs-provider"

interface ConnectionLinesProps {
  panels: string[]
}

export function ConnectionLines({ panels }: ConnectionLinesProps) {
  const provider = CollaborationProvider.getInstance()
  const branches = provider.getBranchesMap()
  
  const connections: Array<{ from: { x: number; y: number }; to: { x: number; y: number } }> = []
  
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
      to: { x: toX, y: toY }
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
        <linearGradient id="connectionGradient" x1="0%" y1="0%" x2="100%" y2="0%">
          <stop offset="0%" stopColor="#ffffff" stopOpacity="0.8" />
          <stop offset="100%" stopColor="#ffffff" stopOpacity="0.6" />
        </linearGradient>
      </defs>
      
      {connections.map((connection, index) => {
        const midX = (connection.from.x + connection.to.x) / 2
        
        return (
          <g key={index}>
            <path
              d={`M ${connection.from.x} ${connection.from.y} 
                  C ${midX} ${connection.from.y}, 
                    ${midX} ${connection.to.y}, 
                    ${connection.to.x} ${connection.to.y}`}
              fill="none"
              stroke="url(#connectionGradient)"
              strokeWidth="2"
              strokeDasharray="5 5"
              className="animate-pulse"
            />
            
            {/* Arrow head */}
            <polygon
              points={`${connection.to.x},${connection.to.y} ${connection.to.x - 8},${connection.to.y - 4} ${connection.to.x - 8},${connection.to.y + 4}`}
              fill="#ffffff"
              opacity="0.8"
            />
          </g>
        )
      })}
    </svg>
  )
} 