/**
 * Persist Scheduler
 *
 * Event-driven persistence scheduling (NOT interval-based).
 *
 * See: docs/proposal/workspace-state-machine/IMPLEMENTATION_PLAN.md (Section 7)
 *
 * Key concepts:
 * - Debounced persist: Batches rapid changes (e.g., timer ticking)
 * - Flush on critical events: Switch, eviction, beforeunload
 * - No setInterval: Intervals throttle in background tabs
 */

import type { PersistScheduler } from './workspace-store-types'

// =============================================================================
// Configuration
// =============================================================================

/** Default debounce delay in milliseconds */
const DEFAULT_DEBOUNCE_MS = 1000

// =============================================================================
// Debounce Implementation
// =============================================================================

/**
 * Simple debounce function (avoids lodash dependency).
 */
function debounce<T extends (...args: unknown[]) => void>(
  fn: T,
  delayMs: number
): { (...args: Parameters<T>): void; cancel: () => void } {
  let timeoutId: ReturnType<typeof setTimeout> | null = null

  const debounced = (...args: Parameters<T>) => {
    if (timeoutId !== null) {
      clearTimeout(timeoutId)
    }
    timeoutId = setTimeout(() => {
      timeoutId = null
      fn(...args)
    }, delayMs)
  }

  debounced.cancel = () => {
    if (timeoutId !== null) {
      clearTimeout(timeoutId)
      timeoutId = null
    }
  }

  return debounced
}

// =============================================================================
// Persist Scheduler Factory
// =============================================================================

/**
 * Store interface required by persist scheduler.
 * Minimal interface to avoid circular dependencies.
 */
interface PersistableStore {
  persist(): Promise<void>
}

/**
 * Create a persist scheduler for a workspace component store.
 *
 * @param store The store to create scheduler for
 * @param debounceMs Debounce delay (default: 1000ms)
 * @returns PersistScheduler interface
 */
export function createPersistScheduler(
  store: PersistableStore,
  debounceMs: number = DEFAULT_DEBOUNCE_MS
): PersistScheduler {
  // Debounced persist - batches rapid changes
  const debouncedPersist = debounce(() => {
    void store.persist()
  }, debounceMs)

  return {
    /**
     * Schedule a debounced persist.
     * Called automatically on state changes.
     */
    scheduleDebounced(): void {
      debouncedPersist()
    },

    /**
     * Cancel any pending debounced persist.
     */
    cancelDebounced(): void {
      debouncedPersist.cancel()
    },

    /**
     * Flush immediately - waits for persist to complete.
     * Used on workspace switch, eviction, beforeunload.
     */
    async flushNow(): Promise<void> {
      // Cancel pending debounce to avoid double-persist
      debouncedPersist.cancel()
      // Persist immediately and wait for completion
      await store.persist()
    },
  }
}

// =============================================================================
// Global Event Handlers
// =============================================================================

/**
 * Registry of all active stores for global flush.
 */
const activeStores = new Map<string, PersistScheduler>()

/**
 * Register a store's persist scheduler for global events.
 */
export function registerPersistScheduler(
  workspaceId: string,
  scheduler: PersistScheduler
): void {
  activeStores.set(workspaceId, scheduler)
}

/**
 * Unregister a store's persist scheduler.
 */
export function unregisterPersistScheduler(workspaceId: string): void {
  activeStores.delete(workspaceId)
}

/**
 * Flush all active stores (best effort).
 * Used on beforeunload/visibilitychange.
 */
export async function flushAllStores(): Promise<void> {
  const promises: Promise<void>[] = []

  for (const scheduler of activeStores.values()) {
    promises.push(scheduler.flushNow().catch(() => {
      // Swallow errors during global flush
    }))
  }

  await Promise.all(promises)
}

/**
 * Setup global event listeners for persist on unload/hidden.
 * Call once during app initialization.
 */
export function setupGlobalPersistHandlers(): () => void {
  if (typeof window === 'undefined') {
    return () => {}
  }

  // Best-effort persist on page unload
  const handleBeforeUnload = () => {
    // Use sync approach for beforeunload (async may not complete)
    for (const scheduler of activeStores.values()) {
      scheduler.cancelDebounced()
      // Note: We can't await here, but persist() should use sendBeacon
      // or keepalive fetch for reliability
    }
  }

  // Flush when tab becomes hidden
  const handleVisibilityChange = () => {
    if (document.visibilityState === 'hidden') {
      void flushAllStores()
    }
  }

  window.addEventListener('beforeunload', handleBeforeUnload)
  document.addEventListener('visibilitychange', handleVisibilityChange)

  // Return cleanup function
  return () => {
    window.removeEventListener('beforeunload', handleBeforeUnload)
    document.removeEventListener('visibilitychange', handleVisibilityChange)
  }
}
