"use client"

import { DataStore } from "@/lib/data-store"
import { LayerManager } from "@/lib/canvas/layer-manager"
import { getWorkspaceStore } from "@/lib/workspace/workspace-store-registry"
import { getWorkspaceLayerManager } from "@/lib/workspace/workspace-layer-manager-registry"
import type { NoteWorkspaceSlot } from "@/lib/workspace/types"
import { debugLog } from "@/lib/utils/debug-logger"

export type WorkspaceRuntime = {
  id: string
  dataStore: DataStore
  layerManager: LayerManager
  pendingPanels: Set<string>
  pendingComponents: Set<string>
  status: "idle" | "active" | "paused"
  openNotes: NoteWorkspaceSlot[]
  membership: Set<string>
  noteOwners: Map<string, string>  // Phase 1: noteId -> workspaceId ownership
  // Timestamps to prevent stale overwrites (Phase 1 ownership plumbing)
  openNotesUpdatedAt: number
  membershipUpdatedAt: number
  // Phase 2: Visibility state for multi-runtime hide/show
  isVisible: boolean
  lastVisibleAt: number
}

const runtimes = new Map<string, WorkspaceRuntime>()

// Phase 2: Runtime change listeners for re-rendering multi-canvas
const runtimeChangeListeners = new Set<() => void>()

// Phase 2: Version counter that increments on ANY runtime change (IDs or contents)
// Used by useSyncExternalStore to detect when to re-render
let runtimeVersion = 0

export const getRuntimeVersion = () => runtimeVersion

export const subscribeToRuntimeChanges = (listener: () => void) => {
  runtimeChangeListeners.add(listener)
  return () => runtimeChangeListeners.delete(listener)
}

export const notifyRuntimeChanges = () => {
  // Increment version so useSyncExternalStore detects the change
  runtimeVersion++

  runtimeChangeListeners.forEach((listener) => {
    try {
      listener()
    } catch {
      // Ignore listener errors
    }
  })
}

// DEBUG: Unique ID to detect multiple module instances
const MODULE_INSTANCE_ID = Math.random().toString(36).substring(2, 8)
if (process.env.NODE_ENV === "development") {
  console.log(`[WorkspaceRuntime] Module loaded, instance ID: ${MODULE_INSTANCE_ID}`)
}

export const getWorkspaceRuntime = (workspaceId: string): WorkspaceRuntime => {
  // Dev-mode assertion: workspace ID must be valid
  if (process.env.NODE_ENV === "development") {
    if (!workspaceId || typeof workspaceId !== "string" || workspaceId.trim() === "") {
      console.error("[WorkspaceRuntime] Invalid workspace ID:", workspaceId)
      throw new Error(`Invalid workspace ID: ${workspaceId}`)
    }
  }

  // DEBUG: Trace Map state before lookup
  if (process.env.NODE_ENV === "development") {
    const hasKey = runtimes.has(workspaceId)
    const existingKeys = Array.from(runtimes.keys())
    console.log(`[WorkspaceRuntime] getWorkspaceRuntime called`, {
      moduleInstanceId: MODULE_INSTANCE_ID,
      workspaceId,
      hasKey,
      existingKeys,
      mapSize: runtimes.size,
    })
  }

  const existing = runtimes.get(workspaceId)
  if (existing) {
    return existing
  }

  const dataStore = getWorkspaceStore(workspaceId) ?? new DataStore()
  const layerManager = getWorkspaceLayerManager(workspaceId) ?? new LayerManager()

  const now = Date.now()
  const runtime: WorkspaceRuntime = {
    id: workspaceId,
    dataStore,
    layerManager,
    pendingPanels: new Set(),
    pendingComponents: new Set(),
    status: "idle",
    openNotes: [],
    membership: new Set(),
    noteOwners: new Map(),
    openNotesUpdatedAt: now,
    membershipUpdatedAt: now,
    // Phase 2: New runtimes start hidden
    isVisible: false,
    lastVisibleAt: 0,
  }
  runtimes.set(workspaceId, runtime)

  if (process.env.NODE_ENV === "development") {
    console.log(`[WorkspaceRuntime] Created new runtime for workspace: ${workspaceId}`, {
      totalRuntimes: runtimes.size,
      runtimeIds: Array.from(runtimes.keys()),
    })
  }

  // Phase 2: Don't notify here - notification happens via setRuntimeVisible()
  // which is called after runtime setup. Notifying during getWorkspaceRuntime
  // can cause "setState during render" errors if called inside useMemo/render.

  return runtime
}

export const markRuntimeActive = (workspaceId: string) => {
  const runtime = getWorkspaceRuntime(workspaceId)
  runtime.status = "active"
}

export const markRuntimePaused = (workspaceId: string) => {
  const runtime = runtimes.get(workspaceId)
  if (!runtime) return
  runtime.status = "paused"
}

