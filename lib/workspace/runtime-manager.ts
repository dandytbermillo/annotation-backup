"use client"

import { DataStore } from "@/lib/data-store"
import { LayerManager } from "@/lib/canvas/layer-manager"
import { getWorkspaceStore } from "@/lib/workspace/workspace-store-registry"
import { getWorkspaceLayerManager } from "@/lib/workspace/workspace-layer-manager-registry"
import type { NoteWorkspaceSlot } from "@/lib/workspace/types"
import { debugLog } from "@/lib/utils/debug-logger"

// Phase 1: Component registration types (legacy - for React lifecycle tracking)
export type RegisteredComponent = {
  componentId: string
  componentType: "calculator" | "timer" | "alarm" | "widget" | string
  workspaceId: string
  registeredAt: number
}

// Phase 1 Unification: Runtime component ledger entry
// This is the authoritative source of truth for component data, persists even when React unmounts
export type RuntimeComponent = {
  componentId: string
  componentType: "calculator" | "timer" | "alarm" | "widget" | string
  workspaceId: string
  position: { x: number; y: number }
  size: { width: number; height: number } | null
  metadata: Record<string, unknown>
  zIndex: number
  createdAt: number
  lastSeenAt: number  // Updated when component is visible/interacted with
}

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
  // Phase 1: Registered components (calculators, timers, alarms, etc.) - React lifecycle tracking
  registeredComponents: Map<string, RegisteredComponent>
  // Phase 1 Unification: Runtime component ledger - authoritative data source, persists across unmounts
  components: Map<string, RuntimeComponent>
  // Phase 4: Deleted components tracking - prevents fallback from resurrecting deleted components
  deletedComponents: Set<string>
}

// Phase 3: Max live runtime configuration
export const MAX_LIVE_WORKSPACES = {
  desktop: 4,
  tablet: 2,
} as const

// Detect platform for runtime cap (can be overridden via feature flag)
const getMaxLiveRuntimes = (): number => {
  if (typeof window === "undefined") return MAX_LIVE_WORKSPACES.desktop
  // Simple heuristic: touch device with narrow screen = tablet
  const isTablet = "ontouchstart" in window && window.innerWidth < 1024
  return isTablet ? MAX_LIVE_WORKSPACES.tablet : MAX_LIVE_WORKSPACES.desktop
}

const runtimes = new Map<string, WorkspaceRuntime>()

// Phase 3: Pre-eviction callback registry
// Callbacks are invoked BEFORE a runtime is removed, allowing persistence of dirty state
export type PreEvictionCallback = (workspaceId: string, reason: string) => Promise<void>
const preEvictionCallbacks = new Set<PreEvictionCallback>()

export const registerPreEvictionCallback = (cb: PreEvictionCallback): void => {
  preEvictionCallbacks.add(cb)
  if (process.env.NODE_ENV === "development") {
    console.log(`[WorkspaceRuntime] Pre-eviction callback registered`, {
      callbackCount: preEvictionCallbacks.size,
    })
  }
}

export const unregisterPreEvictionCallback = (cb: PreEvictionCallback): void => {
  preEvictionCallbacks.delete(cb)
  if (process.env.NODE_ENV === "development") {
    console.log(`[WorkspaceRuntime] Pre-eviction callback unregistered`, {
      callbackCount: preEvictionCallbacks.size,
    })
  }
}

// Internal helper to invoke all pre-eviction callbacks
const invokePreEvictionCallbacks = async (workspaceId: string, reason: string): Promise<void> => {
  if (preEvictionCallbacks.size === 0) return

  void debugLog({
    component: "WorkspaceRuntime",
    action: "pre_eviction_callbacks_start",
    metadata: {
      workspaceId,
      reason,
      callbackCount: preEvictionCallbacks.size,
    },
  })

  const startTime = Date.now()
  const errors: string[] = []

  for (const callback of preEvictionCallbacks) {
    try {
      await callback(workspaceId, reason)
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error)
      errors.push(errorMsg)
      console.warn(`[WorkspaceRuntime] Pre-eviction callback failed`, {
        workspaceId,
        reason,
        error: errorMsg,
      })
    }
  }

  void debugLog({
    component: "WorkspaceRuntime",
    action: "pre_eviction_callbacks_complete",
    metadata: {
      workspaceId,
      reason,
      callbackCount: preEvictionCallbacks.size,
      durationMs: Date.now() - startTime,
      errors: errors.length > 0 ? errors : undefined,
    },
  })
}

