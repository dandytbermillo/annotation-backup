/**
 * StateTransaction - Atomic multi-store update transaction with rollback
 *
 * Provides transactional semantics for updating multiple stores (dataStore, branchesMap,
 * LayerManager) atomically. On hard failures (4xx/5xx errors), all changes are rolled back.
 * On soft failures (timeouts, network errors), optimistic updates are kept for offline replay.
 *
 * @see docs/proposal/canvas_state_persistence/implementation.md lines 130-220
 */

import { DataStore } from '@/lib/data-store'
import { LayerManager } from '@/lib/canvas/layer-manager'

/**
 * Store adapter interface - normalizes different store APIs
 */
export interface StoreAdapter {
  get(id: string): any
  set(id: string, value: any): void
}

/**
 * Partial panel state for updates
 */
export interface PanelState {
  position?: { x: number; y: number }
  size?: { width: number; height: number }
  metadata?: Record<string, any>
  [key: string]: any
}

/**
 * StateTransaction interface
 */
export interface StateTransaction {
  /**
   * Record an atomic update. Captures the previous store value so a rollback can restore it.
   */
  add(
    store: 'dataStore' | 'branchesMap' | 'layerManager',
    id: string,
    update: Partial<PanelState>
  ): void

  /**
   * Applies all queued updates, then invokes persistFn.
   * - Hard failures (HTTP 4xx/5xx except timeouts) trigger rollback and rethrow.
   * - Soft failures (network timeout, offline) keep optimistic state; the caller queues an offline edit.
   */
  commit(persistFn: () => Promise<void>): Promise<void>

  /**
   * Restores all stores to their captured pre-transaction values. Normally called internally on hard failure.
   */
  rollback(): void
}

/**
 * Update record for transaction tracking
 */
interface UpdateRecord {
  store: StoreAdapter
  id: string
  oldValue: any
  newValue: any
  applied: boolean
}

/**
 * Determine if an error represents a hard failure requiring rollback
 *
 * Hard failures: HTTP 4xx/5xx (except 408 Request Timeout, 429 Too Many Requests)
 * Soft failures: Network timeouts, connection errors (optimistic update stays)
 *
 * @param error - Error object from persistence operation
 * @returns true if error is a hard failure requiring rollback
 */
export function isHardFailure(error: unknown): boolean {
  // Response object (fetch API)
  if (error instanceof Response) {
    return error.status >= 400 && error.status !== 408 && error.status !== 429
  }

  // Error with status property
  if (error instanceof Error && 'status' in error) {
    const status = Number((error as any).status)
    return Number.isFinite(status) && status >= 400 && status !== 408 && status !== 429
  }

  // Other errors (network failures, etc.) are soft failures
  return false
}

/**
 * Create store adapters that normalize different store APIs
 *
 * @param dataStore - DataStore instance
 * @param branchesMap - Map<string, any> for branches
 * @param layerManager - LayerManager instance
 * @returns Store adapter registry
 */
export function createStoreAdapters(
  dataStore: DataStore,
  branchesMap: Map<string, any>,
  layerManager: LayerManager
): Record<'dataStore' | 'branchesMap' | 'layerManager', StoreAdapter> {
  return {
    dataStore: {
      get: (id: string) => dataStore.get(id),
      set: (id: string, value: any) => dataStore.set(id, value)
    },
    branchesMap: {
      get: (id: string) => branchesMap.get(id),
      set: (id: string, value: any) => branchesMap.set(id, value)
    },
    layerManager: {
      get: (id: string) => layerManager.getNode(id),
      set: (id: string, value: any) => layerManager.updateNode(id, value)
    }
  }
}

/**
 * StateTransaction implementation
 */
export class StateTransactionImpl implements StateTransaction {
  private updates: UpdateRecord[] = []
  private storeAdapters: Record<'dataStore' | 'branchesMap' | 'layerManager', StoreAdapter>

  constructor(
    dataStore: DataStore,
    branchesMap: Map<string, any>,
    layerManager: LayerManager
  ) {
    this.storeAdapters = createStoreAdapters(dataStore, branchesMap, layerManager)
  }

  /**
   * Resolve store name to adapter
   */
  private resolveStore(
    storeName: 'dataStore' | 'branchesMap' | 'layerManager'
  ): StoreAdapter {
    return this.storeAdapters[storeName]
  }

  /**
   * Add an update to the transaction
   */
  add(
    storeName: 'dataStore' | 'branchesMap' | 'layerManager',
    id: string,
    update: Partial<PanelState>
  ): void {
    const store = this.resolveStore(storeName)
    const oldValue = store.get(id)
    this.updates.push({
      store,
      id,
      oldValue,
      newValue: update,
      applied: false
    })
  }

  /**
   * Commit the transaction - apply updates and persist
   */
  async commit(persistFn: () => Promise<void>): Promise<void> {
    // Apply all updates to stores
    for (const update of this.updates) {
      // Merge new values with old values (preserve unmodified fields)
      const mergedValue = { ...update.oldValue, ...update.newValue }
      update.store.set(update.id, mergedValue)
      update.applied = true
    }

    // Attempt to persist
    try {
      await persistFn()
    } catch (error) {
      // Hard failure: rollback all changes
      if (isHardFailure(error)) {
        this.rollback()
        throw error
      }
      // Soft failure: keep optimistic state, caller will queue for offline replay
      // Don't throw - let caller handle offline queueing
    }
  }

  /**
   * Rollback all applied updates
   */
  rollback(): void {
    // Reverse order to undo in LIFO fashion
    for (const update of [...this.updates].reverse()) {
      if (update.applied) {
        update.store.set(update.id, update.oldValue)
      }
    }
  }
}
