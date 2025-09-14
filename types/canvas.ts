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
  content: string
  branches?: string[]
  parentId?: string
  position: { x: number; y: number }
  isEditable: boolean
  originalText?: string
}

export interface Panel {
  element: HTMLDivElement | null
  branchId: string
}