/**
 * Fire pre-eviction callbacks synchronously (fire-and-forget).
 * The callbacks themselves are async, but we don't await them.
 * This is used when we need sync eviction but still want to attempt persistence.
 *
 * IMPORTANT: Callbacks must capture runtime state SYNCHRONOUSLY at the start,
 * because the runtime will be deleted immediately after this call returns.
 * The async persistence can then happen in the background.
 */
const firePreEvictionCallbacksSync = (workspaceId: string, reason: string): void => {
  if (preEvictionCallbacks.size === 0) return

  void debugLog({
    component: "WorkspaceRuntime",
    action: "pre_eviction_callbacks_fire_and_forget",
    metadata: {
      workspaceId,
      reason,
      callbackCount: preEvictionCallbacks.size,
    },
  })

  // Capture the runtime reference BEFORE deletion for callbacks to use
  const runtime = runtimes.get(workspaceId)
  if (!runtime) return

  // Clone critical state that callbacks might need (in case they can't access runtime in time)
  const capturedState = {
    openNotes: [...runtime.openNotes],
    registeredComponents: new Map(runtime.registeredComponents),
    components: new Map(runtime.components),  // Phase 1 Unification: Capture component ledger
    deletedComponents: new Set(runtime.deletedComponents),  // Phase 4: Capture deleted components
    dataStore: runtime.dataStore,
    layerManager: runtime.layerManager,
  }

  // Store the captured state BEFORE firing callbacks so callbacks can access it immediately
  // (even in their synchronous portion before the first await)
  capturedEvictionStates.set(workspaceId, {
    state: capturedState,
    capturedAt: Date.now(),
  })

  // Clean up old captured states after 30 seconds
  setTimeout(() => {
    capturedEvictionStates.delete(workspaceId)
  }, 30000)

  for (const callback of preEvictionCallbacks) {
    // Fire each callback but don't await - it runs in background
    void callback(workspaceId, reason).catch(error => {
      const errorMsg = error instanceof Error ? error.message : String(error)
      console.warn(`[WorkspaceRuntime] Fire-and-forget pre-eviction callback failed`, {
        workspaceId,
        reason,
        error: errorMsg,
      })
      void debugLog({
        component: "WorkspaceRuntime",
        action: "pre_eviction_callback_fire_and_forget_error",
        metadata: {
          workspaceId,
          reason,
          error: errorMsg,
        },
      })
    })
  }
}

// Temporary storage for captured runtime state during fire-and-forget eviction
const capturedEvictionStates = new Map<string, {
  state: {
    openNotes: NoteWorkspaceSlot[]
    registeredComponents: Map<string, RegisteredComponent>
    components: Map<string, RuntimeComponent>  // Phase 1 Unification: Include component ledger
    dataStore: DataStore
    layerManager: LayerManager
  }
  capturedAt: number
}>()

/**
 * Get captured eviction state for a workspace that was evicted via fire-and-forget.
 * This allows callbacks to access runtime state even after the runtime is deleted.
 */
export const getCapturedEvictionState = (workspaceId: string) => {
  return capturedEvictionStates.get(workspaceId)?.state ?? null
}

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

// Track pending notification to batch multiple calls
let notificationPending = false

export const notifyRuntimeChanges = () => {
  // Increment version so useSyncExternalStore detects the change
  // This must happen synchronously so getSnapshot() returns the current value
  runtimeVersion++

  // Defer listener notification to avoid setState-during-render errors
  // When notifyRuntimeChanges() is called during another component's render phase,
  // calling listeners synchronously would trigger React to update subscribed components
  // (via useSyncExternalStore), which violates React's rules.
  // Using queueMicrotask ensures listeners are called after the current execution context.
  if (!notificationPending) {
    notificationPending = true
    queueMicrotask(() => {
      notificationPending = false
      runtimeChangeListeners.forEach((listener) => {
        try {
          listener()
        } catch {
          // Ignore listener errors
        }
      })
    })
  }
}

// DEBUG: Unique ID to detect multiple module instances
const MODULE_INSTANCE_ID = Math.random().toString(36).substring(2, 8)
if (process.env.NODE_ENV === "development") {
  console.log(`[WorkspaceRuntime] Module loaded, instance ID: ${MODULE_INSTANCE_ID}`)
}

