/**
 * React Hooks for Workspace Component Store
 *
 * Provides React bindings for the workspace component store using
 * useSyncExternalStore for proper concurrent mode support.
 *
 * See: docs/proposal/workspace-state-machine/IMPLEMENTATION_PLAN.md (Phase 2)
 *
 * Key concepts:
 * - Selector-based subscriptions (only re-render when selected value changes)
 * - Stable action references (don't cause re-renders)
 * - Works with React 18 concurrent features
 */

'use client'

import { useSyncExternalStore, useCallback, useMemo, useRef } from 'react'
import {
  getWorkspaceComponentStore,
  hasWorkspaceComponentStore,
} from '@/lib/workspace/workspace-component-store'
import type {
  WorkspaceComponentStore,
  WorkspaceStoreActions,
  DurableComponentState,
  StateUpdate,
  WorkspaceLifecycle,
  PersistHealth,
} from '@/lib/workspace/workspace-store-types'

// =============================================================================
// Core Selector Hook
// =============================================================================

/**
 * Subscribe to workspace component store with selector.
 * Only re-renders when selected value changes (shallow equality).
 *
 * @param workspaceId Workspace ID (null/undefined returns null)
 * @param selector Function to select data from store
 * @returns Selected value or null if no workspace
 *
 * @example
 * ```tsx
 * // Only re-renders when this specific component's state changes
 * const timerState = useWorkspaceComponentStore(
 *   workspaceId,
 *   store => store.getComponentState('timer-1')
 * )
 * ```
 */
export function useWorkspaceComponentStore<T>(
  workspaceId: string | null | undefined,
  selector: (store: WorkspaceComponentStore & WorkspaceStoreActions) => T
): T | null {
  // Get store (creates if doesn't exist)
  const store = useMemo(
    () => (workspaceId ? getWorkspaceComponentStore(workspaceId) : null),
    [workspaceId]
  )

  // Memoize selector to prevent unnecessary recalculations
  const selectorRef = useRef(selector)
  selectorRef.current = selector

  // Subscribe function for useSyncExternalStore
  const subscribe = useCallback(
    (onStoreChange: () => void) => {
      if (!store) return () => {}
      return store.subscribe(onStoreChange)
    },
    [store]
  )

  // Snapshot function - applies selector
  const getSnapshot = useCallback(() => {
    if (!store) return null
    return selectorRef.current(store)
  }, [store])

  // Server snapshot (same as client for this store)
  const getServerSnapshot = useCallback(() => {
    if (!store) return null
    return selectorRef.current(store)
  }, [store])

  return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot)
}

// =============================================================================
// Component State Hook
// =============================================================================

/**
 * Get component state from workspace store.
 * Convenience wrapper for the common use case.
 *
 * @param workspaceId Workspace ID
 * @param componentId Component ID
 * @returns Component state or null
 *
 * @example
 * ```tsx
 * interface TimerState {
 *   minutes: number
 *   seconds: number
 *   isRunning: boolean
 * }
 *
 * const state = useComponentState<TimerState>(workspaceId, 'timer-1')
 * // state?.minutes, state?.seconds, etc.
 * ```
 */
export function useComponentState<T = Record<string, unknown>>(
  workspaceId: string | null | undefined,
  componentId: string
): T | null {
  return useWorkspaceComponentStore(
    workspaceId,
    useCallback(
      (store) => store.getComponentState<T>(componentId),
      [componentId]
    )
  )
}

/**
 * Get full component (including position, size, zIndex).
 *
 * @param workspaceId Workspace ID
 * @param componentId Component ID
 * @returns Full component or null
 */
export function useComponent(
  workspaceId: string | null | undefined,
  componentId: string
): DurableComponentState | null {
  return useWorkspaceComponentStore(
    workspaceId,
    useCallback(
      (store) => store.getComponent(componentId),
      [componentId]
    )
  )
}

/**
 * Get all components in workspace.
 * Use sparingly - re-renders on ANY component change.
 *
 * @param workspaceId Workspace ID
 * @returns Array of components with IDs
 */
