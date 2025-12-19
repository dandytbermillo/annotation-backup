/**
 * Bridge between Workspace Component Store and Runtime Manager
 *
 * This module provides integration between the new centralized workspace
 * component store and the existing runtime-manager API. It allows gradual
 * migration without breaking backward compatibility.
 *
 * See: docs/proposal/workspace-state-machine/IMPLEMENTATION_PLAN.md (Phase 3)
 *
 * Key responsibilities:
 * - Sync state between new store and legacy runtime ledger
 * - Provide helpers for persistence integration
 * - Support hot/cold restore detection
 */

'use client'

import {
  getWorkspaceComponentStore,
  hasWorkspaceComponentStore,
  deleteWorkspaceComponentStore,
} from './workspace-component-store'
import {
  listRuntimeComponents,
  populateRuntimeComponents,
  hasWorkspaceRuntime,
  hasActiveBackgroundOperation,
  getWorkspaceHydrationState,
  registerPreEvictionCallback,
  unregisterPreEvictionCallback,
  registerEvictionBlockedCallback,
  unregisterEvictionBlockedCallback,
  forceEvictWorkspaceWithActiveOperations,
  getWorkspacesBlockingEviction,
  type RuntimeComponent,
  type EvictionBlockedCallback,
} from './runtime-manager'
// Note: processComponentStateForRestore is called in store.restore(), not here
// This prevents double-processing which causes state nesting
import { debugLog } from '@/lib/utils/debug-logger'
import type { NoteWorkspaceComponentSnapshot } from '@/lib/types/note-workspace'
import type { DurableComponentState } from './workspace-store-types'

// Phase 3 Unified Durability: Use lifecycle manager for hot/cold detection
import { isWorkspaceLifecycleReady } from './durability'

// =============================================================================
// Workspace Persist Requester Registry (Step 5)
// =============================================================================

/**
 * Type for workspace persist request function.
 * This is the canonical persist function from use-workspace-persistence.ts.
 */
export type WorkspacePersistRequester = (
  workspaceId: string,
  reason: string,
  options?: { isBackground?: boolean }
) => Promise<boolean>

/**
 * Registry of workspace persist requesters.
 * Maps workspaceId to the persist function provided by the persistence hook.
 */
const persistRequesters = new Map<string, WorkspacePersistRequester>()

/**
 * Global fallback persist requester (used when workspace-specific is not registered).
 * This is set by the persistence provider and handles any workspace.
 */
let globalPersistRequester: WorkspacePersistRequester | null = null

/**
 * Register the global persist requester.
 * Called by use-workspace-persistence.ts when the hook mounts.
 *
 * Step 5: This allows the component store to request workspace persists
 * via the canonical persistWorkspaceById path.
 *
 * @param requester The persist function from the persistence hook
 */
export function registerGlobalPersistRequester(
  requester: WorkspacePersistRequester
): void {
  globalPersistRequester = requester

  void debugLog({
    component: 'StoreRuntimeBridge',
    action: 'global_persist_requester_registered',
    metadata: {},
  })
}

/**
 * Unregister the global persist requester.
 * Called when the persistence hook unmounts.
 */
export function unregisterGlobalPersistRequester(): void {
  globalPersistRequester = null

  void debugLog({
    component: 'StoreRuntimeBridge',
    action: 'global_persist_requester_unregistered',
    metadata: {},
  })
}

/**
 * Request a workspace persist via the canonical path.
 * Used by the component store's persist callback.
 *
 * Step 5: This routes component persistence through persistWorkspaceById
 * instead of writing components directly to DB.
 *
 * @param workspaceId Workspace to persist
 * @param reason Persist reason (e.g., 'components_changed')
 * @returns Promise resolving to success/failure
 */
export async function requestWorkspacePersist(
  workspaceId: string,
  reason: string
): Promise<boolean> {
  // Try workspace-specific requester first, then global
  const requester = persistRequesters.get(workspaceId) ?? globalPersistRequester

  if (!requester) {
    void debugLog({
      component: 'StoreRuntimeBridge',
      action: 'persist_request_no_requester',
      metadata: { workspaceId, reason },
    })
    return false
  }

  void debugLog({
    component: 'StoreRuntimeBridge',
    action: 'persist_request_forwarding',
    metadata: { workspaceId, reason },
  })

  try {
    const result = await requester(workspaceId, reason)

    void debugLog({
      component: 'StoreRuntimeBridge',
      action: 'persist_request_result',
      metadata: { workspaceId, reason, success: result },
    })

    return result
  } catch (error) {
    void debugLog({
      component: 'StoreRuntimeBridge',
      action: 'persist_request_error',
      metadata: {
        workspaceId,
        reason,
        error: error instanceof Error ? error.message : String(error),
      },
    })
    return false
  }
}