// The shared workspace ID is a legacy placeholder and should NOT trigger eviction
const SHARED_WORKSPACE_ID_INTERNAL = "__workspace__"

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

  // Skip eviction for the shared/placeholder workspace ID
  // This is a legacy fallback that shouldn't trigger eviction of real workspaces
  const isSharedWorkspace = workspaceId === SHARED_WORKSPACE_ID_INTERNAL

  // Phase 3: LRU eviction - ensure we don't exceed MAX_LIVE_WORKSPACES
  // Evict before creating a new runtime if we're at capacity (but not for shared workspace)
  const maxRuntimes = getMaxLiveRuntimes()
  if (!isSharedWorkspace && runtimes.size >= maxRuntimes) {
    const lruId = getLeastRecentlyVisibleRuntimeId()
    if (lruId) {
      const lruRuntime = runtimes.get(lruId)
      void debugLog({
        component: "WorkspaceRuntime",
        action: "runtime_evicted_for_capacity",
        metadata: {
          evictedWorkspaceId: lruId,
          newWorkspaceId: workspaceId,
          maxRuntimes,
          currentCount: runtimes.size,
          evictedComponentCount: lruRuntime?.registeredComponents.size ?? 0,
          evictedOpenNotesCount: lruRuntime?.openNotes.length ?? 0,
          evictedLastVisibleAt: lruRuntime?.lastVisibleAt,
        },
      })

      if (process.env.NODE_ENV === "development") {
        console.log(`[WorkspaceRuntime] Evicting LRU runtime for capacity`, {
          evictedWorkspaceId: lruId,
          newWorkspaceId: workspaceId,
          maxRuntimes,
          currentCount: runtimes.size,
        })
      }

      // Phase 3: Fire pre-eviction callbacks (fire-and-forget) to persist dirty state
      // Callbacks capture state synchronously, then persist asynchronously
      firePreEvictionCallbacksSync(lruId, "capacity_eviction_sync")

      // Remove the LRU runtime
      removeWorkspaceRuntime(lruId)
    }
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
    // Phase 1: Component registry (React lifecycle tracking)
    registeredComponents: new Map(),
    // Phase 1 Unification: Component ledger (authoritative data, persists across unmounts)
    components: new Map(),
    // Phase 4: Deleted components tracking
    deletedComponents: new Set(),
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

// Internal helper to perform the actual runtime removal (no callbacks)
const performRuntimeRemoval = (workspaceId: string, hadKey: boolean, runtime: WorkspaceRuntime | undefined) => {
  if (!hadKey) return

  if (runtime) {
    runtime.pendingPanels.clear()
    runtime.pendingComponents.clear()
    runtime.openNotes = []
    runtime.membership.clear()
    runtime.registeredComponents.clear()  // Phase 1: Clean up component registry
    runtime.components.clear()  // Phase 1 Unification: Clean up component ledger on eviction
  }
  runtimes.delete(workspaceId)

  // Phase 2: Notify listeners when runtime is removed
  notifyRuntimeChanges()
}

/**
 * Remove a workspace runtime (synchronous version).
 * Pre-eviction callbacks are fired but NOT awaited.
 * Use removeWorkspaceRuntimeAsync when you need to wait for persistence.
 */
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

  // Phase 3: DO NOT fire callbacks in sync version
  // Callbacks must be awaited (use removeWorkspaceRuntimeAsync) otherwise they'll
  // try to access the runtime after it's deleted, potentially causing infinite loops
  // when they call getWorkspaceRuntime and trigger more evictions.

  performRuntimeRemoval(workspaceId, hadKey, runtime)
}

/**
 * Remove a workspace runtime (async version).
 * Awaits all pre-eviction callbacks before removal.
 * Use this when you need to ensure persistence completes before eviction.
 */
export const removeWorkspaceRuntimeAsync = async (
  workspaceId: string,
  reason: string = "runtime_removal"
): Promise<void> => {
  // DEBUG: Track when runtimes are removed
  const hadKey = runtimes.has(workspaceId)
  const runtime = runtimes.get(workspaceId)
  const previousOpenNotesCount = runtime?.openNotes?.length ?? 0
  const previousOpenNoteIds = runtime?.openNotes?.map(n => n.noteId) ?? []
  const callStack = new Error().stack?.split('\n').slice(2, 7).join('\n') ?? ''

  // Phase 2 DEBUG: Log to database for tracing
  void debugLog({
    component: "WorkspaceRuntime",
    action: "runtime_removed_async",
    metadata: {
      workspaceId,
      reason,
      hadKey,
      previousOpenNotesCount,
      previousOpenNoteIds,
      keysBeforeRemoval: Array.from(runtimes.keys()),
      callStack,
    },
  })

  if (process.env.NODE_ENV === "development") {
    console.log(`[WorkspaceRuntime] removeWorkspaceRuntimeAsync called`, {
      moduleInstanceId: MODULE_INSTANCE_ID,
      workspaceId,
      reason,
      hadKey,
      keysBeforeRemoval: Array.from(runtimes.keys()),
      stack: callStack,
    })
  }

  if (!hadKey) return

  // Phase 3: Await pre-eviction callbacks BEFORE removal
  if (preEvictionCallbacks.size > 0) {
    await invokePreEvictionCallbacks(workspaceId, reason)
  }

  performRuntimeRemoval(workspaceId, hadKey, runtime)
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

    // Don't evict the shared/placeholder workspace
    if (id === SHARED_WORKSPACE_ID_INTERNAL) continue

    if (runtime.lastVisibleAt < oldestTime) {
      oldestTime = runtime.lastVisibleAt
      oldestId = id
    }
  }

  return oldestId
}

