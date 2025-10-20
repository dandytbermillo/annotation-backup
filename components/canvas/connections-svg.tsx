"use client"

import { useCanvas } from "./canvas-context"
import { useEffect, useRef } from "react"
import { ensurePanelKey, parsePanelKey } from "@/lib/canvas/composite-id"
import { debugLog } from "@/lib/utils/debug-logger"

export function ConnectionsSvg() {
  const { state, dataStore, noteId } = useCanvas()
  const svgRef = useRef<SVGSVGElement>(null)

  useEffect(() => {
    if (!state.canvasState.showConnections || !svgRef.current) return

    debugLog({
      component: 'ConnectionsSvg',
      action: 'draw_connections_start',
      metadata: {
        noteId: noteId || '',
        panelsCount: state.panels.size,
        showConnections: state.canvasState.showConnections
      },
      content_preview: `Drawing connections for ${state.panels.size} panels`
    })

    // Clear existing paths
    const svg = svgRef.current
    const existingPaths = svg.querySelectorAll("path")
    existingPaths.forEach((path) => path.remove())

    // Draw connections
    state.panels.forEach((panel, compositeKey) => {
      const parsed = parsePanelKey(typeof compositeKey === 'string' ? compositeKey : '')
      const panelNoteId = parsed?.noteId || noteId || ''
      const panelId = parsed?.panelId || panel.branchId

      const branchStoreKey = ensurePanelKey(panelNoteId, panel.branchId)
      const branch = dataStore.get(branchStoreKey)

      debugLog({
        component: 'ConnectionsSvg',
        action: 'check_panel',
        metadata: {
          noteId: panelNoteId,
          panelBranchId: panel.branchId,
          compositeKey,
          branchStoreKey,
          hasBranchData: !!branch,
          branchParentId: branch?.parentId || 'NO_PARENT',
          branchType: branch?.type || 'NO_TYPE'
        },
        content_preview: `Panel ${panel.branchId}: parent=${branch?.parentId || 'NONE'}`
      })

      if (branch && branch.parentId) {
        // CRITICAL FIX: Use composite key to lookup parent panel
        const parentStoreKey = ensurePanelKey(panelNoteId, branch.parentId)
        const parentPanel = state.panels.get(parentStoreKey)

        debugLog({
          component: 'ConnectionsSvg',
          action: 'check_parent_panel',
          metadata: {
            noteId: panelNoteId,
            branchId: panel.branchId,
            parentId: branch.parentId,
            panelCompositeKey: compositeKey,
            parentStoreKey,
            hasParentPanel: !!parentPanel,
            allPanelIds: Array.from(state.panels.keys())
          },
          content_preview: `Parent panel ${parentStoreKey} ${parentPanel ? 'FOUND' : 'NOT_FOUND'}`
        })

        if (parentPanel) {
          debugLog({
            component: 'ConnectionsSvg',
            action: 'draw_connection',
            metadata: {
              noteId: noteId || '',
              fromId: branch.parentId,
              toId: panel.branchId,
              type: branch.type
            },
            content_preview: `Drawing: ${branch.parentId} → ${panel.branchId}`
          })
          drawConnection(compositeKey, parentStoreKey, branch.type)
        }
      }
    })
  }, [state.panels, state.canvasState.showConnections, dataStore, noteId])

  const drawConnection = (childKey: string, parentKey: string, type: string) => {
    // CRITICAL FIX: Use composite keys to lookup panels
    const childPanel = state.panels.get(childKey)
    const parentPanel = state.panels.get(parentKey)
    const svg = svgRef.current

    if (!childPanel || !parentPanel || !svg) return

    const childParsed = parsePanelKey(childKey) || { noteId: noteId || '', panelId: childPanel.branchId }
    const parentParsed = parsePanelKey(parentKey) || { noteId: noteId || '', panelId: parentPanel.branchId }

    const childStoreKey = ensurePanelKey(childParsed.noteId, childParsed.panelId)
    const parentStoreKey = ensurePanelKey(parentParsed.noteId, parentParsed.panelId)

    const childBranch = dataStore.get(childStoreKey)
    const parentBranch = dataStore.get(parentStoreKey)

    if (!childBranch || !parentBranch) {
      debugLog({
        component: 'ConnectionsSvg',
        action: 'missing_branch_for_connection',
        metadata: {
          childKey,
          parentKey,
          childStoreKey,
          parentStoreKey,
          childHasBranch: !!childBranch,
          parentHasBranch: !!parentBranch
        }
      })
      return
    }

    const fromX = parentBranch.position.x + 800 // PANEL_WIDTH
    const fromY = parentBranch.position.y + 300 // PANEL_HEIGHT / 2
    const toX = childBranch.position.x
    const toY = childBranch.position.y + 300

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
