/**
 * Entry Context State Management
 *
 * Manages the global entry context - which entry (project) the user is currently working in.
 * This is separate from workspace context. The hierarchy is: Entry -> Workspace
 *
 * Usage:
 * - Call setActiveEntryContext(entryId) before switching to a workspace in that entry
 * - Subscribe to changes via subscribeToActiveEntryContext()
 * - Get current entry via getActiveEntryContext()
 */

import type { EntryContextChangeEvent } from './entry-types'
import { onEntryDeactivated } from '@/lib/workspace/runtime-manager'

// Current active entry ID
let activeEntryContext: string | null = null

// Listeners for entry context changes
const entryContextListeners = new Set<(entryId: string | null) => void>()

// Listeners for detailed entry context change events
const entryContextChangeListeners = new Set<(event: EntryContextChangeEvent) => void>()

/**
 * Set the active entry context (which project/entry the user is working in)
 * This should be called before switching workspaces to establish entry scope
 */
export function setActiveEntryContext(entryId: string | null): void {
  if (activeEntryContext === entryId) return

  const previousEntryId = activeEntryContext
  activeEntryContext = entryId

  // Phase 5: Clear component metadata for non-pinned workspaces in the previous entry
  // This prevents zombie background operations (running timers, etc.) when switching entries
  if (previousEntryId) {
    onEntryDeactivated(previousEntryId)
  }

  // Notify simple listeners
  entryContextListeners.forEach((listener) => {
    try {
      listener(activeEntryContext)
    } catch (error) {
      console.warn('[EntryContext] listener error:', error)
    }
  })

  // Notify detailed change listeners
  const event: EntryContextChangeEvent = {
    previousEntryId,
    currentEntryId: activeEntryContext,
    timestamp: Date.now(),
  }
  entryContextChangeListeners.forEach((listener) => {
    try {
      listener(event)
    } catch (error) {
      console.warn('[EntryContext] change listener error:', error)
    }
  })
}

/**
 * Get the currently active entry context
 */
export function getActiveEntryContext(): string | null {
  return activeEntryContext
}

/**
 * Subscribe to entry context changes (simple - just receives the new entryId)
 * Returns an unsubscribe function
 */
export function subscribeToActiveEntryContext(
  listener: (entryId: string | null) => void
): () => void {
  entryContextListeners.add(listener)
  return () => {
    entryContextListeners.delete(listener)
  }
}

/**
 * Subscribe to detailed entry context change events
 * Returns an unsubscribe function
 */
export function subscribeToEntryContextChange(
  listener: (event: EntryContextChangeEvent) => void
): () => void {
  entryContextChangeListeners.add(listener)
  return () => {
    entryContextChangeListeners.delete(listener)
  }
}

/**
 * Clear all entry context state (useful for testing or logout)
 */
export function clearEntryContext(): void {
  activeEntryContext = null
  // Don't clear listeners - they should manage their own lifecycle
}