// =============================================================================
// Phase 1: Component Registration API
// =============================================================================

/**
 * Register a component (calculator, timer, alarm, etc.) with a workspace runtime.
 * Components must call this on mount to participate in the workspace lifecycle.
 *
 * @param workspaceId - The workspace this component belongs to
 * @param componentId - Unique identifier for this component instance
 * @param componentType - Type of component ("calculator", "timer", "alarm", etc.)
 */
export const registerComponent = (
  workspaceId: string,
  componentId: string,
  componentType: string,
): void => {
  // Dev-mode assertion: workspaceId is required
  if (process.env.NODE_ENV === "development") {
    if (!workspaceId || typeof workspaceId !== "string" || workspaceId.trim() === "") {
      console.error(
        `[WorkspaceRuntime] Component registration failed: invalid workspaceId`,
        { workspaceId, componentId, componentType }
      )
      throw new Error(
        `Component "${componentId}" (type: ${componentType}) attempted to register without a valid workspaceId. ` +
        `All components must specify their target workspace.`
      )
    }
  }

  const runtime = runtimes.get(workspaceId)
  if (!runtime) {
    if (process.env.NODE_ENV === "development") {
      console.warn(
        `[WorkspaceRuntime] Cannot register component - runtime not found for workspace: ${workspaceId}`,
        { componentId, componentType }
      )
    }
    return
  }

  const component: RegisteredComponent = {
    componentId,
    componentType,
    workspaceId,
    registeredAt: Date.now(),
  }

  runtime.registeredComponents.set(componentId, component)

  if (process.env.NODE_ENV === "development") {
    console.log(`[WorkspaceRuntime] Component registered`, {
      workspaceId,
      componentId,
      componentType,
      totalComponents: runtime.registeredComponents.size,
    })
  }

  void debugLog({
    component: "WorkspaceRuntime",
    action: "component_registered",
    metadata: {
      workspaceId,
      componentId,
      componentType,
      totalComponents: runtime.registeredComponents.size,
    },
  })
}

/**
 * Deregister a component from a workspace runtime.
 * Components must call this on unmount to clean up.
 *
 * @param workspaceId - The workspace this component belongs to
 * @param componentId - Unique identifier for this component instance
 */
export const deregisterComponent = (
  workspaceId: string,
  componentId: string,
): void => {
  const runtime = runtimes.get(workspaceId)
  if (!runtime) return

  const hadComponent = runtime.registeredComponents.has(componentId)
  runtime.registeredComponents.delete(componentId)

  if (process.env.NODE_ENV === "development" && hadComponent) {
    console.log(`[WorkspaceRuntime] Component deregistered`, {
      workspaceId,
      componentId,
      remainingComponents: runtime.registeredComponents.size,
    })
  }

  if (hadComponent) {
    void debugLog({
      component: "WorkspaceRuntime",
      action: "component_deregistered",
      metadata: {
        workspaceId,
        componentId,
        remainingComponents: runtime.registeredComponents.size,
      },
    })
  }
}

/**
 * Get all registered components for a workspace.
 */
export const getRegisteredComponents = (workspaceId: string): RegisteredComponent[] => {
  const runtime = runtimes.get(workspaceId)
  if (!runtime) return []
  return Array.from(runtime.registeredComponents.values())
}

/**
 * Get count of registered components for a workspace.
 */
export const getRegisteredComponentCount = (workspaceId: string): number => {
  return runtimes.get(workspaceId)?.registeredComponents.size ?? 0
}

/**
 * Check if a component is registered with a workspace.
 */
export const isComponentRegistered = (workspaceId: string, componentId: string): boolean => {
  return runtimes.get(workspaceId)?.registeredComponents.has(componentId) ?? false
}

