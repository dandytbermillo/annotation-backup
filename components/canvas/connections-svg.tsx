"use client"

import { useCanvas } from "./canvas-context"
import { useEffect, useRef } from "react"
import { ensurePanelKey } from "@/lib/canvas/composite-id"

export function ConnectionsSvg() {
  const { state, dataStore, noteId } = useCanvas()
  const svgRef = useRef<SVGSVGElement>(null)

  useEffect(() => {
    if (!state.canvasState.showConnections || !svgRef.current) return

    // Clear existing paths
    const svg = svgRef.current
    const existingPaths = svg.querySelectorAll("path")
    existingPaths.forEach((path) => path.remove())

    // Draw connections
    state.panels.forEach((panel) => {
      const branchStoreKey = ensurePanelKey(noteId || '', panel.branchId)
      const branch = dataStore.get(branchStoreKey)
      if (branch && branch.parentId) {
        const parentPanel = state.panels.get(branch.parentId)
        if (parentPanel) {
          drawConnection(panel.branchId, branch.parentId, branch.type)
        }
      }
    })
  }, [state.panels, state.canvasState.showConnections, dataStore, noteId])

  const drawConnection = (fromId: string, toId: string, type: string) => {
    const fromPanel = state.panels.get(toId)
    const toPanel = state.panels.get(fromId)
    const svg = svgRef.current

    if (!fromPanel || !toPanel || !svg) return

    const fromStoreKey = ensurePanelKey(noteId || '', toId)
    const toStoreKey = ensurePanelKey(noteId || '', fromId)
    const fromBranch = dataStore.get(fromStoreKey)
    const toBranch = dataStore.get(toStoreKey)

    const fromX = fromBranch.position.x + 800 // PANEL_WIDTH
    const fromY = fromBranch.position.y + 300 // PANEL_HEIGHT / 2
    const toX = toBranch.position.x
    const toY = toBranch.position.y + 300

    const pathData = createSmoothCurve(fromX, fromY, toX, toY)

    const path = document.createElementNS("http://www.w3.org/2000/svg", "path")
    path.setAttribute("d", pathData)
    path.setAttribute("class", `workflow-curve ${type}`)
    path.setAttribute("marker-end", `url(#arrow-end-${type})`)

    svg.appendChild(path)
  }

  const createSmoothCurve = (fromX: number, fromY: number, toX: number, toY: number) => {
    const dx = toX - fromX
    const tension = Math.min(Math.abs(dx) * 0.5, 150)
    const controlX1 = fromX + tension
    const controlY1 = fromY
    const controlX2 = toX - tension
    const controlY2 = toY

    return `M ${fromX} ${fromY} C ${controlX1} ${controlY1}, ${controlX2} ${controlY2}, ${toX} ${toY}`
  }

  return (
    <svg
      ref={svgRef}
      className="connections-svg absolute top-0 left-0 w-full h-full pointer-events-none z-0"
      style={{
        stroke: "#00ff88",
        strokeWidth: 3,
        fill: "none",
        strokeLinecap: "round",
        strokeLinejoin: "round",
      }}
    >
      <defs>
        <marker
          id="arrow-end"
          markerWidth="10"
          markerHeight="10"
          refX="9"
          refY="3"
          orient="auto"
          markerUnits="strokeWidth"
        >
          <path d="M0,0 L0,6 L9,3 z" fill="#00ff88" stroke="none" />
        </marker>
        <marker
          id="arrow-end-note"
          markerWidth="10"
          markerHeight="10"
          refX="9"
          refY="3"
          orient="auto"
          markerUnits="strokeWidth"
        >
          <path d="M0,0 L0,6 L9,3 z" fill="#2196f3" stroke="none" />
        </marker>
        <marker
          id="arrow-end-explore"
          markerWidth="10"
          markerHeight="10"
          refX="9"
          refY="3"
          orient="auto"
          markerUnits="strokeWidth"
        >
          <path d="M0,0 L0,6 L9,3 z" fill="#ff9800" stroke="none" />
        </marker>
        <marker
          id="arrow-end-promote"
          markerWidth="10"
          markerHeight="10"
          refX="9"
          refY="3"
          orient="auto"
          markerUnits="strokeWidth"
        >
          <path d="M0,0 L0,6 L9,3 z" fill="#4caf50" stroke="none" />
        </marker>
      </defs>
    </svg>
  )
}
