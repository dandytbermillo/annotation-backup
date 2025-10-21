"use client"

import { useCallback, useEffect, useMemo, useRef, useState } from "react"

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

  // Track dragging state to force updates
  const [dragUpdateTick, setDragUpdateTick] = useState(0)
  const rafRef = useRef<number | null>(null)

  // Monitor for panel dragging and trigger updates
  useEffect(() => {
    let isDragging = false

    const checkDragging = () => {
      // Check if any panel is being dragged (has dragging class or data attribute)
      const draggingPanel = document.querySelector('[data-panel-id][data-dragging="true"]')
      const wasDragging = isDragging
      isDragging = !!draggingPanel

      if (isDragging) {
        // Force re-computation by updating tick
        setDragUpdateTick(prev => prev + 1)
        rafRef.current = requestAnimationFrame(checkDragging)
      } else if (wasDragging) {
        // Just stopped dragging - do one final update
        setDragUpdateTick(prev => prev + 1)
      } else {
        // Not dragging - check again in a bit
        rafRef.current = requestAnimationFrame(checkDragging)
      }
    }

    rafRef.current = requestAnimationFrame(checkDragging)

    return () => {
      if (rafRef.current !== null) {
        cancelAnimationFrame(rafRef.current)
      }
    }
  }, [])

  // Helper to get current panel position (from DOM if being dragged, otherwise from props)
  const getPanelPosition = useCallback((panel: CanvasItem) => {
    if (!panel.panelId) return panel.position

    // CRITICAL: Use storeKey (composite key) to uniquely identify panels in multi-note workspaces
    // Using panelId alone fails when multiple notes have panels with same ID (e.g., "main")
    const storeKey = panel.storeKey || ensurePanelKey(panel.noteId || noteId || '', panel.panelId)

    // Try to read current position from DOM (updated during drag)
    const panelElement = document.querySelector(`[data-store-key="${storeKey}"]`) as HTMLElement
    if (panelElement) {
      const left = parseFloat(panelElement.style.left || '0')
      const top = parseFloat(panelElement.style.top || '0')
      if (!isNaN(left) && !isNaN(top)) {
        return { x: left, y: top }
      }
    }

    // Fallback to position from props
    return panel.position
  }, [noteId])

  // Generate connection lines in canvas space (copied from overlay popup pattern)
  const connectionPaths = useMemo(() => {
    const paths: Connection[] = []

    debugLog({
      component: 'WidgetStudioConnections',
      action: 'recompute_start',
      metadata: {
        panelsCount: panels.length,
        noteId: noteId || 'NO_NOTE_ID'
      },
      content_preview: `Recomputing connections for ${panels.length} panels`
    })

    // Build a simple panel map for easy lookup (like overlay popups Map)
    const panelMap = new Map<string, CanvasItem>()
    const panelDetails: any[] = []

    panels.forEach((panel) => {
      if (panel.panelId) {
        // Always compute storeKey if not present
        const key = panel.storeKey || ensurePanelKey(panel.noteId || noteId || '', panel.panelId)
        panelMap.set(key, panel)

        panelDetails.push({
          panelId: panel.panelId,
          noteId: panel.noteId,
          storeKey: key,
          position: panel.position
        })
      }
    })

    debugLog({
      component: 'WidgetStudioConnections',
      action: 'panelMap_built',
      metadata: {
        panelMapSize: panelMap.size,
        panelMapKeys: Array.from(panelMap.keys()),
        panelDetails
      },
      content_preview: `Built panelMap with ${panelMap.size} entries`
    })

    panels.forEach((panel) => {
      if (!panel.panelId || !panel.position) return

      // Get branch data to find parentId
      const effectiveNoteId = panel.noteId || noteId || ''
      const compositeKey = ensurePanelKey(effectiveNoteId, panel.panelId)

      const branch = isPlainMode
        ? dataStore.get(compositeKey)
        : UnifiedProvider.getInstance().getBranchesMap().get(compositeKey) || dataStore.get(compositeKey)

      // DIAGNOSTIC: Check if parentId is normalized
      const isParentNormalized = !branch?.parentId || branch.parentId === 'main' || branch.parentId.startsWith('branch-')
      const isRawUUID = branch?.parentId && !isParentNormalized

      debugLog({
        component: 'WidgetStudioConnections',
        action: branch ? 'branch_found' : 'branch_not_found',
        metadata: {
          panelId: panel.panelId,
          noteId: effectiveNoteId,
          compositeKey,
          hasBranch: !!branch,
          parentId: branch?.parentId || 'NO_PARENT',
          isParentNormalized,
          isRawUUID,  // 🚨 If true, this is the problem!
        },
        content_preview: `Panel ${panel.panelId}: ${branch ? `parent=${branch.parentId} (normalized=${isParentNormalized})` : 'NO_BRANCH'}`
      })

      if (branch && branch.parentId) {
        // Find parent panel (like overlay popup pattern)
        const parentKey = ensurePanelKey(effectiveNoteId, branch.parentId)
        const parent = panelMap.get(parentKey)

        debugLog({
          component: 'WidgetStudioConnections',
          action: parent ? 'parent_found' : 'parent_not_found',
          metadata: {
            childPanelId: panel.panelId,
            childNoteId: panel.noteId,
            effectiveNoteId,
            parentId: branch.parentId,
            parentKey,
            hasParent: !!parent,
            hasParentPosition: !!parent?.position,
            parentActualNoteId: parent?.noteId,
            parentActualPanelId: parent?.panelId,
            allKeysInMap: Array.from(panelMap.keys())
          },
          content_preview: `Child ${panel.panelId} (note: ${effectiveNoteId}) looking for parent ${branch.parentId} with key ${parentKey}: ${parent ? `FOUND (parent noteId: ${parent.noteId})` : 'NOT_FOUND'}`
        })

        if (parent && parent.position && parent.panelId) {
          // Get current positions (from DOM if dragging, otherwise from props)
          const parentPosition = getPanelPosition(parent)
          const childPosition = getPanelPosition(panel)

          // Get actual panel width from dimensions (NOT the 800px default!)
          // Read from DOM if possible for most accurate width during drag
          // CRITICAL: Use storeKey to query the correct panel in multi-note workspaces
          let parentWidth = parent.dimensions?.width ?? 600
          const parentStoreKey = parent.storeKey || ensurePanelKey(parent.noteId || effectiveNoteId, parent.panelId)
          const parentElement = document.querySelector(`[data-store-key="${parentStoreKey}"]`) as HTMLElement
          if (parentElement) {
            const computedWidth = parseFloat(parentElement.style.width || '0')
            if (!isNaN(computedWidth) && computedWidth > 0) {
              parentWidth = computedWidth
            }
          }

          // EXACT overlay popup connection points: 50px from top (header height)
          const startX = parentPosition.x + parentWidth  // Right edge of parent
          const startY = parentPosition.y + 50           // Fixed offset like overlay popups
          const endX = childPosition.x                    // Left edge of child
          const endY = childPosition.y + 50               // Fixed offset like overlay popups

          paths.push({
            id: `${branch.parentId}::${panel.panelId}`,
            from: { x: startX, y: startY },
            to: { x: endX, y: endY },
            type: normalizeType(branch.type),
            label: undefined
          })

          debugLog({
            component: 'WidgetStudioConnections',
            action: 'connection_created',
            metadata: {
              connectionId: `${branch.parentId}::${panel.panelId}`,
              from: { x: startX, y: startY },
              to: { x: endX, y: endY },
              parentNoteId: parent.noteId,
              parentPanelId: parent.panelId,
              childNoteId: panel.noteId,
              childPanelId: panel.panelId,
              parentKey,
              childKey: compositeKey
            },
            content_preview: `Connection: ${parent.noteId}::${branch.parentId} → ${panel.noteId}::${panel.panelId}`
          })
        }
      }
    })

    debugLog({
      component: 'WidgetStudioConnections',
      action: 'recompute_complete',
      metadata: {
        connectionsCount: paths.length,
        panelsCount: panels.length
      },
      content_preview: `Created ${paths.length} connections from ${panels.length} panels`
    })

    return paths
  }, [panels, isPlainMode, dataStore, noteId, branchVersion, dataStoreVersion, dragUpdateTick, getPanelPosition])

  return (
    <svg
      className="absolute inset-0 pointer-events-none"
      style={{
        width: "10000px",
        height: "10000px",
        overflow: "visible",
        zIndex: 0
      }}
    >
      {connectionPaths.map((connection) => {
        const pathData = createWidgetStudioPath(connection.from, connection.to)

        return (
          <path
            key={connection.id}
            d={pathData}
            stroke="#4B5563"  // Same gray color as overlay popups
            strokeWidth={2}
            opacity={0.6}
            fill="none"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        )
      })}
    </svg>
  )
}

/**
 * Create connection path using Quadratic Bezier curve
 * EXACT copy from overlay popup pattern
 */
function createWidgetStudioPath(from: ConnectionPoint, to: ConnectionPoint): string {
  const controlX = (from.x + to.x) / 2

  return `M ${from.x} ${from.y} Q ${controlX} ${from.y} ${to.x} ${to.y}`
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
