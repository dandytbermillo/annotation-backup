export const OVERLAY_LAYOUT_SCHEMA_VERSION = '2.1.0'

export interface OverlayCanvasPosition {
  x: number
  y: number
}

export interface OverlayPopupDescriptor {
  id: string
  folderId: string | null
  folderName?: string // Folder display name (cached to avoid fetching on load)
  folderColor?: string | null // Folder color (cached to show badge immediately on load)
  parentId: string | null
  canvasPosition: OverlayCanvasPosition
  overlayPosition?: OverlayCanvasPosition
  level: number
  width?: number
  height?: number
}

export interface OverlayResolvedChild {
  id: string
  name: string
  type: 'folder' | 'note'
  color?: string | null
  path?: string | null
  parentId?: string | null
  createdAt?: string | null
  updatedAt?: string | null
}

export interface OverlayResolvedFolder {
  id: string
  name: string
  level: number
  path?: string | null
  color?: string | null
  parentId?: string | null
  children: OverlayResolvedChild[]
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
  resolvedFolders?: Record<string, OverlayResolvedFolder>
}

export interface OverlayLayoutEnvelope {
  layout: OverlayLayoutPayload
  version: string
  revision: string
  updatedAt: string
}
