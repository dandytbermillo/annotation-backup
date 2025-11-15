export type NoteWorkspacePanel = {
  noteId: string
  position?: { x: number; y: number } | null
  size?: { width: number; height: number } | null
  zIndex?: number | null
  isPinned?: boolean
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
