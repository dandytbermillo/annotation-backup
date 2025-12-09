/**
 * Pinned Entry Manager
 * Part of State Preservation Feature - Phase 1
 *
 * Manages pinned entries that remain mounted when switching between entries.
 * Provides functions to pin/unpin entries and workspaces, with localStorage
 * persistence and configurable limits.
 */

import { debugLog } from '@/lib/utils/debug-logger'
import {
  type PinnedEntry,
  type PinnedEntriesState,
  type PinnedEntriesChangeEvent,
  type PinEntryOptions,
  type PinWorkspaceOptions,
  type PinOperationResult,
  type PinnedEntryLimits,
  PINNED_ENTRIES_STORAGE_KEY,
  DEFAULT_PINNED_LIMITS,
} from './pinned-entry-types'

// ============================================================================
// State
// ============================================================================

let pinnedEntries: PinnedEntry[] = []
let limits: PinnedEntryLimits = { ...DEFAULT_PINNED_LIMITS }
let featureEnabled = false

// Listeners for state changes
const stateListeners = new Set<(state: PinnedEntriesState) => void>()
const changeListeners = new Set<(event: PinnedEntriesChangeEvent) => void>()

// ============================================================================
// Initialization
// ============================================================================

/**
 * Initialize the pinned entry manager
 * Call this on app startup to restore state from localStorage
 */
export function initializePinnedEntryManager(options?: {
  enabled?: boolean
  limits?: Partial<PinnedEntryLimits>
}): void {
  featureEnabled = options?.enabled ?? false

  if (options?.limits) {
    limits = { ...DEFAULT_PINNED_LIMITS, ...options.limits }
  }

  // Restore from localStorage if feature is enabled
  if (featureEnabled && typeof window !== 'undefined') {
    try {
      const stored = localStorage.getItem(PINNED_ENTRIES_STORAGE_KEY)
      if (stored) {
        const parsed = JSON.parse(stored) as { entries?: PinnedEntry[]; limits?: PinnedEntryLimits }
        pinnedEntries = parsed.entries ?? []
        if (parsed.limits) {
          limits = { ...limits, ...parsed.limits }
        }

        void debugLog({
          component: 'PinnedEntryManager',
          action: 'restored_from_storage',
          metadata: {
            entryCount: pinnedEntries.length,
            entries: pinnedEntries.map(e => ({ entryId: e.entryId, workspaceCount: e.pinnedWorkspaceIds.length })),
          },
        })
      }
    } catch (error) {
      console.warn('[PinnedEntryManager] Failed to restore from localStorage:', error)
      pinnedEntries = []
    }
  }

  void debugLog({
    component: 'PinnedEntryManager',
    action: 'initialized',
    metadata: {
      enabled: featureEnabled,
      limits,
      entryCount: pinnedEntries.length,
    },
  })
}

/**
 * Check if the pinned entries feature is enabled
 */
export function isPinnedEntriesEnabled(): boolean {
  return featureEnabled
}

/**
 * Enable or disable the pinned entries feature
 */
export function setPinnedEntriesEnabled(enabled: boolean): void {
  featureEnabled = enabled
  notifyStateListeners()
  persistToStorage()
}

// ============================================================================
// Getters
// ============================================================================

/**
 * Get all pinned entries
 */
export function getPinnedEntries(): PinnedEntry[] {
  return [...pinnedEntries]
}

/**
 * Get current state
 */
export function getPinnedEntriesState(): PinnedEntriesState {
  return {
    entries: [...pinnedEntries],
    limits: { ...limits },
    enabled: featureEnabled,
  }
}

/**
 * Check if an entry is pinned
 */
export function isEntryPinned(entryId: string): boolean {
  return pinnedEntries.some(e => e.entryId === entryId)
}

/**
 * Check if a workspace is pinned within an entry
 */
export function isWorkspacePinned(entryId: string, workspaceId: string): boolean {
  const entry = pinnedEntries.find(e => e.entryId === entryId)
  return entry?.pinnedWorkspaceIds.includes(workspaceId) ?? false
}

/**
 * Get a pinned entry by ID
 */
export function getPinnedEntry(entryId: string): PinnedEntry | null {
  return pinnedEntries.find(e => e.entryId === entryId) ?? null
}

/**
 * Get all pinned workspace IDs for an entry
 */