// =============================================================================
// Types
// =============================================================================

export interface ComponentSnapshotForPersist {
  id: string
  type: string
  position: { x: number; y: number }
  size: { width: number; height: number } | null
  zIndex: number | null
  metadata: Record<string, unknown> | null
}

export type RestoreType = 'hot' | 'cold'

// =============================================================================
// Reading Components for Persistence
// =============================================================================

/**
 * Get components for persistence payload.
 * Reads from new store if available, falls back to legacy runtime ledger.
 *
 * This is the primary function for `buildPayload` to use.
 *
 * @param workspaceId Workspace ID
 * @returns Array of component snapshots for persistence
 */
export function getComponentsForPersistence(
  workspaceId: string
): ComponentSnapshotForPersist[] {
  // Strategy: Prefer new store, fall back to legacy runtime ledger
  // During migration, both may have data - prefer store as authoritative

  // Check if new store exists and has components
  if (hasWorkspaceComponentStore(workspaceId)) {
    const store = getWorkspaceComponentStore(workspaceId)
    const storeComponents = store.getAllComponents()

    if (storeComponents.length > 0) {
      void debugLog({
        component: 'StoreRuntimeBridge',
        action: 'get_components_from_store',
        metadata: {
          workspaceId,
          componentCount: storeComponents.length,
          source: 'workspace_component_store',
        },
      })

      return storeComponents.map((comp) => ({
        id: comp.id,
        type: comp.type,
        position: comp.position,
        size: comp.size,
        zIndex: comp.zIndex,
        // The store's `state` field contains the component's metadata
        metadata: comp.state,
      }))
    }
  }

  // Fall back to legacy runtime ledger
  const runtimeComponents = listRuntimeComponents(workspaceId)

  if (runtimeComponents.length > 0) {
    void debugLog({
      component: 'StoreRuntimeBridge',
      action: 'get_components_from_runtime',
      metadata: {
        workspaceId,
        componentCount: runtimeComponents.length,
        source: 'runtime_ledger_fallback',
      },
    })

    return runtimeComponents.map((comp) => ({
      id: comp.componentId,
      type: comp.componentType,
      position: comp.position,
      size: comp.size,
      zIndex: comp.zIndex,
      metadata: comp.metadata,
    }))
  }

  return []
}

// =============================================================================
// Restoring Components from Database
// =============================================================================

/**
 * Determine if this is a hot restore (workspace already restored) or cold restore.
 *
 * Phase 3 Unified Durability: Use lifecycle state as the primary check.
 * Hot = workspace lifecycle is 'ready' (fully restored)
 * Cold = workspace lifecycle is NOT 'ready' (needs to load from DB)
 *
 * @param workspaceId Workspace ID
 * @returns 'hot' if workspace is ready, 'cold' otherwise
 */
export function detectRestoreType(workspaceId: string): RestoreType {
  // Step 7 COMPLETE: Use lifecycle state as SOLE hot/cold discriminator
  // Hot = workspace lifecycle is 'ready' (fully restored from DB)
  // Cold = workspace lifecycle is NOT 'ready' (needs to load from DB)
  return isWorkspaceLifecycleReady(workspaceId) ? 'hot' : 'cold'
}

/**
 * Restore components to workspace from DB payload.
 * Handles hot/cold restore detection and cold restore invariant.
 *
 * @param workspaceId Workspace ID
 * @param components Components from DB payload
 * @param options Restore options
 */
