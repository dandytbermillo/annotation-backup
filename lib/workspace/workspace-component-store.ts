/**
 * Workspace Component Store
 *
 * Central store for all component state within a workspace.
 * Implements the Workspace State Machine architecture.
 *
 * See: docs/proposal/workspace-state-machine/IMPLEMENTATION_PLAN.md
 *
 * Key concepts:
 * - Store is the single source of truth for component state
 * - Durable state persists to DB, ephemeral state is runtime-only
 * - Hot restore: Store already has state, don't overwrite
 * - Cold restore: Load from DB, apply deactivation invariant
 * - Option B: Headless operations (intervals) run in store, not components
 */

import { debugLog } from '@/lib/utils/debug-logger'
import {
  createPersistScheduler,
  registerPersistScheduler,
  unregisterPersistScheduler,
} from './persist-scheduler'
import { processComponentStateForRestore } from './component-type-registry'
import type {
  DurableComponentState,
  WorkspaceLifecycle,
  PersistState,
  PersistHealth,
  PersistScheduler,
  StateUpdate,
  WorkspaceComponentStore,
  WorkspaceStoreActions,
} from './workspace-store-types'

// =============================================================================
// Store Registry
// =============================================================================

/** Store instances per workspace */
const stores = new Map<string, WorkspaceComponentStore & WorkspaceStoreActions>()

/**
 * Get or create a workspace component store.
 */
export function getWorkspaceComponentStore(
  workspaceId: string
): WorkspaceComponentStore & WorkspaceStoreActions {
  let store = stores.get(workspaceId)
  if (!store) {
    store = createWorkspaceComponentStore(workspaceId)
    stores.set(workspaceId, store)
  }
  return store
}

/**
 * Check if a workspace component store exists.
 */
export function hasWorkspaceComponentStore(workspaceId: string): boolean {
  return stores.has(workspaceId)
}

/**
 * Delete a workspace component store.
 * CRITICAL: Stops all active operations before deletion.
 */
export function deleteWorkspaceComponentStore(workspaceId: string): void {
  const store = stores.get(workspaceId)
  if (store) {
    // Stop all active operations before deletion (Option B cleanup)
    store.stopAllOperations()
    // Unregister from global persist handlers
    unregisterPersistScheduler(workspaceId)

    void debugLog({
      component: 'WorkspaceComponentStore',
      action: 'store_deleted',
      metadata: { workspaceId },
    })
  }
  stores.delete(workspaceId)
}

/**
 * Get all workspace component store IDs.
 */
export function listWorkspaceComponentStoreIds(): string[] {
  return Array.from(stores.keys())
}

// =============================================================================
// Store Factory
// =============================================================================

