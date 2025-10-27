import type { ProseMirrorJSON } from "@/lib/providers/plain-offline-provider"

export interface CanvasState {
  canvasState: {
    zoom: number
    translateX: number
    translateY: number
    isDragging: boolean
    lastMouseX: number
    lastMouseY: number
    showConnections: boolean
    isPanMode?: boolean
  }
  panels: Map<string, { element: HTMLDivElement | null; branchId: string }>
  panelOrder: string[]
  selectedText: string
  selectedRange: Range | null
  currentPanel: string | null
  panelZIndex: number
  childPositions: Map<string, number>
  branchFilters: Map<string, string>
  selection?: {
    text: string
    range: Range | null
    panel: string | null
  }
  lastUpdate?: number
}

export interface Branch {
  title: string
  type: "main" | "note" | "explore" | "promote"
  content: string | ProseMirrorJSON
  preview?: string
  hasHydratedContent?: boolean
  branches?: string[]
  parentId?: string
  position: { x: number; y: number }

  // NEW: Unified dimensions (preferred going forward)
  // Defaults: 520×440 (DEFAULT_PANEL_DIMENSIONS)
  // Database default: 400×300
  // Type-specific widths: note=380, explore=500, promote=550, main=600
  dimensions?: { width: number; height: number }

  // DEPRECATED: Legacy width prop (kept for backward compatibility)
  // Use dimensions.width instead in new code
  // @deprecated Use dimensions.width instead
  width?: number

  isEditable: boolean
  originalText?: string
}

export interface Panel {
  element: HTMLDivElement | null
  branchId: string
}
