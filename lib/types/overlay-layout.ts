export const OVERLAY_LAYOUT_SCHEMA_VERSION = '2.0.0'

export interface OverlayCanvasPosition {
  x: number
  y: number
}

export interface OverlayPopupDescriptor {
  id: string
  folderId: string | null
  folderName?: string // Folder display name (cached to avoid fetching on load)
  parentId: string | null
  canvasPosition: OverlayCanvasPosition
  overlayPosition?: OverlayCanvasPosition
  level: number
  height?: number
}

export interface OverlayInspectorState {
  type: string
  visible: boolean
  pane?: string
}

export interface OverlayLayoutPayload {
  schemaVersion: string
  popups: OverlayPopupDescriptor[]
  inspectors: OverlayInspectorState[]
  lastSavedAt: string
}

export interface OverlayLayoutEnvelope {
  layout: OverlayLayoutPayload
  version: string
  revision: string
  updatedAt: string
}
