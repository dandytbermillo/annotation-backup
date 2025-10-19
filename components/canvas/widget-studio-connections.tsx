"use client"

import { useEffect, useMemo, useRef, useState } from "react"

import { useCanvas } from "./canvas-context"
import { CanvasItem, isPanel } from "@/types/canvas-items"
import { UnifiedProvider } from "@/lib/provider-switcher"
import { isPlainModeActive } from "@/lib/collab-mode"
import { ensurePanelKey } from "@/lib/canvas/composite-id"
import { debugLog } from "@/lib/utils/debug-logger"

interface WidgetStudioConnectionsProps {
  canvasItems: CanvasItem[]
  branchVersion?: number
}

interface ConnectionPoint {
  x: number
  y: number
}

interface Connection {
  id: string
  from: ConnectionPoint
  to: ConnectionPoint
  type: "note" | "explore" | "promote"
  label?: string
}

const PANEL_DEFAULT_WIDTH = 800
const PANEL_DEFAULT_HEIGHT = 600

/**
 * Widget Studio style connections
 * - Always horizontal entry/exit (right to left)
 * - Smooth Bézier S-curves
 * - Clean, minimal styling
 * - Hover effects
 */
export function WidgetStudioConnections({ canvasItems, branchVersion = 0 }: WidgetStudioConnectionsProps) {
  const { dataStore, noteId } = useCanvas()
  const isPlainMode = isPlainModeActive()

  // Force recomputation when the plain data store mutates while the reference stays stable.
  const [dataStoreVersion, setDataStoreVersion] = useState(0)
  const scheduleRef = useRef(false)

  useEffect(() => {
    if (!isPlainMode || !dataStore?.on) return

    const handleChange = () => {
      if (scheduleRef.current) return
      scheduleRef.current = true

      const run = () => {
        scheduleRef.current = false
        setDataStoreVersion((version) => version + 1)
      }

      if (typeof queueMicrotask === "function") {
        queueMicrotask(run)
      } else {
        Promise.resolve().then(run).catch(() => {
          scheduleRef.current = false
        })
      }
    }

    dataStore.on("set", handleChange)
    dataStore.on("update", handleChange)
    dataStore.on("delete", handleChange)

    return () => {
      scheduleRef.current = false
      dataStore.off("set", handleChange)
      dataStore.off("update", handleChange)
      dataStore.off("delete", handleChange)
    }
  }, [dataStore, isPlainMode])

  const panels = useMemo(() => canvasItems.filter(isPanel), [canvasItems])

  // Helper to get branch data using the correct noteId
  const getBranchData = useMemo(() => {
    return (panelId: string, panelNoteId?: string) => {
      if (isPlainMode) {
        // Use the panel's noteId if available, otherwise fallback to canvas noteId
        const effectiveNoteId = panelNoteId || noteId || ''
        const compositeKey = ensurePanelKey(effectiveNoteId, panelId)
        return dataStore.get(compositeKey)
      } else {
        const branchesMap = UnifiedProvider.getInstance().getBranchesMap()
        const effectiveNoteId = panelNoteId || noteId || ''
        const compositeKey = ensurePanelKey(effectiveNoteId, panelId)
        return branchesMap.get(compositeKey) || dataStore.get(compositeKey)
      }
    }
  }, [dataStore, isPlainMode, noteId])

  const connections: Connection[] = useMemo(() => {
    debugLog({
      component: 'WidgetStudioConnections',
      action: 'recompute_connections_start',
      metadata: {
        panelsCount: panels.length,
        noteId: noteId || 'NO_NOTE_ID',
        branchVersion,
        dataStoreVersion
      },
      content_preview: `Recomputing connections for ${panels.length} panels`
    })

    if (panels.length === 0) {
      return []
    }

    // Use composite keys to avoid collisions when multiple notes have panels with same panelId
    const panelMap = new Map<string, CanvasItem>()
    panels.forEach((panel) => {
      if (panel.panelId) {
        const key = panel.storeKey || ensurePanelKey(panel.noteId || noteId || '', panel.panelId)
        panelMap.set(key, panel)
      }
    })

    debugLog({
      component: 'WidgetStudioConnections',
      action: 'panelMap_built',
      metadata: {
        panelMapSize: panelMap.size,
        panelMapKeys: Array.from(panelMap.keys()),
        panelDetails: Array.from(panelMap.entries()).map(([key, panel]) => ({
          key,
          panelId: panel.panelId,
          noteId: panel.noteId,
          hasPosition: !!panel.position
        }))
      },
      content_preview: `Built panelMap with ${panelMap.size} entries`
    })

    const seen = new Set<string>()
    const result: Connection[] = []

    const addConnection = (parentId: string, childId: string, childNoteId: string) => {
      const key = `${parentId}::${childId}`

      debugLog({
        component: 'WidgetStudioConnections',
        action: 'addConnection_start',
        metadata: {
          parentId,
          childId,
          childNoteId,
          connectionKey: key,
          alreadySeen: seen.has(key)
        },
        content_preview: `Attempting connection: ${parentId} → ${childId}`
      })

      if (seen.has(key)) {
        debugLog({
          component: 'WidgetStudioConnections',
          action: 'addConnection_skipped_duplicate',
          metadata: { key },
          content_preview: `Connection ${key} already exists`
        })
        return
      }

      // Use composite keys for panel lookup to avoid confusion across different notes
      const parentKey = ensurePanelKey(childNoteId, parentId)
      const childKey = ensurePanelKey(childNoteId, childId)

      debugLog({
        component: 'WidgetStudioConnections',
        action: 'panel_lookup',
        metadata: {
          parentKey,
          childKey,
          panelMapSize: panelMap.size,
          panelMapKeys: Array.from(panelMap.keys())
        },
        content_preview: `Looking up panels: parent=${parentKey}, child=${childKey}`
      })

      const parentPanel = panelMap.get(parentKey)
      const childPanel = panelMap.get(childKey)

      if (!parentPanel || !childPanel) {
        debugLog({
          component: 'WidgetStudioConnections',
          action: 'addConnection_failed_panel_not_found',
          metadata: {
            parentKey,
            childKey,
            hasParentPanel: !!parentPanel,
            hasChildPanel: !!childPanel
          },
          content_preview: `Panel not found: parent=${!!parentPanel}, child=${!!childPanel}`
        })
        return
      }

      const parentBranch = getBranchData(parentId, childNoteId)
      const childBranch = getBranchData(childId, childNoteId)

      if (!parentBranch || !childBranch) {
        debugLog({
          component: 'WidgetStudioConnections',
          action: 'addConnection_failed_branch_not_found',
          metadata: {
            parentId,
            childId,
            hasParentBranch: !!parentBranch,
            hasChildBranch: !!childBranch
          },
          content_preview: `Branch not found: parent=${!!parentBranch}, child=${!!childBranch}`
        })
        return
      }

      const parentPos =
        parentPanel.position ??
        parentBranch?.worldPosition ??
        parentBranch?.position
      const childPos =
        childPanel.position ??
        childBranch?.worldPosition ??
        childBranch?.position
      if (!parentPos || !childPos) return

      const parentWidth = parentPanel.dimensions?.width ?? PANEL_DEFAULT_WIDTH
      const parentHeight = parentPanel.dimensions?.height ?? PANEL_DEFAULT_HEIGHT
      const childHeight = childPanel.dimensions?.height ?? PANEL_DEFAULT_HEIGHT

      const from: ConnectionPoint = {
        x: parentPos.x + parentWidth,
        y: parentPos.y + parentHeight / 2,
      }

      const to: ConnectionPoint = {
        x: childPos.x,
        y: childPos.y + childHeight / 2,
      }

      result.push({
        id: key,
        from,
        to,
        type: normalizeType(childBranch.type),
        label: undefined,
      })
      seen.add(key)

      debugLog({
        component: 'WidgetStudioConnections',
        action: 'addConnection_success',
        metadata: {
          connectionKey: key,
          from,
          to,
          type: normalizeType(childBranch.type)
        },
        content_preview: `Connection created: ${parentId} → ${childId}`
      })
    }

    panels.forEach((panel) => {
      const panelId = panel.panelId
      if (!panelId) return

      debugLog({
        component: 'WidgetStudioConnections',
        action: 'processing_panel',
        metadata: {
          panelId,
          noteId: panel.noteId,
          storeKey: panel.storeKey,
          hasPosition: !!panel.position
        },
        content_preview: `Processing panel: ${panelId}`
      })

      const branch = getBranchData(panelId, panel.noteId)
      if (!branch) {
        debugLog({
          component: 'WidgetStudioConnections',
          action: 'panel_branch_not_found',
          metadata: {
            panelId,
            noteId: panel.noteId,
            compositeKey: ensurePanelKey(panel.noteId || noteId || '', panelId)
          },
          content_preview: `Branch data not found for panel: ${panelId}`
        })
        return
      }

      debugLog({
        component: 'WidgetStudioConnections',
        action: 'panel_branch_found',
        metadata: {
          panelId,
          parentId: branch.parentId,
          branchType: branch.type,
          hasBranches: Array.isArray(branch.branches),
          branchesCount: Array.isArray(branch.branches) ? branch.branches.length : 0
        },
        content_preview: `Branch found for ${panelId}: parent=${branch.parentId || 'NONE'}, type=${branch.type}`
      })

      if (branch.parentId) {
        addConnection(branch.parentId, panelId, panel.noteId || noteId || '')
      } else {
        debugLog({
          component: 'WidgetStudioConnections',
          action: 'panel_no_parent',
          metadata: {
            panelId,
            branchSnapshot: { ...branch }
          },
          content_preview: `Panel ${panelId} has no parentId`
        })
      }

      panels.forEach((maybeParent) => {
        const candidateId = maybeParent.panelId
        if (!candidateId || candidateId === panelId) return

        const candidateBranch = getBranchData(candidateId, maybeParent.noteId)
        const childIds = Array.isArray(candidateBranch?.branches)
          ? (candidateBranch.branches as string[])
          : []

        if (childIds.includes(panelId)) {
          addConnection(candidateId, panelId, panel.noteId || noteId || '')
        } else if (
          process.env.NODE_ENV !== "production" &&
          childIds.length > 0
        ) {
          // eslint-disable-next-line no-console
          console.debug("[WidgetStudioConnections] child not listed under parent", {
            parentId: candidateId,
            panelId,
            childIds,
            parentSnapshot: { ...candidateBranch },
          })
        }
      })
    })

    debugLog({
      component: 'WidgetStudioConnections',
      action: 'recompute_connections_complete',
      metadata: {
        connectionsCount: result.length,
        panelsCount: panels.length,
        branchVersion,
        dataStoreVersion,
        connectionDetails: result.map(conn => ({
          id: conn.id,
          type: conn.type,
          from: conn.from,
          to: conn.to
        }))
      },
      content_preview: `Created ${result.length} connections from ${panels.length} panels`
    })

    return result
  }, [getBranchData, panels, branchVersion, dataStoreVersion])

  return (
    <svg
      className="absolute inset-0 pointer-events-none"
      style={{
        width: "10000px",
        height: "10000px",
        overflow: "visible",
        zIndex: 0,
      }}
    >
      <defs>
        {/* Subtle drop shadow for depth */}
        <filter id="connection-shadow" x="-50%" y="-50%" width="200%" height="200%">
          <feGaussianBlur in="SourceAlpha" stdDeviation="2" />
          <feOffset dx="0" dy="1" result="offsetblur" />
          <feComponentTransfer>
            <feFuncA type="linear" slope="0.1" />
          </feComponentTransfer>
          <feMerge>
            <feMergeNode />
            <feMergeNode in="SourceGraphic" />
          </feMerge>
        </filter>

        {/* Arrow marker for connection end points */}
        <marker
          id="widget-arrow"
          markerWidth="8"
          markerHeight="8"
          refX="7"
          refY="4"
          orient="auto"
          markerUnits="strokeWidth"
        >
          <path
            d="M 0 0 L 8 4 L 0 8 z"
            fill="rgba(148, 163, 184, 0.8)"
            stroke="none"
          />
        </marker>
      </defs>

      {connections.map((connection) => {
        const pathData = createWidgetStudioPath(connection.from, connection.to)
        const color = getConnectionColor(connection.type)
        const labelPosition = calculateLabelPosition(connection.from, connection.to)

        return (
          <g key={connection.id} className="connection-group">
            {/* Main path */}
            <path
              d={pathData}
              fill="none"
              stroke={color}
              strokeWidth="2"
              strokeLinecap="round"
              className="transition-all duration-200 hover:stroke-[3px] hover:opacity-100"
              style={{ opacity: 0.6 }}
              filter="url(#connection-shadow)"
              markerEnd="url(#widget-arrow)"
            />

            {/* Connection point dots */}
            <circle
              cx={connection.from.x}
              cy={connection.from.y}
              r="4"
              fill={color}
              className="opacity-0 transition-opacity duration-200 group-hover:opacity-100"
            />
            <circle
              cx={connection.to.x}
              cy={connection.to.y}
              r="4"
              fill={color}
              className="opacity-0 transition-opacity duration-200 group-hover:opacity-100"
            />

            {/* Optional label */}
            {connection.label && (
              <g transform={`translate(${labelPosition.x}, ${labelPosition.y})`}>
                <rect
                  x="-20"
                  y="-10"
                  width="40"
                  height="20"
                  rx="4"
                  fill="white"
                  stroke={color}
                  strokeWidth="1"
                  opacity="0.9"
                />
                <text
                  textAnchor="middle"
                  dominantBaseline="middle"
                  fontSize="11"
                  fill="#666"
                  fontFamily="system-ui, -apple-system, sans-serif"
                >
                  {connection.label}
                </text>
              </g>
            )}
          </g>
        )
      })}
    </svg>
  )
}