export function useAllComponents(
  workspaceId: string | null | undefined
): Array<{ id: string } & DurableComponentState> | null {
  return useWorkspaceComponentStore(
    workspaceId,
    useCallback((store) => store.getAllComponents(), [])
  )
}

// =============================================================================
// Store Actions Hook
// =============================================================================

/**
 * Get workspace store actions.
 * Actions are stable references (don't cause re-renders).
 *
 * @param workspaceId Workspace ID
 * @returns Object with action functions
 *
 * @example
 * ```tsx
 * const {
 *   updateComponentState,
 *   startTimerOperation,
 *   stopTimerOperation,
 * } = useWorkspaceStoreActions(workspaceId)
 *
 * // These are stable - safe to use in deps arrays
 * const handleStart = () => startTimerOperation('timer-1')
 * ```
 */
export function useWorkspaceStoreActions(workspaceId: string | null | undefined) {
  const store = useMemo(
    () => (workspaceId ? getWorkspaceComponentStore(workspaceId) : null),
    [workspaceId]
  )

  // Memoize all actions to prevent re-renders
  return useMemo(() => {
    if (!store) {
      // Return no-op functions when no store
      return {
        updateComponentState: () => {},
        updateComponentPosition: () => {},
        updateComponentSize: () => {},
        updateComponentZIndex: () => {},
        addComponent: () => {},
        removeComponent: () => {},
        setActive: () => {},
        startTimerOperation: () => {},
        stopTimerOperation: () => {},
        stopAllOperations: () => {},
        persist: async () => {},
        restore: () => {},
        setPersistCallback: () => {},
      }
    }

    return {
      /**
       * Update component state (supports object patch or functional update).
       */
      updateComponentState: <T = Record<string, unknown>>(
        componentId: string,
        update: StateUpdate<T>
      ) => {
        store.updateComponentState(componentId, update)
      },

      /**
       * Update component position.
       */
      updateComponentPosition: (
        componentId: string,
        position: { x: number; y: number }
      ) => {
        store.updateComponentPosition(componentId, position)
      },

      /**
       * Update component size.
       */
      updateComponentSize: (
        componentId: string,
        size: { width: number; height: number } | null
      ) => {
        store.updateComponentSize(componentId, size)
      },

      /**
       * Update component z-index.
       */
      updateComponentZIndex: (componentId: string, zIndex: number) => {
        store.updateComponentZIndex(componentId, zIndex)
      },

      /**
       * Add a new component.
       */
      addComponent: (componentId: string, component: DurableComponentState) => {
        store.addComponent(componentId, component)
      },

      /**
       * Remove a component.
       */
      removeComponent: (componentId: string) => {
        store.removeComponent(componentId)
      },

      /**
       * Mark component as active/inactive.
       */
      setActive: (componentId: string, active: boolean) => {
        store.setActive(componentId, active)
      },

      /**
       * Start timer operation (Option B - interval in store).
       */
      startTimerOperation: (componentId: string) => {
        store.startTimerOperation(componentId)
      },

      /**
       * Stop timer operation.
       */
      stopTimerOperation: (componentId: string) => {
        store.stopTimerOperation(componentId)
      },

      /**
       * Stop all active operations.
       */
      stopAllOperations: () => {
        store.stopAllOperations()
      },

      /**
       * Persist dirty state to DB.
       */
      persist: async () => {
        await store.persist()
      },

      /**
       * Restore state from DB payload.
       */
      restore: (
        components: Array<{
          id: string
          type: string
          schemaVersion?: number
          position?: { x: number; y: number } | null
          size?: { width: number; height: number } | null
          zIndex?: number
          metadata?: Record<string, unknown> | null
        }>,
        options?: { restoreType: 'hot' | 'cold'; baseRevision?: number }
      ) => {
        store.restore(components, options)
      },

      /**
       * Set persistence callback.
       */
      setPersistCallback: (
        cb: (
          components: Array<{ id: string } & DurableComponentState>,
          meta: { revision: number }
        ) => Promise<void>
      ) => {
        store.setPersistCallback(cb)
      },
    }
  }, [store])
}