export function getPinnedWorkspaceIds(entryId: string): string[] {
  const entry = pinnedEntries.find(e => e.entryId === entryId)
  return entry?.pinnedWorkspaceIds ?? []
}

/**
 * Get the current limits
 */
export function getPinnedEntryLimits(): PinnedEntryLimits {
  return { ...limits }
}

// ============================================================================
// Pin/Unpin Operations
// ============================================================================

/**
 * Pin an entry
 * Returns result with success status and any auto-unpinned entries
 */
export function pinEntry(options: PinEntryOptions): PinOperationResult {
  if (!featureEnabled) {
    return { success: false, error: 'Pinned entries feature is not enabled' }
  }

  const { entryId, dashboardWorkspaceId, entryName, entryIcon, initialWorkspaceIds } = options

  // Check if already pinned
  if (isEntryPinned(entryId)) {
    // Update access time
    updateEntryAccessTime(entryId)
    return { success: true }
  }

  const previousState = [...pinnedEntries]
  let autoUnpinnedEntry: PinnedEntry | undefined

  // Check if at limit - auto-unpin oldest if needed
  if (pinnedEntries.length >= limits.maxPinnedEntries) {
    // Find oldest accessed entry
    const oldest = [...pinnedEntries].sort((a, b) => a.lastAccessedAt - b.lastAccessedAt)[0]
    if (oldest) {
      autoUnpinnedEntry = oldest
      pinnedEntries = pinnedEntries.filter(e => e.entryId !== oldest.entryId)

      void debugLog({
        component: 'PinnedEntryManager',
        action: 'auto_unpinned_entry',
        metadata: {
          unpinnedEntryId: oldest.entryId,
          unpinnedEntryName: oldest.entryName,
          reason: 'limit_exceeded',
        },
      })
    }
  }

  // Create new pinned entry
  const now = Date.now()
  const workspaceIds = initialWorkspaceIds?.length
    ? initialWorkspaceIds
    : [dashboardWorkspaceId]

  // Ensure dashboard is always included
  if (!workspaceIds.includes(dashboardWorkspaceId)) {
    workspaceIds.unshift(dashboardWorkspaceId)
  }

  // Enforce per-entry workspace limit
  const limitedWorkspaceIds = workspaceIds.slice(0, limits.maxWorkspacesPerEntry)

  const newEntry: PinnedEntry = {
    entryId,
    dashboardWorkspaceId,
    entryName,
    entryIcon,
    pinnedWorkspaceIds: limitedWorkspaceIds,
    pinnedAt: now,
    lastAccessedAt: now,
  }

  pinnedEntries.push(newEntry)

  void debugLog({
    component: 'PinnedEntryManager',
    action: 'entry_pinned',
    metadata: {
      entryId,
      entryName,
      workspaceCount: limitedWorkspaceIds.length,
      totalPinned: pinnedEntries.length,
    },
  })

  notifyChangeListeners({
    type: 'pin_entry',
    entryId,
    previousState,
    newState: [...pinnedEntries],
    timestamp: now,
  })

  notifyStateListeners()
  persistToStorage()

  return {
    success: true,
    autoUnpinnedEntry,
  }
}

/**
 * Unpin an entry (removes entry and all its pinned workspaces)
 */
export function unpinEntry(entryId: string): PinOperationResult {
  if (!featureEnabled) {
    return { success: false, error: 'Pinned entries feature is not enabled' }
  }

  const previousState = [...pinnedEntries]
  const entry = pinnedEntries.find(e => e.entryId === entryId)

  if (!entry) {
    return { success: false, error: 'Entry is not pinned' }
  }

  pinnedEntries = pinnedEntries.filter(e => e.entryId !== entryId)

  void debugLog({
    component: 'PinnedEntryManager',
    action: 'entry_unpinned',
    metadata: {
      entryId,
      entryName: entry.entryName,
      remainingPinned: pinnedEntries.length,
    },
  })

  notifyChangeListeners({
    type: 'unpin_entry',
    entryId,
    previousState,
    newState: [...pinnedEntries],
    timestamp: Date.now(),
  })

  notifyStateListeners()
  persistToStorage()

  return { success: true }
}

/**
 * Pin a workspace within an already-pinned entry
 */