/**
 * Create Widget Studio style Bézier path
 * Always creates horizontal S-curve from right to left
 */
function createWidgetStudioPath(from: ConnectionPoint, to: ConnectionPoint): string {
  const dx = to.x - from.x
  const dy = to.y - from.y

  // Control point offset - determines curve smoothness
  // Widget Studio uses about 40% of horizontal distance
  const controlOffset = Math.abs(dx) * 0.4

  // Control points for horizontal S-curve
  const control1 = {
    x: from.x + controlOffset,
    y: from.y,
  }

  const control2 = {
    x: to.x - controlOffset,
    y: to.y,
  }

  return `M ${from.x},${from.y} C ${control1.x},${control1.y} ${control2.x},${control2.y} ${to.x},${to.y}`
}

/**
 * Calculate position for optional label on path
 */
function calculateLabelPosition(from: ConnectionPoint, to: ConnectionPoint): ConnectionPoint {
  return {
    x: (from.x + to.x) / 2,
    y: (from.y + to.y) / 2,
  }
}

/**
 * Get Widget Studio style colors (subtle, pastel)
 */
function getConnectionColor(type: "note" | "explore" | "promote"): string {
  switch (type) {
    case "note":
      return "#94a3b8" // Slate-400 - subtle blue-gray
    case "explore":
      return "#fbbf24" // Amber-400 - warm yellow
    case "promote":
      return "#34d399" // Emerald-400 - fresh green
    default:
      return "#94a3b8"
  }
}

function normalizeType(type?: string): "note" | "explore" | "promote" {
  if (type === "note" || type === "explore" || type === "promote") {
    return type
  }
  return "note"
}
