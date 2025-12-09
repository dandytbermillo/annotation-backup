/**
 * React Hooks for Pinned Entries
 * Part of State Preservation Feature - Phase 1
 *
 * Provides React hooks for consuming and managing pinned entries state.
 */

'use client'

import { useState, useEffect, useCallback, useMemo } from 'react'
import {
  getPinnedEntriesState,
  subscribeToPinnedEntries,
  subscribeToPinnedEntriesChanges,
  pinEntry,
  unpinEntry,
  pinWorkspace,
  unpinWorkspace,
  isEntryPinned,
  isWorkspacePinned,
  getPinnedEntry,
  getPinnedWorkspaceIds,
  updateEntryAccessTime,
  isPinnedEntriesEnabled,
} from './pinned-entry-manager'
import type {
  PinnedEntriesState,
  PinnedEntriesChangeEvent,
  PinnedEntry,
  PinEntryOptions,
  PinWorkspaceOptions,
  PinOperationResult,
} from './pinned-entry-types'

/**
 * Hook to get the full pinned entries state with live updates
 */
export function usePinnedEntriesState(): PinnedEntriesState {
  const [state, setState] = useState<PinnedEntriesState>(getPinnedEntriesState)

  useEffect(() => {
    // Get initial state
    setState(getPinnedEntriesState())

    // Subscribe to updates
    const unsubscribe = subscribeToPinnedEntries((newState) => {
      setState(newState)
    })

    return unsubscribe
  }, [])

  return state
}

/**
 * Hook to check if a specific entry is pinned
 */
export function useIsEntryPinned(entryId: string | null | undefined): boolean {
  const [isPinned, setIsPinned] = useState(() =>
    entryId ? isEntryPinned(entryId) : false
  )

  useEffect(() => {
    if (!entryId) {
      setIsPinned(false)
      return
    }

    // Get initial value
    setIsPinned(isEntryPinned(entryId))

    // Subscribe to updates
    const unsubscribe = subscribeToPinnedEntries(() => {
      setIsPinned(isEntryPinned(entryId))
    })

    return unsubscribe
  }, [entryId])

  return isPinned
}

/**
 * Hook to check if a specific workspace is pinned within an entry
 */
export function useIsWorkspacePinned(
  entryId: string | null | undefined,
  workspaceId: string | null | undefined
): boolean {
  const [isPinned, setIsPinned] = useState(() =>
    entryId && workspaceId ? isWorkspacePinned(entryId, workspaceId) : false
  )

  useEffect(() => {
    if (!entryId || !workspaceId) {
      setIsPinned(false)
      return
    }

    // Get initial value
    setIsPinned(isWorkspacePinned(entryId, workspaceId))

    // Subscribe to updates
    const unsubscribe = subscribeToPinnedEntries(() => {
      setIsPinned(isWorkspacePinned(entryId, workspaceId))
    })

    return unsubscribe
  }, [entryId, workspaceId])

  return isPinned
}

/**
 * Hook to get a specific pinned entry
 */
export function usePinnedEntry(entryId: string | null | undefined): PinnedEntry | null {
  const [entry, setEntry] = useState<PinnedEntry | null>(() =>
    entryId ? getPinnedEntry(entryId) : null
  )

  useEffect(() => {
    if (!entryId) {
      setEntry(null)
      return
    }

    // Get initial value
    setEntry(getPinnedEntry(entryId))

    // Subscribe to updates
    const unsubscribe = subscribeToPinnedEntries(() => {
      setEntry(getPinnedEntry(entryId))
    })

    return unsubscribe
  }, [entryId])

  return entry
}

/**
 * Hook to get pinned workspace IDs for an entry
 */
export function usePinnedWorkspaceIds(entryId: string | null | undefined): string[] {
  const [workspaceIds, setWorkspaceIds] = useState<string[]>(() =>
    entryId ? getPinnedWorkspaceIds(entryId) : []
  )

  useEffect(() => {
    if (!entryId) {
      setWorkspaceIds([])
      return
    }

    // Get initial value
    setWorkspaceIds(getPinnedWorkspaceIds(entryId))

    // Subscribe to updates
    const unsubscribe = subscribeToPinnedEntries(() => {
      setWorkspaceIds(getPinnedWorkspaceIds(entryId))
    })

    return unsubscribe
  }, [entryId])

  return workspaceIds
}

