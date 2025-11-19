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
  revision?: string | null
}

export type WorkspaceSnapshotEvent =
  | {
      type: "panel_pending"
      workspaceId: string
      noteId: string
      panelId: string
      pendingCount: number
      timestamp: number
    }
  | {
      type: "panel_ready"
      workspaceId: string
      noteId: string
      panelId: string
      pendingCount: number
      timestamp: number
    }
  | {
    type: "workspace_ready"
    workspaceId: string
    pendingCount: number
    timestamp: number
  }

type WorkspaceState = {
  pendingPanels: Set<string>
  readyPanels: Set<string>
}

const snapshots = new Map<string, NoteWorkspaceSnapshot>()
const workspaceStates = new Map<string, WorkspaceState>()
const noteWorkspaceOwners = new Map<string, string>()
const snapshotListeners = new Set<(event: WorkspaceSnapshotEvent) => void>()
const workspaceWaiters = new Map<string, Set<(ready: boolean) => void>>()

const createWorkspaceState = (workspaceId: string): WorkspaceState => {
  if (!workspaceStates.has(workspaceId)) {
    workspaceStates.set(workspaceId, {
      pendingPanels: new Set(),
      readyPanels: new Set(),
    })
  }
  return workspaceStates.get(workspaceId)!
}

const emitEvent = (event: WorkspaceSnapshotEvent) => {
  snapshotListeners.forEach((listener) => {
    try {
      listener(event)
    } catch (error) {
      console.warn("[NoteWorkspaceState] snapshot listener failed", error)
    }
  })
}

const resolveWorkspaceWaiters = (workspaceId: string, ready: boolean) => {
  const waiters = workspaceWaiters.get(workspaceId)
  if (!waiters || waiters.size === 0) {
    return
  }
  workspaceWaiters.delete(workspaceId)
  waiters.forEach((resolve) => {
    try {
      resolve(ready)
    } catch {
      // ignore errors from listeners
    }
  })
}

export function cacheWorkspaceSnapshot(snapshot: NoteWorkspaceSnapshot) {
  snapshots.set(snapshot.workspaceId, snapshot)
}

export function getWorkspaceSnapshot(workspaceId: string): NoteWorkspaceSnapshot | null {
  return snapshots.get(workspaceId) ?? null
}

export function clearWorkspaceSnapshot(workspaceId: string) {
  snapshots.delete(workspaceId)
}

export function setNoteWorkspaceOwner(noteId: string, workspaceId: string) {
  if (!noteId || !workspaceId) return
  noteWorkspaceOwners.set(noteId, workspaceId)
}

export function clearNoteWorkspaceOwner(noteId: string) {
  if (!noteId) return
  noteWorkspaceOwners.delete(noteId)
}

const getWorkspaceIdForNote = (noteId: string | null | undefined): string | null => {
  if (!noteId) return null
  return noteWorkspaceOwners.get(noteId) ?? null
}

const getPanelKey = (noteId: string, panelId: string) => `${noteId}:${panelId}`

export function markPanelPersistencePending(noteId: string | null | undefined, panelId: string | null | undefined) {
  if (!noteId || !panelId) return
  const workspaceId = getWorkspaceIdForNote(noteId)
  if (!workspaceId) return
  const state = createWorkspaceState(workspaceId)
  const key = getPanelKey(noteId, panelId)
  if (state.pendingPanels.has(key)) return
  state.pendingPanels.add(key)
  emitEvent({
    type: "panel_pending",
    workspaceId,
    noteId,
    panelId,
    pendingCount: state.pendingPanels.size,
    timestamp: Date.now(),
  })
}

export function markPanelPersistenceReady(noteId: string | null | undefined, panelId: string | null | undefined) {
  if (!noteId || !panelId) return
  const workspaceId = getWorkspaceIdForNote(noteId)
  if (!workspaceId) return
  const state = createWorkspaceState(workspaceId)
  const key = getPanelKey(noteId, panelId)
  if (!state.pendingPanels.has(key)) {
    // If we never saw a pending entry, nothing to emit.
    return
  }
  state.pendingPanels.delete(key)
  state.readyPanels.add(key)
  emitEvent({
    type: "panel_ready",
    workspaceId,
    noteId,
    panelId,
    pendingCount: state.pendingPanels.size,
    timestamp: Date.now(),
  })
  if (state.pendingPanels.size === 0) {
    emitEvent({
      type: "workspace_ready",
      workspaceId,
      pendingCount: 0,
      timestamp: Date.now(),
    })
    resolveWorkspaceWaiters(workspaceId, true)
  }
}

export function getPendingPanelCount(workspaceId: string | null | undefined): number {
  if (!workspaceId) return 0
  const state = workspaceStates.get(workspaceId)
  return state ? state.pendingPanels.size : 0
}

export function waitForWorkspaceSnapshotReady(workspaceId: string, timeoutMs = 500): Promise<boolean> {
  if (!workspaceId) {
    return Promise.resolve(true)
  }
  const pendingCount = getPendingPanelCount(workspaceId)
  if (pendingCount === 0) {
    return Promise.resolve(true)
  }
  return new Promise((resolve) => {
    const settled = { current: false }
    const resolveFn = (ready: boolean) => {
      if (settled.current) {
        return
      }
      settled.current = true
      const waiters = workspaceWaiters.get(workspaceId)
      if (waiters) {
        waiters.delete(resolveFn)
        if (waiters.size === 0) {
          workspaceWaiters.delete(workspaceId)
        }
      }
      clearTimeout(timeout)
      resolve(ready)
    }
    const timeout = setTimeout(() => {
      const waiters = workspaceWaiters.get(workspaceId)
      if (waiters) {
        waiters.delete(resolveFn)
      }
      resolveFn(false)
    }, timeoutMs)
    if (!workspaceWaiters.has(workspaceId)) {
      workspaceWaiters.set(workspaceId, new Set())
    }
    workspaceWaiters.get(workspaceId)!.add(resolveFn)
  })
}

export function subscribeToWorkspaceSnapshotState(listener: (event: WorkspaceSnapshotEvent) => void) {
  snapshotListeners.add(listener)
  return () => {
    snapshotListeners.delete(listener)
  }
}