// =============================================================================
// Phase 3: LRU Eviction for Max Live Workspaces
// =============================================================================

/**
 * Evict the least recently used runtime to stay within MAX_LIVE_WORKSPACES limit.
 * Called before creating a new runtime when at capacity.
 * Pre-eviction callbacks are fired but NOT awaited (use evictLRURuntimeAsync for that).
 *
 * Returns the evicted workspace ID, or null if eviction wasn't needed/possible.
 */
export const evictLRURuntime = (): string | null => {
  const maxRuntimes = getMaxLiveRuntimes()

  // Check if we're at capacity
  if (runtimes.size < maxRuntimes) {
    return null
  }

  const lruId = getLeastRecentlyVisibleRuntimeId()
  if (!lruId) {
    if (process.env.NODE_ENV === "development") {
      console.warn(`[WorkspaceRuntime] Cannot evict - no eligible runtime found`)
    }
    return null
  }

  const runtime = runtimes.get(lruId)
  const componentCount = runtime?.registeredComponents.size ?? 0
  const openNotesCount = runtime?.openNotes.length ?? 0

  void debugLog({
    component: "WorkspaceRuntime",
    action: "runtime_evicted",
    metadata: {
      workspaceId: lruId,
      reason: "max_live_workspaces_exceeded",
      maxRuntimes,
      runtimeCount: runtimes.size,
      evictedOpenNotesCount: openNotesCount,
      evictedComponentCount: componentCount,
      lastVisibleAt: runtime?.lastVisibleAt,
    },
  })

  if (process.env.NODE_ENV === "development") {
    console.log(`[WorkspaceRuntime] Evicting LRU runtime`, {
      workspaceId: lruId,
      maxRuntimes,
      currentCount: runtimes.size,
      lastVisibleAt: runtime?.lastVisibleAt,
      componentCount,
      openNotesCount,
    })
  }

  // Remove the runtime (sync version - callbacks fire-and-forget)
  removeWorkspaceRuntime(lruId)

  return lruId
}

/**
 * Evict the least recently used runtime (async version).
 * Awaits all pre-eviction callbacks before removal.
 * Use this when you need to ensure persistence completes before eviction.
 *
 * Returns the evicted workspace ID, or null if eviction wasn't needed/possible.
 */
export const evictLRURuntimeAsync = async (): Promise<string | null> => {
  const maxRuntimes = getMaxLiveRuntimes()

  // Check if we're at capacity
  if (runtimes.size < maxRuntimes) {
    return null
  }

  const lruId = getLeastRecentlyVisibleRuntimeId()
  if (!lruId) {
    if (process.env.NODE_ENV === "development") {
      console.warn(`[WorkspaceRuntime] Cannot evict - no eligible runtime found`)
    }
    return null
  }

  const runtime = runtimes.get(lruId)
  const componentCount = runtime?.registeredComponents.size ?? 0
  const openNotesCount = runtime?.openNotes.length ?? 0

  void debugLog({
    component: "WorkspaceRuntime",
    action: "runtime_evicted_async",
    metadata: {
      workspaceId: lruId,
      reason: "max_live_workspaces_exceeded_async",
      maxRuntimes,
      runtimeCount: runtimes.size,
      evictedOpenNotesCount: openNotesCount,
      evictedComponentCount: componentCount,
      lastVisibleAt: runtime?.lastVisibleAt,
    },
  })

  if (process.env.NODE_ENV === "development") {
    console.log(`[WorkspaceRuntime] Evicting LRU runtime (async)`, {
      workspaceId: lruId,
      maxRuntimes,
      currentCount: runtimes.size,
      lastVisibleAt: runtime?.lastVisibleAt,
      componentCount,
      openNotesCount,
    })
  }

  // Remove the runtime (async version - awaits callbacks)
  await removeWorkspaceRuntimeAsync(lruId, "lru_eviction_capacity")

  return lruId
}

/**
 * Check if creating a new runtime would exceed the limit.
 * If so, evict LRU runtime first (sync version - callbacks fire-and-forget).
 *
 * Call this before getWorkspaceRuntime when you know you'll be creating a new runtime.
 */
export const ensureRuntimeCapacity = (): string | null => {
  const maxRuntimes = getMaxLiveRuntimes()

  // If we're at or over capacity, evict
  if (runtimes.size >= maxRuntimes) {
    return evictLRURuntime()
  }

  return null
}

/**
 * Get current runtime count and capacity info.
 */
