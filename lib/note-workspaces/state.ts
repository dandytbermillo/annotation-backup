export type NoteWorkspaceSnapshot = {
  workspaceId: string
  openNotes: Array<{ noteId: string; mainPosition?: { x: number; y: number } | null }>
  panels: Array<{
    noteId: string
    panelId: string
    type?: string | null
    position?: { x: number; y: number } | null
    size?: { width: number; height: number } | null
    zIndex?: number | null
    metadata?: Record<string, unknown> | null
    parentId?: string | null
    worldPosition?: { x: number; y: number } | null
    worldSize?: { width: number; height: number } | null
  }>
  camera: { x: number; y: number; scale: number }
  activeNoteId: string | null
}

const snapshots = new Map<string, NoteWorkspaceSnapshot>()

export function cacheWorkspaceSnapshot(snapshot: NoteWorkspaceSnapshot) {
  snapshots.set(snapshot.workspaceId, snapshot)
}

export function getWorkspaceSnapshot(workspaceId: string): NoteWorkspaceSnapshot | null {
  return snapshots.get(workspaceId) ?? null
}

export function clearWorkspaceSnapshot(workspaceId: string) {
  snapshots.delete(workspaceId)
}
