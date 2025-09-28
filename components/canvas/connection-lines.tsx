"use client"

import { UnifiedProvider } from "@/lib/provider-switcher"
import { getPlainProvider } from "@/lib/provider-switcher"
import { getAnnotationColor } from "@/lib/models/annotation"
import { useCanvas } from "./canvas-context"
import { CanvasItem, isPanel } from "@/types/canvas-items"

interface ConnectionLinesProps {
  canvasItems: CanvasItem[]
}

const PANEL_DEFAULT_WIDTH = 800
const PANEL_DEFAULT_HEIGHT = 600

type ConnectionType = "note" | "explore" | "promote"

interface PanelBounds {
  left: number
  right: number
  top: number
  bottom: number
  centerX: number
  centerY: number
}

interface ConnectionGeometry {
  start: { x: number; y: number }
  end: { x: number; y: number }
  control1: { x: number; y: number }
  control2: { x: number; y: number }
}

interface ConnectionSegment extends ConnectionGeometry {
  type: ConnectionType
}

export function ConnectionLines({ canvasItems }: ConnectionLinesProps) {
  const { dataStore } = useCanvas()
  const plainProvider = getPlainProvider()
  const isPlainMode = !!plainProvider

  const panels = canvasItems.filter(isPanel)
  const panelMap = new Map<string, CanvasItem>()
  panels.forEach((panel) => {
    if (panel.panelId) {
      panelMap.set(panel.panelId, panel)
    }
  })

  const branches = isPlainMode
    ? dataStore
    : UnifiedProvider.getInstance().getBranchesMap()

  const connections: ConnectionSegment[] = []

  panels.forEach((panel) => {
    const panelId = panel.panelId
    if (!panelId) return
    const branch = branches.get(panelId)
    if (!branch || !branch.parentId) return

    const parentPanel = panelMap.get(branch.parentId)
    if (!parentPanel) return

    const parentBranch = branches.get(branch.parentId)
    if (!parentBranch) return

    const parentBounds = resolvePanelBounds(parentPanel, parentBranch)
    const childBounds = resolvePanelBounds(panel, branch)
    if (!parentBounds || !childBounds) return

    const geometry = computeConnectionGeometry(parentBounds, childBounds)
    if (!geometry) return

    connections.push({
      type: normalizeConnectionType(branch.type),
      ...geometry,
    })
  })

  return (
    <svg
      className="absolute inset-0 pointer-events-none"
      style={{
        width: "10000px",
        height: "10000px",
        overflow: "visible",
      }}
    >
      <defs>
        <linearGradient id="noteGradient" x1="0%" y1="0%" x2="100%" y2="0%">
          <stop offset="0%" stopColor="#3498db" stopOpacity="0.8" />
          <stop offset="100%" stopColor="#2980b9" stopOpacity="0.6" />
        </linearGradient>

        <linearGradient id="exploreGradient" x1="0%" y1="0%" x2="100%" y2="0%">
          <stop offset="0%" stopColor="#f39c12" stopOpacity="0.8" />
          <stop offset="100%" stopColor="#e67e22" stopOpacity="0.6" />
        </linearGradient>

        <linearGradient id="promoteGradient" x1="0%" y1="0%" x2="100%" y2="0%">
          <stop offset="0%" stopColor="#27ae60" stopOpacity="0.8" />
          <stop offset="100%" stopColor="#229954" stopOpacity="0.6" />
        </linearGradient>
      </defs>

      {connections.map((connection, index) => {
        const gradientId = `${connection.type}Gradient`
        const color = getAnnotationColor(connection.type)
        const pathData = `M ${connection.start.x} ${connection.start.y} C ${connection.control1.x} ${connection.control1.y}, ${connection.control2.x} ${connection.control2.y}, ${connection.end.x} ${connection.end.y}`
        const arrowAngle = Math.atan2(
          connection.end.y - connection.control2.y,
          connection.end.x - connection.control2.x
        ) * (180 / Math.PI)

        return (
          <g key={index}>
            <path
              d={pathData}
              fill="none"
              stroke="rgba(0,0,0,0.2)"
              strokeWidth="4"
              filter="blur(2px)"
              transform="translate(2, 2)"
            />

            <path
              d={pathData}
              fill="none"
              stroke={`url(#${gradientId})`}
              strokeWidth="3"
              strokeLinecap="round"
              className="transition-all duration-300 hover:stroke-width-4"
            />

            <polygon
              points="0,0 -12,-5 -12,5"
              transform={`translate(${connection.end.x}, ${connection.end.y}) rotate(${arrowAngle})`}
              fill={color}
              opacity="0.9"
            />

            <circle
              cx={connection.start.x}
              cy={connection.start.y}
              r="4"
              fill={color}
              opacity="0.8"
            />
            <circle
              cx={connection.end.x}
              cy={connection.end.y}
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

function resolvePanelBounds(panel: CanvasItem, branch: any): PanelBounds | null {
  const width = panel.dimensions?.width ?? PANEL_DEFAULT_WIDTH
  const height = panel.dimensions?.height ?? PANEL_DEFAULT_HEIGHT
  const sourcePosition = branch?.position ?? panel.position
  if (!sourcePosition) return null

  const left = sourcePosition.x
  const top = sourcePosition.y

  return {
    left,
    right: left + width,
    top,
    bottom: top + height,
    centerX: left + width / 2,
    centerY: top + height / 2,
  }
}

function computeConnectionGeometry(parent: PanelBounds, child: PanelBounds): ConnectionGeometry | null {
  const deltaX = child.centerX - parent.centerX
  const deltaY = child.centerY - parent.centerY
  const horizontalSeparation = Math.abs(deltaX)
  const verticalSeparation = Math.abs(deltaY)

  let startX: number
  let startY: number
  let endX: number
  let endY: number

  if (horizontalSeparation > verticalSeparation) {
    if (deltaX >= 0) {
      startX = parent.right
      startY = parent.centerY
      endX = child.left
      endY = child.centerY
    } else {
      startX = parent.left
      startY = parent.centerY
      endX = child.right
      endY = child.centerY
    }
  } else {
    if (deltaY >= 0) {
      startX = parent.centerX
      startY = parent.bottom
      endX = child.centerX
      endY = child.top
    } else {
      startX = parent.centerX
      startY = parent.top
      endX = child.centerX
      endY = child.bottom
    }
  }

  const distance = Math.hypot(endX - startX, endY - startY)
  if (distance < 1) {
    return null
  }

  const controlOffset = Math.min(distance * 0.5, 160)

  let control1X: number
  let control1Y: number
  let control2X: number
  let control2Y: number

  if (horizontalSeparation > verticalSeparation * 1.5) {
    const direction = deltaX >= 0 ? 1 : -1
    control1X = startX + controlOffset * direction
    control1Y = startY
    control2X = endX - controlOffset * direction
    control2Y = endY
  } else if (verticalSeparation > horizontalSeparation * 1.5) {
    const direction = deltaY >= 0 ? 1 : -1
    control1X = startX
    control1Y = startY + controlOffset * direction
    control2X = endX
    control2Y = endY - controlOffset * direction
  } else {
    const xDirection = deltaX >= 0 ? 1 : -1
    const yDirection = deltaY >= 0 ? 1 : -1
    control1X = startX + controlOffset * 0.7 * xDirection
    control1Y = startY + controlOffset * 0.3 * yDirection
    control2X = endX - controlOffset * 0.7 * xDirection
    control2Y = endY - controlOffset * 0.3 * yDirection
  }

  return {
    start: { x: startX, y: startY },
    end: { x: endX, y: endY },
    control1: { x: control1X, y: control1Y },
    control2: { x: control2X, y: control2Y },
  }
}

function normalizeConnectionType(type?: string): ConnectionType {
  if (type === "note" || type === "explore" || type === "promote") {
    return type
  }
  return "note"
}