export const getRuntimeCapacityInfo = (): {
  currentCount: number
  maxCount: number
  atCapacity: boolean
  runtimeIds: string[]
} => {
  const maxRuntimes = getMaxLiveRuntimes()
  return {
    currentCount: runtimes.size,
    maxCount: maxRuntimes,
    atCapacity: runtimes.size >= maxRuntimes,
    runtimeIds: Array.from(runtimes.keys()),
  }
}

// =============================================================================
// Phase 1 Unification: Runtime Component Ledger API
// This is the authoritative source of truth for component data.
// Unlike registeredComponents (React lifecycle), this persists across unmounts.
// =============================================================================

export type RuntimeComponentInput = {
  componentId: string
  componentType: "calculator" | "timer" | "alarm" | "widget" | string
  position: { x: number; y: number }
  size?: { width: number; height: number } | null
  metadata?: Record<string, unknown>
  zIndex?: number
}

/**
 * Register or update a component in the runtime ledger.
 * This is the authoritative data store - persists even when React component unmounts.
 *
 * @param workspaceId - The workspace this component belongs to
 * @param input - Component data (id, type, position, size, metadata, zIndex)
 * @returns The created/updated RuntimeComponent, or null if runtime doesn't exist
 */
export const registerRuntimeComponent = (
  workspaceId: string,
  input: RuntimeComponentInput,
): RuntimeComponent | null => {
  const runtime = runtimes.get(workspaceId)
  if (!runtime) {
    if (process.env.NODE_ENV === "development") {
      console.warn(
        `[WorkspaceRuntime] Cannot register runtime component - runtime not found for workspace: ${workspaceId}`,
        { componentId: input.componentId, componentType: input.componentType }
      )
    }
    return null
  }

  const now = Date.now()
  const existing = runtime.components.get(input.componentId)

  const component: RuntimeComponent = {
    componentId: input.componentId,
    componentType: input.componentType,
    workspaceId,
    position: input.position,
    size: input.size ?? null,
    metadata: input.metadata ?? {},
    zIndex: input.zIndex ?? existing?.zIndex ?? 100,
    createdAt: existing?.createdAt ?? now,
    lastSeenAt: now,
  }

  runtime.components.set(input.componentId, component)

  if (process.env.NODE_ENV === "development") {
    console.log(`[WorkspaceRuntime] Runtime component registered/updated`, {
      workspaceId,
      componentId: input.componentId,
      componentType: input.componentType,
      isNew: !existing,
      totalComponents: runtime.components.size,
    })
  }

  // NOTE: Removed hot-path debug log (runtime_component_updated) - was causing 300+ DB writes/min

  return component
}

/**
 * Update specific fields of a runtime component.
 * Only updates provided fields, preserves others.
 *
 * @param workspaceId - The workspace this component belongs to
 * @param componentId - The component to update
 * @param updates - Partial updates (position, size, metadata, zIndex)
 * @returns The updated RuntimeComponent, or null if not found
 */
export const updateRuntimeComponent = (
  workspaceId: string,
  componentId: string,
  updates: Partial<Pick<RuntimeComponent, "position" | "size" | "metadata" | "zIndex">>,
): RuntimeComponent | null => {
  const runtime = runtimes.get(workspaceId)
  if (!runtime) return null

  const existing = runtime.components.get(componentId)
  if (!existing) {
    if (process.env.NODE_ENV === "development") {
      console.warn(
        `[WorkspaceRuntime] Cannot update runtime component - not found: ${componentId}`,
        { workspaceId }
      )
    }
    return null
  }

  const updated: RuntimeComponent = {
    ...existing,
    position: updates.position ?? existing.position,
    size: updates.size !== undefined ? updates.size : existing.size,
    metadata: updates.metadata !== undefined
      ? { ...existing.metadata, ...updates.metadata }
      : existing.metadata,
    zIndex: updates.zIndex ?? existing.zIndex,
    lastSeenAt: Date.now(),
  }

  runtime.components.set(componentId, updated)

  return updated
}

/**
 * Mark a runtime component as "seen" (update lastSeenAt).
 * Call this when the component is visible or interacted with.
 */
export const touchRuntimeComponent = (
  workspaceId: string,
  componentId: string,
): void => {
  const runtime = runtimes.get(workspaceId)
  if (!runtime) return

  const existing = runtime.components.get(componentId)
  if (existing) {
    existing.lastSeenAt = Date.now()
  }
}

/**
 * Remove a runtime component from the ledger.
 * Only call this for explicit deletion (user deletes component),
 * NOT for React unmount (component data should persist).
 *
 * @param workspaceId - The workspace this component belongs to
 * @param componentId - The component to remove
 * @returns true if component was removed, false if not found
 */