export function restoreComponentsToWorkspace(
  workspaceId: string,
  components: NoteWorkspaceComponentSnapshot[],
  options?: {
    forceRestoreType?: RestoreType
    skipRuntimeSync?: boolean
  }
): void {
  const restoreType = options?.forceRestoreType ?? detectRestoreType(workspaceId)

  void debugLog({
    component: 'StoreRuntimeBridge',
    action: 'restore_components_start',
    metadata: {
      workspaceId,
      componentCount: components.length,
      restoreType,
      forced: !!options?.forceRestoreType,
    },
  })

  // Get or create the store
  const store = getWorkspaceComponentStore(workspaceId)

  // Step 5: Always set up persist callback to route through canonical path.
  // This must happen for BOTH hot and cold restores to ensure any future
  // component changes are persisted via the unified snapshot builder.
  // When the store's persist scheduler triggers persist(), it will call
  // requestWorkspacePersist which forwards to persistWorkspaceById.
  store.setPersistCallback(async (_components, _meta) => {
    // Note: We don't use the components parameter - the canonical persist path
    // uses getComponentsForPersistence() which reads from the store directly.
    // The meta.revision is also managed by the unified snapshot builder.
    const success = await requestWorkspacePersist(workspaceId, 'components_changed')
    if (!success) {
      // Throw to signal failure to the store's persist mechanism
      // This will trigger retry logic in workspace-component-store.ts
      throw new Error(`Workspace persist request failed for ${workspaceId}`)
    }
  })

  // For hot restore, check if we should skip (store already has state)
  if (restoreType === 'hot') {
    const existingComponents = store.getAllComponents()
    if (existingComponents.length > 0) {
      void debugLog({
        component: 'StoreRuntimeBridge',
        action: 'restore_skipped_hot',
        metadata: {
          workspaceId,
          existingCount: existingComponents.length,
          incomingCount: components.length,
          reason: 'store_has_state',
          persistCallbackWired: true,
        },
      })
      return
    }
  }

  // Convert NoteWorkspaceComponentSnapshot to the format expected by store.restore()
  // NOTE: Do NOT call processComponentStateForRestore here - store.restore() handles it.
  // Calling it here AND in store.restore() causes state nesting: {state: {state: {...}}}
  const storeComponents = components
    .filter((c) => c.id && c.type)
    .map((c) => ({
      id: c.id,
      type: c.type,
      schemaVersion: 1, // Current schema version
      position: c.position ?? { x: 0, y: 0 },
      size: c.size ?? null,
      zIndex: c.zIndex ?? 100,
      metadata: (c.metadata ?? {}) as Record<string, unknown>, // Pass raw metadata
    }))

  // Restore to store
  store.restore(storeComponents, { restoreType })

  void debugLog({
    component: 'StoreRuntimeBridge',
    action: 'restore_to_store_complete',
    metadata: {
      workspaceId,
      componentCount: storeComponents.length,
      restoreType,
      persistCallbackWired: true,
    },
  })

  // Also sync to legacy runtime ledger for backward compatibility
  if (!options?.skipRuntimeSync) {
    syncStoreToRuntimeLedger(workspaceId)
  }
}

// =============================================================================
// Sync Between Store and Runtime Ledger
// =============================================================================

/**
 * Sync store state to legacy runtime ledger.
 * Used during migration to keep both systems in sync.
 *
 * @param workspaceId Workspace ID
 */
export function syncStoreToRuntimeLedger(workspaceId: string): void {
  if (!hasWorkspaceComponentStore(workspaceId)) return
  if (!hasWorkspaceRuntime(workspaceId)) return

  const store = getWorkspaceComponentStore(workspaceId)
  const storeComponents = store.getAllComponents()

  // Convert store format to runtime format
  const runtimeFormat = storeComponents.map((comp) => ({
    id: comp.id,
    type: comp.type,
    position: comp.position,
    size: comp.size,
    metadata: comp.state,
    zIndex: comp.zIndex,
  }))

  // Populate runtime ledger (will update existing or add new)
  populateRuntimeComponents(workspaceId, runtimeFormat)

  void debugLog({
    component: 'StoreRuntimeBridge',
    action: 'sync_store_to_runtime',
    metadata: {
      workspaceId,
      componentCount: storeComponents.length,
    },
  })
}

/**
 * Sync legacy runtime ledger to store.
 * Used to migrate existing runtime state to new store.
 *
 * @param workspaceId Workspace ID
 */