/**
 * Hook for pin/unpin change events (useful for showing toasts)
 */
export function usePinnedEntriesChanges(
  onEvent: (event: PinnedEntriesChangeEvent) => void
): void {
  useEffect(() => {
    const unsubscribe = subscribeToPinnedEntriesChanges(onEvent)
    return unsubscribe
  }, [onEvent])
}

/**
 * Hook providing pin/unpin actions for an entry
 */
export function useEntryPinActions(entryId: string | null | undefined) {
  const isPinned = useIsEntryPinned(entryId)
  const enabled = isPinnedEntriesEnabled()

  const pin = useCallback(
    (options: Omit<PinEntryOptions, 'entryId'>): PinOperationResult => {
      if (!entryId) {
        return { success: false, error: 'No entry ID provided' }
      }
      return pinEntry({ ...options, entryId })
    },
    [entryId]
  )

  const unpin = useCallback((): PinOperationResult => {
    if (!entryId) {
      return { success: false, error: 'No entry ID provided' }
    }
    return unpinEntry(entryId)
  }, [entryId])

  const toggle = useCallback(
    (options: Omit<PinEntryOptions, 'entryId'>): PinOperationResult => {
      if (!entryId) {
        return { success: false, error: 'No entry ID provided' }
      }
      if (isPinned) {
        return unpinEntry(entryId)
      }
      return pinEntry({ ...options, entryId })
    },
    [entryId, isPinned]
  )

  const markAccessed = useCallback(() => {
    if (entryId) {
      updateEntryAccessTime(entryId)
    }
  }, [entryId])

  return useMemo(
    () => ({
      isPinned,
      enabled,
      pin,
      unpin,
      toggle,
      markAccessed,
    }),
    [isPinned, enabled, pin, unpin, toggle, markAccessed]
  )
}

/**
 * Hook providing pin/unpin actions for a workspace within an entry
 */
export function useWorkspacePinActions(
  entryId: string | null | undefined,
  workspaceId: string | null | undefined
) {
  const isPinned = useIsWorkspacePinned(entryId, workspaceId)
  const isEntryPinnedValue = useIsEntryPinned(entryId)
  const enabled = isPinnedEntriesEnabled()

  const pin = useCallback((): PinOperationResult => {
    if (!entryId || !workspaceId) {
      return { success: false, error: 'No entry or workspace ID provided' }
    }
    return pinWorkspace({ entryId, workspaceId })
  }, [entryId, workspaceId])

  const unpin = useCallback((): PinOperationResult => {
    if (!entryId || !workspaceId) {
      return { success: false, error: 'No entry or workspace ID provided' }
    }
    return unpinWorkspace({ entryId, workspaceId })
  }, [entryId, workspaceId])

  const toggle = useCallback((): PinOperationResult => {
    if (!entryId || !workspaceId) {
      return { success: false, error: 'No entry or workspace ID provided' }
    }
    if (isPinned) {
      return unpinWorkspace({ entryId, workspaceId })
    }
    return pinWorkspace({ entryId, workspaceId })
  }, [entryId, workspaceId, isPinned])

  return useMemo(
    () => ({
      isPinned,
      isEntryPinned: isEntryPinnedValue,
      enabled,
      canPin: isEntryPinnedValue && !isPinned, // Can only pin workspace if entry is pinned
      pin,
      unpin,
      toggle,
    }),
    [isPinned, isEntryPinnedValue, enabled, pin, unpin, toggle]
  )
}

/**
 * Hook to get all pinned entries with their data
 */
export function usePinnedEntries(): PinnedEntry[] {
  const state = usePinnedEntriesState()
  return state.entries
}

/**
 * Hook to check if feature is enabled
 */
export function useIsPinnedEntriesEnabled(): boolean {
  const state = usePinnedEntriesState()
  return state.enabled
}