// =============================================================================
// Store Status Hooks
// =============================================================================

/**
 * Check if workspace has active operations.
 * Used for eviction decisions and UI indicators.
 *
 * @param workspaceId Workspace ID
 * @returns true if any components have active operations
 */
export function useWorkspaceHasActiveOperations(
  workspaceId: string | null | undefined
): boolean {
  return (
    useWorkspaceComponentStore(
      workspaceId,
      useCallback((store) => store.hasActiveOperations(), [])
    ) ?? false
  )
}

/**
 * Check if workspace has dirty (unsaved) state.
 *
 * @param workspaceId Workspace ID
 * @returns true if any components have unsaved changes
 */
export function useWorkspaceHasDirtyState(
  workspaceId: string | null | undefined
): boolean {
  return (
    useWorkspaceComponentStore(
      workspaceId,
      useCallback((store) => store.hasDirtyState(), [])
    ) ?? false
  )
}

/**
 * Get workspace lifecycle state.
 *
 * @param workspaceId Workspace ID
 * @returns Lifecycle state or null
 */
export function useWorkspaceLifecycle(
  workspaceId: string | null | undefined
): WorkspaceLifecycle | null {
  return useWorkspaceComponentStore(
    workspaceId,
    useCallback((store) => store.lifecycle, [])
  )
}

/**
 * Get workspace persist health.
 *
 * @param workspaceId Workspace ID
 * @returns Persist health or null
 */
export function useWorkspacePersistHealth(
  workspaceId: string | null | undefined
): PersistHealth | null {
  return useWorkspaceComponentStore(
    workspaceId,
    useCallback((store) => store.persistState.health, [])
  )
}

/**
 * Check if workspace store exists.
 * Does NOT create the store if it doesn't exist.
 *
 * @param workspaceId Workspace ID
 * @returns true if store exists
 */
export function useWorkspaceStoreExists(
  workspaceId: string | null | undefined
): boolean {
  // This doesn't use the store hook to avoid creating the store
  return useMemo(
    () => (workspaceId ? hasWorkspaceComponentStore(workspaceId) : false),
    [workspaceId]
  )
}

// =============================================================================
// Eviction Hooks
// =============================================================================

/**
 * Get workspace eviction priority.
 * Higher score = less likely to evict.
 *
 * @param workspaceId Workspace ID
 * @returns Priority score or 0
 */
export function useWorkspaceEvictionPriority(
  workspaceId: string | null | undefined
): number {
  return (
    useWorkspaceComponentStore(
      workspaceId,
      useCallback((store) => store.getEvictionPriority(), [])
    ) ?? 0
  )
}

// =============================================================================
// Convenience Combined Hooks
// =============================================================================

/**
 * Get component state and actions together.
 * Commonly used pattern for component implementation.
 *
 * @param workspaceId Workspace ID
 * @param componentId Component ID
 * @returns Object with state and actions
 *
 * @example
 * ```tsx
 * const { state, actions } = useComponentWithActions<TimerState>(
 *   workspaceId,
 *   'timer-1'
 * )
 *
 * // state?.minutes, state?.isRunning
 * // actions.updateComponentState('timer-1', { minutes: 10 })
 * // actions.startTimerOperation('timer-1')
 * ```
 */
export function useComponentWithActions<T = Record<string, unknown>>(
  workspaceId: string | null | undefined,
  componentId: string
) {
  const state = useComponentState<T>(workspaceId, componentId)
  const actions = useWorkspaceStoreActions(workspaceId)

  return { state, actions }
}

/**
 * Get full component (position, size, etc.) and actions together.
 *
 * @param workspaceId Workspace ID
 * @param componentId Component ID
 * @returns Object with component and actions
 */
export function useFullComponentWithActions(
  workspaceId: string | null | undefined,
  componentId: string
) {
  const component = useComponent(workspaceId, componentId)
  const actions = useWorkspaceStoreActions(workspaceId)

  return { component, actions }
}