export const removeRuntimeComponent = (
  workspaceId: string,
  componentId: string,
): boolean => {
  const runtime = runtimes.get(workspaceId)
  if (!runtime) return false

  const had = runtime.components.has(componentId)
  if (had) {
    runtime.components.delete(componentId)

    if (process.env.NODE_ENV === "development") {
      console.log(`[WorkspaceRuntime] Runtime component removed`, {
        workspaceId,
        componentId,
        remainingComponents: runtime.components.size,
      })
    }

    void debugLog({
      component: "WorkspaceRuntime",
      action: "runtime_component_removed",
      metadata: {
        workspaceId,
        componentId,
        remainingComponents: runtime.components.size,
      },
    })
  }

  return had
}

/**
 * Get a specific runtime component by ID.
 */
export const getRuntimeComponent = (
  workspaceId: string,
  componentId: string,
): RuntimeComponent | null => {
  return runtimes.get(workspaceId)?.components.get(componentId) ?? null
}

/**
 * List all runtime components for a workspace.
 * Returns components from the authoritative ledger (persists across unmounts).
 */
export const listRuntimeComponents = (workspaceId: string): RuntimeComponent[] => {
  const runtime = runtimes.get(workspaceId)
  if (!runtime) return []
  return Array.from(runtime.components.values())
}

/**
 * Get count of runtime components for a workspace.
 */
export const getRuntimeComponentCount = (workspaceId: string): number => {
  return runtimes.get(workspaceId)?.components.size ?? 0
}

/**
 * Check if a runtime component exists in the ledger.
 */
export const hasRuntimeComponent = (
  workspaceId: string,
  componentId: string,
): boolean => {
  return runtimes.get(workspaceId)?.components.has(componentId) ?? false
}

/**
 * Populate runtime component ledger from a snapshot (during hydration/replay).
 * This is called when restoring a workspace from persisted state.
 *
 * @param workspaceId - The workspace to populate
 * @param components - Array of component snapshots from persisted payload
 */
export const populateRuntimeComponents = (
  workspaceId: string,
  components: Array<{
    id: string
    type: string
    position?: { x: number; y: number } | null
    size?: { width: number; height: number } | null
    metadata?: Record<string, unknown> | null
    zIndex?: number | null
  }>,
): void => {
  const runtime = runtimes.get(workspaceId)
  if (!runtime) {
    if (process.env.NODE_ENV === "development") {
      console.warn(
        `[WorkspaceRuntime] Cannot populate runtime components - runtime not found: ${workspaceId}`
      )
    }
    return
  }

  const now = Date.now()
  let populatedCount = 0
  let skippedDeletedCount = 0

  for (const comp of components) {
    if (!comp.id || !comp.type) continue

    // Phase 4: Skip components that were marked as deleted
    // This prevents resurrection of deleted components during hydration/workspace switch
    if (runtime.deletedComponents.has(comp.id)) {
      skippedDeletedCount++
      void debugLog({
        component: "WorkspaceRuntime",
        action: "populate_skipped_deleted_component",
        metadata: {
          workspaceId,
          componentId: comp.id,
          componentType: comp.type,
        },
      })
      continue
    }

    const existing = runtime.components.get(comp.id)
    const component: RuntimeComponent = {
      componentId: comp.id,
      componentType: comp.type,
      workspaceId,
      position: comp.position ?? { x: 0, y: 0 },
      size: comp.size ?? null,
      metadata: comp.metadata ?? {},
      zIndex: comp.zIndex ?? 100,
      createdAt: existing?.createdAt ?? now,
      lastSeenAt: now,
    }

    runtime.components.set(comp.id, component)
    populatedCount++
  }

  if (process.env.NODE_ENV === "development") {
    console.log(`[WorkspaceRuntime] Runtime components populated`, {
      workspaceId,
      requestedCount: components.length,
      populatedCount,
      skippedDeletedCount,
      totalComponents: runtime.components.size,
    })
  }

  void debugLog({
    component: "WorkspaceRuntime",
    action: "runtime_components_populated",
    metadata: {
      workspaceId,
      requestedCount: components.length,
      populatedCount,
      skippedDeletedCount,
      totalComponents: runtime.components.size,
    },
  })
}

/**
 * Sync LayerManager nodes from runtime component ledger.
 * This ensures LayerManager has nodes for all components in the runtime ledger.
 * Used during hydration/replay to ensure rendering layer matches authoritative data.
 *
 * @param workspaceId - The workspace to sync
 * @returns Number of components synced to LayerManager
 */
