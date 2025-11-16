export type NoteWorkspacePanel = {
  noteId: string
  position?: { x: number; y: number } | null
  size?: { width: number; height: number } | null
  zIndex?: number | null
  isPinned?: boolean
}

export type NoteWorkspacePanelSnapshot = {
  noteId: string
  panelId: string
  type?: string | null
  position?: { x: number; y: number } | null
  size?: { width: number; height: number } | null
  zIndex?: number | null
  metadata?: Record<string, unknown> | null
  parentId?: string | null
  branches?: string[] | null
  worldPosition?: { x: number; y: number } | null
  worldSize?: { width: number; height: number } | null
}

export type NoteWorkspaceCamera = {
  x: number
  y: number
  scale: number
}

export type NoteWorkspacePayload = {
  schemaVersion: '1.0.0'
  openNotes: NoteWorkspacePanel[]
  activeNoteId: string | null
  camera: NoteWorkspaceCamera
  panels: NoteWorkspacePanelSnapshot[]
}

export type NoteWorkspaceRecord = {
  id: string
  name: string
  payload: NoteWorkspacePayload
  revision: string
  createdAt: string
  updatedAt: string
  isDefault: boolean
  noteCount: number
}