export function pinWorkspace(options: PinWorkspaceOptions): PinOperationResult {
  if (!featureEnabled) {
    return { success: false, error: 'Pinned entries feature is not enabled' }
  }

  const { entryId, workspaceId } = options
  const entry = pinnedEntries.find(e => e.entryId === entryId)

  if (!entry) {
    return { success: false, error: 'Entry must be pinned first before pinning workspaces' }
  }

  // Check if already pinned
  if (entry.pinnedWorkspaceIds.includes(workspaceId)) {
    return { success: true }
  }

  const previousState = [...pinnedEntries]
  let autoUnpinnedWorkspace: { entryId: string; workspaceId: string } | undefined

  // Check workspace limit - auto-unpin oldest if needed (but never the dashboard)
  if (entry.pinnedWorkspaceIds.length >= limits.maxWorkspacesPerEntry) {
    // Find first non-dashboard workspace to unpin
    const toUnpin = entry.pinnedWorkspaceIds.find(wsId => wsId !== entry.dashboardWorkspaceId)
    if (toUnpin) {
      autoUnpinnedWorkspace = { entryId, workspaceId: toUnpin }
      entry.pinnedWorkspaceIds = entry.pinnedWorkspaceIds.filter(wsId => wsId !== toUnpin)

      void debugLog({
        component: 'PinnedEntryManager',
        action: 'auto_unpinned_workspace',
        metadata: {
          entryId,
          unpinnedWorkspaceId: toUnpin,
          reason: 'limit_exceeded',
        },
      })
    }
  }

  // Add the new workspace
  entry.pinnedWorkspaceIds.push(workspaceId)
  entry.lastAccessedAt = Date.now()

  void debugLog({
    component: 'PinnedEntryManager',
    action: 'workspace_pinned',
    metadata: {
      entryId,
      workspaceId,
      totalWorkspaces: entry.pinnedWorkspaceIds.length,
    },
  })

  notifyChangeListeners({
    type: 'pin_workspace',
    entryId,
    workspaceId,
    previousState,
    newState: [...pinnedEntries],
    timestamp: Date.now(),
  })

  notifyStateListeners()
  persistToStorage()

  return {
    success: true,
    autoUnpinnedWorkspace,
  }
}

/**
 * Unpin a workspace from an entry
 * Note: Cannot unpin the dashboard workspace - unpin the entry instead
 */
export function unpinWorkspace(options: PinWorkspaceOptions): PinOperationResult {
  if (!featureEnabled) {
    return { success: false, error: 'Pinned entries feature is not enabled' }
  }

  const { entryId, workspaceId } = options
  const entry = pinnedEntries.find(e => e.entryId === entryId)

  if (!entry) {
    return { success: false, error: 'Entry is not pinned' }
  }

  // Cannot unpin dashboard - must unpin entry instead
  if (workspaceId === entry.dashboardWorkspaceId) {
    return { success: false, error: 'Cannot unpin dashboard workspace. Unpin the entry instead.' }
  }

  if (!entry.pinnedWorkspaceIds.includes(workspaceId)) {
    return { success: false, error: 'Workspace is not pinned' }
  }

  const previousState = [...pinnedEntries]
  entry.pinnedWorkspaceIds = entry.pinnedWorkspaceIds.filter(wsId => wsId !== workspaceId)
  entry.lastAccessedAt = Date.now()

  void debugLog({
    component: 'PinnedEntryManager',
    action: 'workspace_unpinned',
    metadata: {
      entryId,
      workspaceId,
      remainingWorkspaces: entry.pinnedWorkspaceIds.length,
    },
  })

  notifyChangeListeners({
    type: 'unpin_workspace',
    entryId,
    workspaceId,
    previousState,
    newState: [...pinnedEntries],
    timestamp: Date.now(),
  })

  notifyStateListeners()
  persistToStorage()

  return { success: true }
}

/**
 * Update access time for an entry (called when user views a pinned entry)
 */
export function updateEntryAccessTime(entryId: string): void {
  const entry = pinnedEntries.find(e => e.entryId === entryId)
  if (entry) {
    entry.lastAccessedAt = Date.now()
    persistToStorage()
  }
}

/**
 * Update limits
 */
export function updatePinnedEntryLimits(newLimits: Partial<PinnedEntryLimits>): void {
  limits = { ...limits, ...newLimits }

  // Enforce new limits on existing entries
  enforceCurrentLimits()

  persistToStorage()
  notifyStateListeners()
}

/**
 * Clear all pinned entries
 */
