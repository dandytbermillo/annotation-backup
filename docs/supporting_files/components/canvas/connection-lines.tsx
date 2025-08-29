"use client"

import { CollaborationProvider } from "@/lib/yjs-provider"

interface ConnectionLinesProps { panels: string[] }

export function ConnectionLines({ panels }: ConnectionLinesProps) {
  const provider = CollaborationProvider.getInstance()
  const branches = provider.getBranchesMap()
  const connections: Array<{ from: { x: number; y: number }; to: { x: number; y: number } }> = []
  panels.forEach(panelId => {
    const branch = branches.get(panelId)
    if (!branch || !branch.parentId) return
    const parentBranch = branches.get(branch.parentId)
    if (!parentBranch || !panels.includes(branch.parentId)) return
    const fromX = parentBranch.position.x + 800
    const fromY = parentBranch.position.y + 300
    const toX = branch.position.x
    const toY = branch.position.y + 300
    connections.push({ from: { x: fromX, y: fromY }, to: { x: toX, y: toY } })
  })
  return (
    <svg className="absolute inset-0 pointer-events-none" style={{ width: '10000px', height: '10000px', overflow: 'visible' }}>
      <defs>
        <linearGradient id="connectionGradient" x1="0%" y1="0%" x2="100%" y2="0%">
          <stop offset="0%" stopColor="#ffffff" stopOpacity="0.8" />
          <stop offset="100%" stopColor="#ffffff" stopOpacity="0.6" />
        </linearGradient>
      </defs>
      {connections.map((c, i) => { const midX = (c.from.x + c.to.x) / 2; return (
        <g key={i}>
          <path d={`M ${c.from.x} ${c.from.y} C ${midX} ${c.from.y}, ${midX} ${c.to.y}, ${c.to.x} ${c.to.y}`} fill="none" stroke="url(#connectionGradient)" strokeWidth="2" strokeDasharray="5 5" className="animate-pulse" />
          <polygon points={`${c.to.x},${c.to.y} ${c.to.x - 8},${c.to.y - 4} ${c.to.x - 8},${c.to.y + 4}`} fill="#ffffff" opacity="0.8" />
        </g>
      )})}
    </svg>
  )
}