export const removeWorkspaceRuntime = (workspaceId: string) => {
  // DEBUG: Track when runtimes are removed
  const hadKey = runtimes.has(workspaceId)
  const runtime = runtimes.get(workspaceId)
  const previousOpenNotesCount = runtime?.openNotes?.length ?? 0
  const previousOpenNoteIds = runtime?.openNotes?.map(n => n.noteId) ?? []
  const callStack = new Error().stack?.split('\n').slice(2, 7).join('\n') ?? ''

  // Phase 2 DEBUG: Log to database for tracing
  void debugLog({
    component: "WorkspaceRuntime",
    action: "runtime_removed",
    metadata: {
      workspaceId,
      hadKey,
      previousOpenNotesCount,
      previousOpenNoteIds,
      keysBeforeRemoval: Array.from(runtimes.keys()),
      callStack,
    },
  })

  if (process.env.NODE_ENV === "development") {
    console.log(`[WorkspaceRuntime] removeWorkspaceRuntime called`, {
      moduleInstanceId: MODULE_INSTANCE_ID,
      workspaceId,
      hadKey,
      keysBeforeRemoval: Array.from(runtimes.keys()),
      stack: callStack,
    })
  }

  if (!hadKey) return
  if (runtime) {
    runtime.pendingPanels.clear()
    runtime.pendingComponents.clear()
    runtime.openNotes = []
    runtime.membership.clear()
  }
  runtimes.delete(workspaceId)

  // Phase 2: Notify listeners when runtime is removed
  notifyRuntimeChanges()
}

export const listWorkspaceRuntimeIds = () => Array.from(runtimes.keys())

export const hasWorkspaceRuntime = (workspaceId: string): boolean => {
  return runtimes.has(workspaceId)
}

export const getRuntimeOpenNotes = (workspaceId: string): NoteWorkspaceSlot[] => {
  return runtimes.get(workspaceId)?.openNotes ?? []
}

export const setRuntimeOpenNotes = (
  workspaceId: string,
  slots: NoteWorkspaceSlot[],
  timestamp?: number,
) => {
  const runtime = getWorkspaceRuntime(workspaceId)
  const writeTimestamp = timestamp ?? Date.now()
  const previousSlots = runtime.openNotes
  const previousCount = previousSlots.length
  const newCount = slots.length

  // Phase 2 DEBUG: Log ALL openNotes changes, especially when going to/from empty
  const isGoingEmpty = previousCount > 0 && newCount === 0
  const isBecomingPopulated = previousCount === 0 && newCount > 0
  const callStack = new Error().stack?.split('\n').slice(2, 6).join('\n') ?? ''

  if (isGoingEmpty || isBecomingPopulated) {
    void debugLog({
      component: "WorkspaceRuntime",
      action: isGoingEmpty ? "openNotes_going_empty" : "openNotes_becoming_populated",
      metadata: {
        workspaceId,
        transition: isGoingEmpty ? 'POPULATED_TO_EMPTY' : 'EMPTY_TO_POPULATED',
        previousCount,
        newCount,
        previousNoteIds: previousSlots.map(s => s.noteId),
        newNoteIds: slots.map(s => s.noteId),
        timestamp: writeTimestamp,
        callStack,
      },
    })
  }

  // Phase 1: Reject stale writes to prevent snapshot overwrites
  if (writeTimestamp < runtime.openNotesUpdatedAt) {
    if (process.env.NODE_ENV === "development") {
      console.warn(
        `[WorkspaceRuntime] Rejected stale openNotes write for workspace ${workspaceId}`,
        {
          attemptedTimestamp: writeTimestamp,
          currentTimestamp: runtime.openNotesUpdatedAt,
          staleness: runtime.openNotesUpdatedAt - writeTimestamp,
          attemptedSlots: slots,
          currentSlots: runtime.openNotes,
        },
      )
    }
    return
  }

  runtime.openNotes = slots
  runtime.openNotesUpdatedAt = writeTimestamp

  // Phase 2: Notify container that openNotes changed so it re-renders
  // Use queueMicrotask to defer notification, avoiding setState-during-render issues
  queueMicrotask(() => {
    notifyRuntimeChanges()
  })
}

export const getRuntimeMembership = (workspaceId: string): Set<string> | null => {
  return runtimes.get(workspaceId)?.membership ?? null
}