export function syncRuntimeLedgerToStore(workspaceId: string): void {
  const runtimeComponents = listRuntimeComponents(workspaceId)
  if (runtimeComponents.length === 0) return

  const store = getWorkspaceComponentStore(workspaceId)

  // Only sync if store is empty (don't overwrite store state)
  const existingStoreComponents = store.getAllComponents()
  if (existingStoreComponents.length > 0) {
    void debugLog({
      component: 'StoreRuntimeBridge',
      action: 'sync_runtime_to_store_skipped',
      metadata: {
        workspaceId,
        reason: 'store_not_empty',
        storeCount: existingStoreComponents.length,
        runtimeCount: runtimeComponents.length,
      },
    })
    return
  }

  // Convert runtime format to store format
  const storeFormat = runtimeComponents.map((comp) => ({
    id: comp.componentId,
    type: comp.componentType,
    schemaVersion: 1,
    position: comp.position,
    size: comp.size,
    zIndex: comp.zIndex,
    metadata: comp.metadata,
  }))

  // Restore to store as hot (don't apply cold restore invariant)
  store.restore(storeFormat, { restoreType: 'hot' })

  void debugLog({
    component: 'StoreRuntimeBridge',
    action: 'sync_runtime_to_store',
    metadata: {
      workspaceId,
      componentCount: runtimeComponents.length,
    },
  })
}

// =============================================================================
// Active Operations Detection
// =============================================================================

/**
 * Check if workspace has active operations.
 * Checks both new store and legacy runtime.
 *
 * @param workspaceId Workspace ID
 * @returns true if any component has active operations
 */
export function workspaceHasActiveOperations(workspaceId: string): boolean {
  // Check new store first
  if (hasWorkspaceComponentStore(workspaceId)) {
    const store = getWorkspaceComponentStore(workspaceId)
    if (store.hasActiveOperations()) {
      return true
    }
  }

  // Also check legacy runtime
  return hasActiveBackgroundOperation(workspaceId)
}

// =============================================================================
// Dirty State Detection
// =============================================================================

/**
 * Check if workspace has dirty (unsaved) state.
 * Used for persist-before-evict logic.
 *
 * @param workspaceId Workspace ID
 * @returns true if workspace has unsaved changes
 */
export function workspaceHasDirtyState(workspaceId: string): boolean {
  const hasStore = hasWorkspaceComponentStore(workspaceId)
  if (hasStore) {
    const store = getWorkspaceComponentStore(workspaceId)
    return store.hasDirtyState()
  }
  return false
}

// =============================================================================
// Flush/Persist Triggers
// =============================================================================

/**
 * Trigger immediate persistence for a workspace.
 * Used before eviction or on critical events.
 *
 * @param workspaceId Workspace ID
 * @returns Promise that resolves when persistence completes
 */
export async function flushWorkspaceState(workspaceId: string): Promise<void> {
  if (hasWorkspaceComponentStore(workspaceId)) {
    const store = getWorkspaceComponentStore(workspaceId)
    await store.persist()

    void debugLog({
      component: 'StoreRuntimeBridge',
      action: 'flush_workspace_state',
      metadata: { workspaceId },
    })
  }
}

// =============================================================================
// Cleanup
// =============================================================================

/**
 * Clean up workspace store on eviction.
 * Should be called before runtime is removed.
 *
 * @param workspaceId Workspace ID
 */
export function cleanupWorkspaceStore(workspaceId: string): void {
  if (hasWorkspaceComponentStore(workspaceId)) {
    const store = getWorkspaceComponentStore(workspaceId)

    // Stop all active operations
    store.stopAllOperations()

    // Delete the store
    deleteWorkspaceComponentStore(workspaceId)

    void debugLog({
      component: 'StoreRuntimeBridge',
      action: 'cleanup_workspace_store',
      metadata: { workspaceId },
    })
  }
}

// =============================================================================
// Pre-eviction Callback Integration
// =============================================================================

/**
 * Pre-eviction callback for cleanup before eviction.
 * Registered with runtime-manager to clean up component store before eviction.
 *
 * STEP 4.5: Removed flushWorkspaceState() call.
 * Previously, this callback flushed component state via store.persist() before eviction.
 * This created a race condition with persistWorkspaceById which also persists components
 * via the unified snapshot builder (buildUnifiedSnapshot).
 *
 * Now that Step 2 is complete (unified snapshot builder is canonical), components are
 * included in the unified workspace payload, so the separate component flush is redundant.
 *
 * The use-note-workspaces.ts pre-eviction callback handles persistence via the canonical
 * persistWorkspaceById path. This callback now only handles store cleanup (stopping
 * operations and deleting the store).
 *
 * @param workspaceId Workspace ID being evicted
 * @param reason Eviction reason
 */
