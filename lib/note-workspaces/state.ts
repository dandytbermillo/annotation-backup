import { debugLog } from "@/lib/utils/debug-logger"

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
  components?: Array<{
    id: string
    type: string
    position?: { x: number; y: number } | null
    size?: { width: number; height: number } | null
    zIndex?: number | null
    metadata?: Record<string, unknown> | null
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
      type: "component_pending"
      workspaceId: string
      componentId: string
      pendingCount: number
      timestamp: number
    }
  | {
      type: "component_ready"
      workspaceId: string
      componentId: string
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
  pendingComponents: Set<string>
}

const snapshots = new Map<string, NoteWorkspaceSnapshot>()
const workspaceStates = new Map<string, WorkspaceState>()
const noteWorkspaceOwners = new Map<string, string>()
const snapshotListeners = new Set<(event: WorkspaceSnapshotEvent) => void>()
const workspaceWaiters = new Map<string, Set<(ready: boolean) => void>>()
const panelWorkspaceLookup = new Map<string, string>()

let activeWorkspaceContext: string | null = null
const workspaceContextListeners = new Set<(workspaceId: string | null) => void>()

// Event listener for workspace list refresh requests
const workspaceRefreshListeners = new Set<() => void>()

const createWorkspaceState = (workspaceId: string): WorkspaceState => {
  if (!workspaceStates.has(workspaceId)) {
    workspaceStates.set(workspaceId, {
      pendingPanels: new Set(),
      readyPanels: new Set(),
      pendingComponents: new Set(),
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

const getWorkspacePendingCount = (workspaceId: string): number => {
  const state = workspaceStates.get(workspaceId)
  if (!state) return 0
  return state.pendingPanels.size + state.pendingComponents.size
}

const emitWorkspaceReadyIfSettled = (workspaceId: string) => {
  if (getWorkspacePendingCount(workspaceId) === 0) {
    emitEvent({
      type: "workspace_ready",
      workspaceId,
      pendingCount: 0,
      timestamp: Date.now(),
    })
    resolveWorkspaceWaiters(workspaceId, true)
  }
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

export function setActiveWorkspaceContext(workspaceId: string | null) {
  const prevValue = activeWorkspaceContext
  if (prevValue === workspaceId) return
  activeWorkspaceContext = workspaceId

  // Debug log state changes
  void debugLog({
    component: "WorkspaceState",
    action: "active_workspace_context_changed",
    metadata: {
      from: prevValue,
      to: workspaceId,
      stack: new Error().stack?.split('\n').slice(1, 5).join(' | '),
    },
  })

  workspaceContextListeners.forEach((listener) => {
    try {
      listener(activeWorkspaceContext)
    } catch {
      // Ignore listener errors to avoid breaking state updates
    }
  })
}

export function getActiveWorkspaceContext(): string | null {
  void debugLog({
    component: "WorkspaceState",
    action: "get_active_workspace_context",
    metadata: {
      value: activeWorkspaceContext,
      stack: new Error().stack?.split('\n').slice(1, 4).join(' | '),
    },
  })
  return activeWorkspaceContext
}

export function subscribeToActiveWorkspaceContext(listener: (workspaceId: string | null) => void) {
  workspaceContextListeners.add(listener)
  return () => {
    workspaceContextListeners.delete(listener)
  }
}

/**
 * Request that workspace list be refreshed (e.g., after external creation)
 */
export function requestWorkspaceListRefresh() {
  workspaceRefreshListeners.forEach((listener) => {
    try {
      listener()
    } catch {
      // Ignore listener errors
    }
  })
}

/**
 * Subscribe to workspace list refresh requests
 */
export function subscribeToWorkspaceListRefresh(listener: () => void) {
  workspaceRefreshListeners.add(listener)
  return () => {
    workspaceRefreshListeners.delete(listener)
  }
}

const getWorkspaceIdForNote = (noteId: string | null | undefined): string | null => {
  if (!noteId) return null
  return noteWorkspaceOwners.get(noteId) ?? null
}

const getPanelKey = (noteId: string, panelId: string) => `${noteId}:${panelId}`

export function markPanelPersistencePending(noteId: string | null | undefined, panelId: string | null | undefined) {
  if (!noteId || !panelId) return
  const workspaceId = getWorkspaceIdForNote(noteId) ?? activeWorkspaceContext
  if (!workspaceId) {
    void debugLog({
      component: "NoteWorkspaceState",
      action: "panel_pending_workspace_missing",
      metadata: {
        noteId,
        panelId,
        activeWorkspaceContext,
      },
    })
    return
  }
  const state = createWorkspaceState(workspaceId)
  const key = getPanelKey(noteId, panelId)
  if (state.pendingPanels.has(key)) return
  state.pendingPanels.add(key)
  panelWorkspaceLookup.set(key, workspaceId)
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
  const key = getPanelKey(noteId, panelId)
  const workspaceId = panelWorkspaceLookup.get(key) ?? getWorkspaceIdForNote(noteId) ?? activeWorkspaceContext
  if (!workspaceId) {
    void debugLog({
      component: "NoteWorkspaceState",
      action: "panel_ready_workspace_missing",
      metadata: {
        noteId,
        panelId,
        activeWorkspaceContext,
      },
    })
    return
  }
  const state = createWorkspaceState(workspaceId)
  if (!state.pendingPanels.has(key)) {
    // If we never saw a pending entry, nothing to emit.
    return
  }
  state.pendingPanels.delete(key)
  state.readyPanels.add(key)
  panelWorkspaceLookup.delete(key)
  emitEvent({
    type: "panel_ready",
    workspaceId,
    noteId,
    panelId,
    pendingCount: state.pendingPanels.size,
    timestamp: Date.now(),
  })
  emitWorkspaceReadyIfSettled(workspaceId)
}

export function getPendingPanelCount(workspaceId: string | null | undefined): number {
  if (!workspaceId) return 0
  return getWorkspacePendingCount(workspaceId)
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

export function markComponentPersistencePending(
  workspaceId: string | null | undefined,
  componentId: string | null | undefined,
) {
  if (!workspaceId || !componentId) return
  const state = createWorkspaceState(workspaceId)
  if (state.pendingComponents.has(componentId)) return
  state.pendingComponents.add(componentId)
  emitEvent({
    type: "component_pending",
    workspaceId,
    componentId,
    pendingCount: getWorkspacePendingCount(workspaceId),
    timestamp: Date.now(),
  })
}

export function markComponentPersistenceReady(
  workspaceId: string | null | undefined,
  componentId: string | null | undefined,
) {
  if (!workspaceId || !componentId) return
  const state = createWorkspaceState(workspaceId)
  if (!state.pendingComponents.has(componentId)) {
    return
  }
  state.pendingComponents.delete(componentId)
  emitEvent({
    type: "component_ready",
    workspaceId,
    componentId,
    pendingCount: getWorkspacePendingCount(workspaceId),
    timestamp: Date.now(),
  })
  emitWorkspaceReadyIfSettled(workspaceId)
}