export function clearAllPinnedEntries(): void {
  const previousState = [...pinnedEntries]
  pinnedEntries = []

  void debugLog({
    component: 'PinnedEntryManager',
    action: 'all_entries_cleared',
    metadata: { previousCount: previousState.length },
  })

  notifyStateListeners()
  persistToStorage()
}

// ============================================================================
// Subscriptions
// ============================================================================

/**
 * Subscribe to state changes (receives full state)
 */
export function subscribeToPinnedEntries(
  listener: (state: PinnedEntriesState) => void
): () => void {
  stateListeners.add(listener)
  return () => {
    stateListeners.delete(listener)
  }
}

/**
 * Subscribe to change events (receives detailed change info)
 */
export function subscribeToPinnedEntriesChanges(
  listener: (event: PinnedEntriesChangeEvent) => void
): () => void {
  changeListeners.add(listener)
  return () => {
    changeListeners.delete(listener)
  }
}

// ============================================================================
// Internal Helpers
// ============================================================================

function notifyStateListeners(): void {
  const state = getPinnedEntriesState()

  void debugLog({
    component: 'PinnedEntryManager',
    action: 'notify_state_listeners_start',
    metadata: {
      listenerCount: stateListeners.size,
      entryCount: state.entries.length,
      entryIds: state.entries.map(e => e.entryId),
    },
  })

  let listenerIndex = 0
  stateListeners.forEach(listener => {
    try {
      void debugLog({
        component: 'PinnedEntryManager',
        action: 'calling_state_listener',
        metadata: { listenerIndex },
      })
      listener(state)
      void debugLog({
        component: 'PinnedEntryManager',
        action: 'state_listener_complete',
        metadata: { listenerIndex },
      })
      listenerIndex++
    } catch (error) {
      console.warn('[PinnedEntryManager] State listener error:', error)
      void debugLog({
        component: 'PinnedEntryManager',
        action: 'state_listener_error',
        metadata: { listenerIndex, error: String(error) },
      })
    }
  })

  void debugLog({
    component: 'PinnedEntryManager',
    action: 'notify_state_listeners_complete',
    metadata: { listenerCount: stateListeners.size },
  })
}

function notifyChangeListeners(event: PinnedEntriesChangeEvent): void {
  changeListeners.forEach(listener => {
    try {
      listener(event)
    } catch (error) {
      console.warn('[PinnedEntryManager] Change listener error:', error)
    }
  })
}

function persistToStorage(): void {
  if (typeof window === 'undefined') return

  try {
    const data = {
      entries: pinnedEntries,
      limits,
    }
    localStorage.setItem(PINNED_ENTRIES_STORAGE_KEY, JSON.stringify(data))
  } catch (error) {
    console.warn('[PinnedEntryManager] Failed to persist to localStorage:', error)
  }
}

function enforceCurrentLimits(): void {
  // Enforce entry limit
  while (pinnedEntries.length > limits.maxPinnedEntries) {
    const oldest = [...pinnedEntries].sort((a, b) => a.lastAccessedAt - b.lastAccessedAt)[0]
    if (oldest) {
      pinnedEntries = pinnedEntries.filter(e => e.entryId !== oldest.entryId)
    }
  }

  // Enforce per-entry workspace limit
  for (const entry of pinnedEntries) {
    if (entry.pinnedWorkspaceIds.length > limits.maxWorkspacesPerEntry) {
      // Keep dashboard first, then most recently added
      const dashboard = entry.dashboardWorkspaceId
      const others = entry.pinnedWorkspaceIds.filter(wsId => wsId !== dashboard)
      const kept = others.slice(-(limits.maxWorkspacesPerEntry - 1))
      entry.pinnedWorkspaceIds = [dashboard, ...kept]
    }
  }
}

/**
 * Handle entry deletion - remove from pinned if deleted
 */
export function handleEntryDeleted(entryId: string): void {
  if (isEntryPinned(entryId)) {
    unpinEntry(entryId)
  }
}

/**
 * Handle workspace deletion - remove from pinned if deleted
 */
export function handleWorkspaceDeleted(entryId: string, workspaceId: string): void {
  const entry = pinnedEntries.find(e => e.entryId === entryId)
  if (entry && entry.pinnedWorkspaceIds.includes(workspaceId)) {
    // If it's the dashboard, unpin the whole entry
    if (workspaceId === entry.dashboardWorkspaceId) {
      unpinEntry(entryId)
    } else {
      unpinWorkspace({ entryId, workspaceId })
    }
  }
}