export const setRuntimeMembership = (
  workspaceId: string,
  noteIds: Iterable<string>,
  timestamp?: number,
) => {
  const runtime = getWorkspaceRuntime(workspaceId)
  const writeTimestamp = timestamp ?? Date.now()

  // Phase 1: Reject stale writes to prevent snapshot overwrites
  if (writeTimestamp < runtime.membershipUpdatedAt) {
    if (process.env.NODE_ENV === "development") {
      console.warn(
        `[WorkspaceRuntime] Rejected stale membership write for workspace ${workspaceId}`,
        {
          attemptedTimestamp: writeTimestamp,
          currentTimestamp: runtime.membershipUpdatedAt,
          staleness: runtime.membershipUpdatedAt - writeTimestamp,
          attemptedNoteIds: Array.from(noteIds),
          currentMembership: Array.from(runtime.membership),
        },
      )
    }
    return
  }

  runtime.membership = new Set(noteIds)
  runtime.membershipUpdatedAt = writeTimestamp
}

// Phase 1: Note ownership functions (per-runtime)
export const setRuntimeNoteOwner = (workspaceId: string, noteId: string) => {
  if (!noteId || !workspaceId) return
  const runtime = getWorkspaceRuntime(workspaceId)
  runtime.noteOwners.set(noteId, workspaceId)
}

export const clearRuntimeNoteOwner = (workspaceId: string, noteId: string) => {
  if (!noteId || !workspaceId) return
  const runtime = runtimes.get(workspaceId)
  if (runtime) {
    runtime.noteOwners.delete(noteId)
  }
}

export const getRuntimeNoteOwner = (noteId: string): string | null => {
  // Check all runtimes to find which one owns this note
  for (const [workspaceId, runtime] of runtimes.entries()) {
    if (runtime.noteOwners.has(noteId)) {
      return runtime.noteOwners.get(noteId) ?? null
    }
  }
  return null
}

// Phase 2: Visibility management for multi-runtime hide/show

/**
 * Set a runtime's visibility state.
 * When visible, also updates lastVisibleAt for LRU tracking.
 */
export const setRuntimeVisible = (workspaceId: string, visible: boolean) => {
  const runtime = runtimes.get(workspaceId)
  if (!runtime) return

  const wasVisible = runtime.isVisible
  runtime.isVisible = visible

  if (visible) {
    runtime.lastVisibleAt = Date.now()
  }

  if (process.env.NODE_ENV === "development") {
    console.log(`[WorkspaceRuntime] setRuntimeVisible`, {
      workspaceId,
      visible,
      wasVisible,
      lastVisibleAt: runtime.lastVisibleAt,
    })
  }

  // Notify listeners if visibility changed
  if (wasVisible !== visible) {
    notifyRuntimeChanges()
  }
}

/**
 * Get the ID of the currently visible runtime, if any.
 */
export const getVisibleRuntimeId = (): string | null => {
  for (const [id, runtime] of runtimes.entries()) {
    if (runtime.isVisible) return id
  }
  return null
}

/**
 * Check if a specific runtime is visible.
 */
export const isRuntimeVisible = (workspaceId: string): boolean => {
  return runtimes.get(workspaceId)?.isVisible ?? false
}

/**
 * List all "hot" runtime IDs (runtimes that exist in memory).
 * Used for rendering multiple canvas instances.
 */
export const listHotRuntimes = (): string[] => {
  return Array.from(runtimes.keys())
}

/**
 * Get runtime info for all hot runtimes.
 * Used by MultiWorkspaceCanvasContainer to render each canvas.
 */
export const getHotRuntimesInfo = (): Array<{
  workspaceId: string
  isVisible: boolean
  openNotes: NoteWorkspaceSlot[]
  lastVisibleAt: number
}> => {
  const result = Array.from(runtimes.entries()).map(([workspaceId, runtime]) => ({
    workspaceId,
    isVisible: runtime.isVisible,
    openNotes: runtime.openNotes,
    lastVisibleAt: runtime.lastVisibleAt,
  }))

  // Phase 2 DEBUG: Log when any runtime has empty openNotes
  const emptyRuntimes = result.filter(r => r.openNotes.length === 0)
  if (emptyRuntimes.length > 0) {
    void debugLog({
      component: "WorkspaceRuntime",
      action: "getHotRuntimesInfo_empty_runtimes",
      metadata: {
        emptyCount: emptyRuntimes.length,
        emptyWorkspaceIds: emptyRuntimes.map(r => r.workspaceId),
        allRuntimes: result.map(r => ({
          workspaceId: r.workspaceId,
          noteCount: r.openNotes.length,
          isVisible: r.isVisible,
        })),
      },
    })
  }

  return result
}

/**
 * Get the least recently visible runtime ID for eviction.
 * Excludes the currently visible runtime.
 */
export const getLeastRecentlyVisibleRuntimeId = (): string | null => {
  let oldestId: string | null = null
  let oldestTime = Infinity

  for (const [id, runtime] of runtimes.entries()) {
    // Don't evict the visible runtime
    if (runtime.isVisible) continue

    if (runtime.lastVisibleAt < oldestTime) {
      oldestTime = runtime.lastVisibleAt
      oldestId = id
    }
  }

  return oldestId
}