export async function preEvictionPersistCallback(
  workspaceId: string,
  reason: string
): Promise<void> {
  void debugLog({
    component: 'StoreRuntimeBridge',
    action: 'pre_eviction_cleanup_start',
    metadata: { workspaceId, reason },
  })

  try {
    // STEP 4.5: Removed flushWorkspaceState() - component persistence is now handled
    // by the unified snapshot builder in persistWorkspaceById. Keeping this call
    // would cause a race condition (double-write) with the canonical persist path.

    // Clean up the store (stop operations, delete store)
    cleanupWorkspaceStore(workspaceId)

    void debugLog({
      component: 'StoreRuntimeBridge',
      action: 'pre_eviction_cleanup_complete',
      metadata: { workspaceId, reason },
    })
  } catch (error) {
    void debugLog({
      component: 'StoreRuntimeBridge',
      action: 'pre_eviction_cleanup_error',
      metadata: {
        workspaceId,
        reason,
        error: error instanceof Error ? error.message : String(error),
      },
    })
    throw error
  }
}

// =============================================================================
// Initialization
// =============================================================================

let bridgeInitialized = false

/**
 * Initialize the store-runtime bridge.
 * Registers pre-eviction callback with runtime-manager.
 * Should be called early in app lifecycle (e.g., in DashboardInitializer).
 *
 * Safe to call multiple times - will only initialize once.
 */
export function initializeStoreRuntimeBridge(): void {
  if (bridgeInitialized) return

  // Register pre-eviction callback
  registerPreEvictionCallback(preEvictionPersistCallback)

  bridgeInitialized = true

  void debugLog({
    component: 'StoreRuntimeBridge',
    action: 'bridge_initialized',
    metadata: {
      preEvictionCallbackRegistered: true,
    },
  })

  if (process.env.NODE_ENV === 'development') {
    console.log('[StoreRuntimeBridge] Bridge initialized with pre-eviction callback')
  }
}

/**
 * Cleanup the store-runtime bridge.
 * Unregisters pre-eviction callback.
 * Called during app shutdown if needed.
 */
export function cleanupStoreRuntimeBridge(): void {
  if (!bridgeInitialized) return

  unregisterPreEvictionCallback(preEvictionPersistCallback)

  bridgeInitialized = false

  void debugLog({
    component: 'StoreRuntimeBridge',
    action: 'bridge_cleanup',
    metadata: {},
  })
}

// =============================================================================
// Phase 4: Active Operations Protection - Re-exports
// =============================================================================

/**
 * Re-export eviction blocked callback type for UI components.
 */
export type { EvictionBlockedCallback }

/**
 * Register callback for when eviction is blocked due to active operations.
 * UI can use this to prompt user for decision.
 *
 * @example
 * ```tsx
 * useEffect(() => {
 *   const handleBlocked = ({ workspaceId, activeOperationCount }) => {
 *     // Show modal asking user to confirm eviction
 *     showEvictionConfirmModal(workspaceId, activeOperationCount)
 *   }
 *   registerEvictionBlockedListener(handleBlocked)
 *   return () => unregisterEvictionBlockedListener(handleBlocked)
 * }, [])
 * ```
 */
export const registerEvictionBlockedListener = registerEvictionBlockedCallback

/**
 * Unregister eviction blocked callback.
 */
export const unregisterEvictionBlockedListener = unregisterEvictionBlockedCallback

/**
 * Force evict a workspace with active operations.
 * This is for USER-INITIATED eviction only.
 *
 * Phase 4: This is the ONLY way to evict a workspace with active operations.
 * Auto-eviction will NEVER kill active operations - user must decide.
 *
 * @param workspaceId Workspace ID to force evict
 * @param reason Reason for forced eviction (for logging)
 * @returns Promise with eviction result
 *
 * @example
 * ```tsx
 * const handleUserConfirmedEviction = async (workspaceId: string) => {
 *   const result = await forceEvictActiveWorkspace(workspaceId, 'user_confirmed')
 *   if (result.success) {
 *     showToast(`Stopped ${result.stoppedOperations} operations`)
 *   }
 * }
 * ```
 */
export const forceEvictActiveWorkspace = forceEvictWorkspaceWithActiveOperations

/**
 * Get list of workspaces that are blocking auto-eviction due to active operations.
 * Used by UI to show user which workspaces have running operations.
 *
 * @returns Array of blocked workspaces with their active operation counts
 */
export const getActiveWorkspacesBlockingEviction = getWorkspacesBlockingEviction