function createWorkspaceComponentStore(
  workspaceId: string
): WorkspaceComponentStore & WorkspaceStoreActions {
  // === Internal State ===
  const components = new Map<string, DurableComponentState>()
  const activeIds = new Set<string>()
  const dirtyIds = new Set<string>()
  const listeners = new Set<() => void>()
  let lastPersistedAt = 0
  let lifecycle: WorkspaceLifecycle = 'uninitialized'

  // === Persist State ===
  const persistState: PersistState = {
    inFlight: false,
    inFlightPromise: null,
    pendingChanges: new Set<string>(),
    revision: 0,
    lastError: null,
    retryCount: 0,
    health: 'healthy' as PersistHealth,
    degradedSince: null,
  }

  // === Headless Operations (Option B) ===
  // Store-owned intervals - survive component unmount
  const activeOperations = new Map<string, ReturnType<typeof setInterval>>()

  // === Persistence Callback ===
  let persistCallback: ((
    components: Array<{ id: string } & DurableComponentState>,
    meta: { revision: number }
  ) => Promise<void>) | null = null

  // === Scheduler (created after store definition) ===
  let persistScheduler: PersistScheduler

  // === Notify Subscribers ===
  const notify = () => {
    listeners.forEach((listener) => listener())
  }

  // === Store Object ===
  const store: WorkspaceComponentStore & WorkspaceStoreActions = {
    // === State Getters ===
    get components() {
      return components
    },
    get lifecycle() {
      return lifecycle
    },
    get runtime() {
      return { activeIds, dirtyIds, lastPersistedAt }
    },
    get persistState() {
      return persistState
    },
    get persistScheduler() {
      return persistScheduler
    },
    get listeners() {
      return listeners
    },

    // === Read Actions ===

    getComponentState<T = Record<string, unknown>>(componentId: string): T | null {
      return (components.get(componentId)?.state as T) ?? null
    },

    getComponent(componentId: string): DurableComponentState | null {
      return components.get(componentId) ?? null
    },

    getAllComponents(): Array<{ id: string } & DurableComponentState> {
      return Array.from(components.entries()).map(([id, comp]) => ({
        id,
        ...comp,
      }))
    },

    // === Write Actions ===

    updateComponentState<T = Record<string, unknown>>(
      componentId: string,
      update: StateUpdate<T>
    ): void {
      const component = components.get(componentId)
      if (!component) return

      // Handle functional update: (prev) => patch
      const patch =
        typeof update === 'function'
          ? update(component.state as T)
          : update

      component.state = { ...component.state, ...patch }
      dirtyIds.add(componentId)

      if (persistState.inFlight) {
        persistState.pendingChanges.add(componentId)
      }

      persistScheduler.scheduleDebounced()
      notify()
    },

    updateComponentPosition(
      componentId: string,
      position: { x: number; y: number }
    ): void {
      const component = components.get(componentId)
      if (!component) return

      component.position = position
      dirtyIds.add(componentId)

      if (persistState.inFlight) {
        persistState.pendingChanges.add(componentId)
      }

      persistScheduler.scheduleDebounced()
      notify()
    },

    updateComponentSize(
      componentId: string,
      size: { width: number; height: number } | null
    ): void {
      const component = components.get(componentId)
      if (!component) return

      component.size = size
      dirtyIds.add(componentId)

      if (persistState.inFlight) {
        persistState.pendingChanges.add(componentId)
      }

      persistScheduler.scheduleDebounced()
      notify()
    },

    updateComponentZIndex(componentId: string, zIndex: number): void {
      const component = components.get(componentId)
      if (!component) return

      component.zIndex = zIndex
      dirtyIds.add(componentId)

      if (persistState.inFlight) {
        persistState.pendingChanges.add(componentId)
      }

      persistScheduler.scheduleDebounced()
      notify()
    },

    addComponent(componentId: string, component: DurableComponentState): void {
      components.set(componentId, component)
      dirtyIds.add(componentId)

      if (persistState.inFlight) {
        persistState.pendingChanges.add(componentId)
      }

      persistScheduler.scheduleDebounced()

      void debugLog({
        component: 'WorkspaceComponentStore',
        action: 'component_added',
        metadata: { workspaceId, componentId, type: component.type },
      })

      notify()
    },

    removeComponent(componentId: string): void {
      const had = components.delete(componentId)
      activeIds.delete(componentId)

      // Stop any active operation for this component
      const intervalId = activeOperations.get(componentId)
      if (intervalId) {
        clearInterval(intervalId)
        activeOperations.delete(componentId)
      }

      // Mark dirty so removal is persisted
      dirtyIds.add(componentId)

      if (persistState.inFlight) {
        persistState.pendingChanges.add(componentId)
      }

      persistScheduler.scheduleDebounced()

      if (had) {
        void debugLog({
          component: 'WorkspaceComponentStore',
          action: 'component_removed',
          metadata: { workspaceId, componentId },
        })
        notify()
      }
    },

    // === Active Tracking ===

    setActive(componentId: string, active: boolean): void {
      const changed = active
        ? !activeIds.has(componentId) && (activeIds.add(componentId), true)
        : activeIds.delete(componentId)

      if (changed) {
        void debugLog({
          component: 'WorkspaceComponentStore',
          action: 'active_changed',
          metadata: {
            workspaceId,
            componentId,
            active,
            totalActive: activeIds.size,
          },
        })
        notify()
      }
    },

    hasActiveOperations(): boolean {
      return activeIds.size > 0
    },

    getActiveIds(): string[] {
      return Array.from(activeIds)
    },

    // === Dirty Tracking ===

    hasDirtyState(): boolean {
      return dirtyIds.size > 0
    },

    getDirtyIds(): string[] {
      return Array.from(dirtyIds)
    },

    clearDirty(): void {
      dirtyIds.clear()
    },

    // === Persistence ===

    setPersistCallback(
      cb: (
        components: Array<{ id: string } & DurableComponentState>,
        meta: { revision: number }
      ) => Promise<void>
    ): void {
      persistCallback = cb
    },

    async persist(): Promise<void> {
      // Lifecycle gate: no persist until restored/initialized
      if (lifecycle !== 'ready' && lifecycle !== 'persisting') {
        return
      }

      // If persist is already in-flight, callers can await it
      if (persistState.inFlightPromise) {
        return persistState.inFlightPromise
      }

      if (!persistCallback || dirtyIds.size === 0) {
        return
      }

      persistState.inFlight = true
      const prevLifecycle = lifecycle
      lifecycle = 'persisting'

      const runPersist = (async () => {
        while (true) {
          const revision = ++persistState.revision
          const dirtySnapshot = new Set(dirtyIds)
          persistState.pendingChanges.clear()

          // Persist full snapshot
          const allComponents = store.getAllComponents()

          void debugLog({
            component: 'WorkspaceComponentStore',
            action: 'persist_start',
            metadata: {
              workspaceId,
              revision,
              dirtyCount: dirtySnapshot.size,
              totalCount: allComponents.length,
            },
          })

          try {
            await persistCallback!(allComponents, { revision })

            // Clear only what we persisted
            for (const id of dirtySnapshot) {
              dirtyIds.delete(id)
            }
            lastPersistedAt = Date.now()

            persistState.lastError = null
            persistState.retryCount = 0
            persistState.health =
              persistState.health === 'degraded' ? 'recovering' : 'healthy'

            void debugLog({
              component: 'WorkspaceComponentStore',
              action: 'persist_success',
              metadata: { workspaceId, revision, persistedAt: lastPersistedAt },
            })

            // Re-persist if changes accumulated during persist
            if (persistState.pendingChanges.size === 0) {
              if (persistState.health === 'recovering') {
                persistState.health = 'healthy'
              }
              break
            }
          } catch (error) {
            persistState.lastError = String(error)
            persistState.retryCount += 1
            persistState.health =
              persistState.retryCount >= 5 ? 'degraded' : 'retrying'

            if (
              persistState.health === 'degraded' &&
              persistState.degradedSince == null
            ) {
              persistState.degradedSince = Date.now()
            }

            void debugLog({
              component: 'WorkspaceComponentStore',
              action: 'persist_failed',
              metadata: {
                workspaceId,
                revision,
                error: String(error),
                retryCount: persistState.retryCount,
                health: persistState.health,
              },
            })

            // Schedule retry with exponential backoff
            setTimeout(
              () => void store.persist(),
              Math.min(1000 * 2 ** persistState.retryCount, 30000)
            )
            throw error
          }
        }
      })()

      persistState.inFlightPromise = runPersist

      try {
        await runPersist
      } finally {
        persistState.inFlight = false
        persistState.inFlightPromise = null
        if (lifecycle === 'persisting') {
          lifecycle = prevLifecycle === 'persisting' ? 'ready' : prevLifecycle
        }
      }
    },

    restore(
      restoredComponents: Array<{
        id: string
        type: string
        schemaVersion?: number
        position?: { x: number; y: number } | null
        size?: { width: number; height: number } | null
        zIndex?: number
        metadata?: Record<string, unknown> | null
      }>,
      options: { restoreType: 'hot' | 'cold'; baseRevision?: number } = {
        restoreType: 'cold',
        baseRevision: 0,
      }
    ): void {
      if (lifecycle === 'restoring') {
        throw new Error('Restore already in progress')
      }

      if (lifecycle === 'ready' && options.restoreType === 'hot') {
        // Hot restore: store already has state; do not overwrite
        return
      }

      lifecycle = 'restoring'

      try {
        // Seed revision from durable payload
        const nextRevision = Math.max(
          persistState.revision,
          options.baseRevision ?? 0
        )

        // Build into temp map first (atomic swap)
        const nextComponents = new Map<string, DurableComponentState>()

        for (const comp of restoredComponents) {
          const incomingSchemaVersion = comp.schemaVersion ?? 1

          // Process through Component Type Registry
          const processed = processComponentStateForRestore(
            comp.type,
            incomingSchemaVersion,
            comp.metadata ?? {},
            options.restoreType
          )

          nextComponents.set(comp.id, {
            type: comp.type,
            schemaVersion: processed.schemaVersion,
            position: comp.position ?? { x: 0, y: 0 },
            size: comp.size ?? null,
            zIndex: comp.zIndex ?? 100,
            state: processed.state,
          })
        }

        // Atomic swap
        components.clear()
        for (const [id, comp] of nextComponents) {
          components.set(id, comp)
        }

        activeIds.clear()
        dirtyIds.clear()
        persistState.pendingChanges.clear()
        persistState.revision = nextRevision

        lifecycle = 'ready'

        void debugLog({
          component: 'WorkspaceComponentStore',
          action: 'restore_complete',
          metadata: {
            workspaceId,
            restoredCount: restoredComponents.length,
            restoreType: options.restoreType,
            baseRevision: nextRevision,
          },
        })

        notify()
      } catch (error) {
        lifecycle = 'error'
        persistState.lastError = String(error)

        void debugLog({
          component: 'WorkspaceComponentStore',
          action: 'restore_failed',
          metadata: { workspaceId, error: String(error) },
        })

        notify()
        throw error
      }
    },

    // === Eviction ===

    getEvictionPriority(): number {
      // Higher score = less likely to evict
      let score = 0

      // Active operations get high protection (+500)
      if (activeIds.size > 0) {
        score += 500
      }

      // Components with state get some protection (+100)
      if (components.size > 0) {
        score += 100
      }

      // Recency is factored in externally (runtime-manager has lastVisibleAt)

      return score
    },

    async prepareForEviction(): Promise<{ canEvict: boolean; reason?: string }> {
      if (lifecycle !== 'ready' && lifecycle !== 'persisting') {
        return { canEvict: false, reason: `workspace_not_ready:${lifecycle}` }
      }

      const hadDirty = dirtyIds.size > 0

      // Must be durable before eviction (persist-before-evict)
      if (!persistCallback && hadDirty) {
        return { canEvict: false, reason: 'persist_callback_not_set' }
      }

      try {
        // Flush any pending persist
        await persistScheduler.flushNow()
      } catch (error) {
        return { canEvict: false, reason: `persist_failed:${String(error)}` }
      }

      void debugLog({
        component: 'WorkspaceComponentStore',
        action: 'prepared_for_eviction',
        metadata: {
          workspaceId,
          hadDirty,
          activeCount: activeIds.size,
          persistHealth: persistState.health,
        },
      })

      return { canEvict: true }
    },

    // === Headless Operations (Option B) ===

    startTimerOperation(componentId: string): void {
      const compState = components.get(componentId)
      if (!compState) return

      // Don't start if already running
      if (compState.state.isRunning || activeOperations.has(componentId)) {
        return
      }

      // Interval owned by STORE - survives component unmount
      const intervalId = setInterval(() => {
        store.updateComponentState(componentId, (prev: Record<string, unknown>) => {
          const secs = (prev.seconds as number) ?? 0
          const mins = (prev.minutes as number) ?? 0

          if (secs > 0) {
            return { seconds: secs - 1 }
          }

          if (mins > 0) {
            return { minutes: mins - 1, seconds: 59 }
          }

          // Timer completed
          store.stopTimerOperation(componentId)
          return { isRunning: false }
        })
      }, 1000)

      activeOperations.set(componentId, intervalId)
      store.updateComponentState(componentId, { isRunning: true })
      store.setActive(componentId, true)

      void debugLog({
        component: 'WorkspaceComponentStore',
        action: 'timer_started',
        metadata: { workspaceId, componentId },
      })
    },

    stopTimerOperation(componentId: string): void {
      const intervalId = activeOperations.get(componentId)
      if (intervalId) {
        clearInterval(intervalId)
        activeOperations.delete(componentId)
      }

      store.updateComponentState(componentId, { isRunning: false })
      store.setActive(componentId, false)

      void debugLog({
        component: 'WorkspaceComponentStore',
        action: 'timer_stopped',
        metadata: { workspaceId, componentId },
      })
    },

    stopAllOperations(): void {
      // Stop all store-owned intervals
      for (const [componentId, intervalId] of activeOperations) {
        clearInterval(intervalId)

        void debugLog({
          component: 'WorkspaceComponentStore',
          action: 'stopped_operation_on_delete',
          metadata: { workspaceId, componentId },
        })
      }

      activeOperations.clear()
      activeIds.clear()
    },

    // === Subscriptions ===

    subscribe(listener: () => void): () => void {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },

    getSnapshot(): WorkspaceComponentStore {
      return store
    },
  }

  // Create persist scheduler (needs store reference)
  persistScheduler = createPersistScheduler(store)

  // Register for global flush handlers
  registerPersistScheduler(workspaceId, persistScheduler)

  void debugLog({
    component: 'WorkspaceComponentStore',
    action: 'store_created',
    metadata: { workspaceId },
  })

  return store
}