export const syncLayerManagerFromRuntime = (workspaceId: string): number => {
  const runtime = runtimes.get(workspaceId)
  if (!runtime || runtime.components.size === 0) {
    return 0
  }

  const layerMgr = getWorkspaceLayerManager(workspaceId)
  if (!layerMgr) {
    if (process.env.NODE_ENV === "development") {
      console.warn(
        `[WorkspaceRuntime] Cannot sync LayerManager - not found for workspace: ${workspaceId}`
      )
    }
    return 0
  }

  let syncedCount = 0
  for (const component of runtime.components.values()) {
    // Check if node already exists in LayerManager
    const existingNodes = layerMgr.getNodes()
    const exists = existingNodes?.has(component.componentId)

    if (!exists) {
      const componentMetadata = {
        ...(component.metadata ?? {}),
        componentType: component.componentType,
      } as Record<string, unknown>

      layerMgr.registerNode({
        id: component.componentId,
        type: "component",
        position: component.position,
        dimensions: component.size ?? undefined,
        zIndex: component.zIndex,
        metadata: componentMetadata,
      } as any)
      syncedCount++
    }
  }

  if (syncedCount > 0) {
    void debugLog({
      component: "WorkspaceRuntime",
      action: "layer_manager_synced_from_runtime",
      metadata: {
        workspaceId,
        syncedCount,
        totalInLedger: runtime.components.size,
      },
    })
  }

  return syncedCount
}

// =============================================================================
// Phase 4: Deleted Component Tracking
// =============================================================================
// These functions track components that have been intentionally deleted by the user.
// This prevents fallback paths (LayerManager, caches) from resurrecting deleted components.

/**
 * Mark a component as deleted.
 * This should be called when a user explicitly closes/deletes a component.
 * The deleted ID will be excluded from fallback paths during buildPayload and canvas rendering.
 *
 * @param workspaceId - The workspace containing the component
 * @param componentId - The ID of the deleted component
 */
export const markComponentDeleted = (
  workspaceId: string,
  componentId: string,
): void => {
  const runtime = runtimes.get(workspaceId)
  if (!runtime) {
    // Create a temporary tracking even if runtime doesn't exist
    // This handles edge cases where runtime was evicted but component is being closed
    if (process.env.NODE_ENV === "development") {
      console.warn(
        `[WorkspaceRuntime] markComponentDeleted called but runtime not found: ${workspaceId}`
      )
    }
    return
  }

  runtime.deletedComponents.add(componentId)

  if (process.env.NODE_ENV === "development") {
    console.log(`[WorkspaceRuntime] Component marked as deleted`, {
      workspaceId,
      componentId,
      deletedCount: runtime.deletedComponents.size,
    })
  }

  void debugLog({
    component: "WorkspaceRuntime",
    action: "component_marked_deleted",
    metadata: {
      workspaceId,
      componentId,
      deletedCount: runtime.deletedComponents.size,
    },
  })
}

/**
 * Check if a component has been marked as deleted.
 * Used by fallback paths to avoid resurrecting deleted components.
 *
 * @param workspaceId - The workspace to check
 * @param componentId - The component ID to check
 * @returns true if the component was deleted, false otherwise
 */
export const isComponentDeleted = (
  workspaceId: string,
  componentId: string,
): boolean => {
  return runtimes.get(workspaceId)?.deletedComponents.has(componentId) ?? false
}

/**
 * Get all deleted component IDs for a workspace.
 *
 * @param workspaceId - The workspace to get deleted components for
 * @returns Set of deleted component IDs
 */
export const getDeletedComponents = (workspaceId: string): Set<string> => {
  return runtimes.get(workspaceId)?.deletedComponents ?? new Set()
}

/**
 * Clear the deleted components set for a workspace.
 * This should be called after a successful save to allow the same IDs to be reused
 * for new components in the future.
 *
 * @param workspaceId - The workspace to clear deleted components for
 */
export const clearDeletedComponents = (workspaceId: string): void => {
  const runtime = runtimes.get(workspaceId)
  if (!runtime) return

  const previousCount = runtime.deletedComponents.size
  if (previousCount === 0) return

  runtime.deletedComponents.clear()

  if (process.env.NODE_ENV === "development") {
    console.log(`[WorkspaceRuntime] Deleted components cleared after save`, {
      workspaceId,
      clearedCount: previousCount,
    })
  }

  void debugLog({
    component: "WorkspaceRuntime",
    action: "deleted_components_cleared",
    metadata: {
      workspaceId,
      clearedCount: previousCount,
    },
  })
}
