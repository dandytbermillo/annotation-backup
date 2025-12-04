/**
 * useEntryContext Hook
 *
 * React hook for managing entry context in the entry/workspace hierarchy.
 * Provides current entry state, entry switching, and workspace filtering by entry.
 *
 * Usage:
 * ```tsx
 * const {
 *   currentEntryId,
 *   setCurrentEntryId,
 *   workspacesForCurrentEntry,
 *   isLoadingWorkspaces,
 *   refreshWorkspaces,
 * } = useEntryContext()
 * ```
 */

import { useState, useEffect, useCallback, useRef } from 'react'
import {
  getActiveEntryContext,
  setActiveEntryContext,
  subscribeToActiveEntryContext,
} from '@/lib/entry/entry-context'
import {
  fetchWorkspacesForEntry,
  createWorkspaceForEntry,
  createEntryForWorkspace,
  seedEntryDashboard,
} from '@/lib/entry/entry-service'
import type { EntryWorkspaceSummary, CreateEntryResult } from '@/lib/entry/entry-types'
import { debugLog } from '@/lib/utils/debug-logger'

export type UseEntryContextOptions = {
  /** Whether to auto-fetch workspaces when entry changes */
  autoFetchWorkspaces?: boolean
  /** Debug logging */
  enableDebugLog?: boolean
}

export type UseEntryContextResult = {
  /** Currently active entry ID */
  currentEntryId: string | null
  /** Set the current entry (updates global context) */
  setCurrentEntryId: (entryId: string | null) => void
  /** Workspaces belonging to the current entry */
  workspacesForCurrentEntry: EntryWorkspaceSummary[]
  /** Whether workspaces are being loaded */
  isLoadingWorkspaces: boolean
  /** Error from last workspace fetch */
  workspacesError: string | null
  /** Refresh workspaces for current entry */
  refreshWorkspaces: () => Promise<void>
  /** Create a new workspace under current entry */
  createWorkspace: (name: string) => Promise<{ id: string; name: string } | null>
  /** Create entry for a legacy workspace (no entry association) */
  createEntryForLegacyWorkspace: (
    workspaceId: string,
    workspaceName: string
  ) => Promise<CreateEntryResult | null>
  /** Seed dashboard panels for an entry */
  seedDashboard: (entryId: string) => Promise<boolean>
}

export function useEntryContext(
  options: UseEntryContextOptions = {}
): UseEntryContextResult {
  const { autoFetchWorkspaces = true, enableDebugLog = false } = options

  // State
  const [currentEntryId, setCurrentEntryIdState] = useState<string | null>(
    () => getActiveEntryContext()
  )
  const [workspaces, setWorkspaces] = useState<EntryWorkspaceSummary[]>([])
  const [isLoadingWorkspaces, setIsLoadingWorkspaces] = useState(false)
  const [workspacesError, setWorkspacesError] = useState<string | null>(null)

  // Refs for tracking
  const lastFetchedEntryIdRef = useRef<string | null>(null)
  const isMountedRef = useRef(true)

  // Debug logging helper
  const emitDebugLog = useCallback(
    (action: string, metadata?: Record<string, unknown>) => {
      if (!enableDebugLog) return
      void debugLog({
        component: 'EntryContext',
        action,
        metadata,
      })
    },
    [enableDebugLog]
  )

  // Set current entry ID (updates global context)
  const setCurrentEntryId = useCallback(
    (entryId: string | null) => {
      emitDebugLog('set_entry_context', { entryId })
      setActiveEntryContext(entryId)
      // State will update via subscription
    },
    [emitDebugLog]
  )

  // Subscribe to global entry context changes
  useEffect(() => {
    const handleEntryChange = (entryId: string | null) => {
      if (!isMountedRef.current) return
      emitDebugLog('entry_context_changed', { entryId })
      setCurrentEntryIdState(entryId)
    }

    const unsubscribe = subscribeToActiveEntryContext(handleEntryChange)
    return () => {
      unsubscribe()
    }
  }, [emitDebugLog])

  // Fetch workspaces for entry
  const fetchWorkspaces = useCallback(
    async (entryId: string | null) => {
      if (!entryId) {
        setWorkspaces([])
        setWorkspacesError(null)
        lastFetchedEntryIdRef.current = null
        return
      }

      // Skip if already fetched for this entry
      if (lastFetchedEntryIdRef.current === entryId) {
        return
      }

      setIsLoadingWorkspaces(true)
      setWorkspacesError(null)

      try {
        emitDebugLog('fetching_workspaces', { entryId })
        const result = await fetchWorkspacesForEntry(entryId)

        if (!isMountedRef.current) return

        setWorkspaces(result)
        lastFetchedEntryIdRef.current = entryId
        emitDebugLog('workspaces_fetched', { entryId, count: result.length })
      } catch (error) {
        if (!isMountedRef.current) return

        const message = error instanceof Error ? error.message : 'Failed to fetch workspaces'
        setWorkspacesError(message)
        emitDebugLog('workspaces_fetch_error', { entryId, error: message })
      } finally {
        if (isMountedRef.current) {
          setIsLoadingWorkspaces(false)
        }
      }
    },
    [emitDebugLog]
  )

  // Auto-fetch workspaces when entry changes
  useEffect(() => {
    if (!autoFetchWorkspaces) return
    void fetchWorkspaces(currentEntryId)
  }, [currentEntryId, autoFetchWorkspaces, fetchWorkspaces])

  // Cleanup on unmount
  useEffect(() => {
    isMountedRef.current = true
    return () => {
      isMountedRef.current = false
    }
  }, [])

  // Refresh workspaces (force re-fetch)
  const refreshWorkspaces = useCallback(async () => {
    lastFetchedEntryIdRef.current = null
    await fetchWorkspaces(currentEntryId)
  }, [currentEntryId, fetchWorkspaces])

  // Create workspace under current entry
  const createWorkspace = useCallback(
    async (name: string): Promise<{ id: string; name: string } | null> => {
      if (!currentEntryId) {
        emitDebugLog('create_workspace_no_entry', { name })
        return null
      }

      try {
        emitDebugLog('creating_workspace', { entryId: currentEntryId, name })
        const result = await createWorkspaceForEntry(currentEntryId, name)

        // Refresh workspace list
        await refreshWorkspaces()

        emitDebugLog('workspace_created', { entryId: currentEntryId, workspaceId: result.id })
        return result
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Failed to create workspace'
        emitDebugLog('create_workspace_error', { entryId: currentEntryId, name, error: message })
        return null
      }
    },
    [currentEntryId, refreshWorkspaces, emitDebugLog]
  )

  // Create entry for legacy workspace
  const createEntryForLegacyWorkspace = useCallback(
    async (
      workspaceId: string,
      workspaceName: string
    ): Promise<CreateEntryResult | null> => {
      try {
        emitDebugLog('creating_entry_for_workspace', { workspaceId, workspaceName })
        const result = await createEntryForWorkspace(workspaceId, workspaceName)
        emitDebugLog('entry_created_for_workspace', {
          workspaceId,
          entryId: result.entry.id,
        })
        return result
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Failed to create entry'
        emitDebugLog('create_entry_error', { workspaceId, error: message })
        return null
      }
    },
    [emitDebugLog]
  )

  // Seed dashboard for entry
  const seedDashboard = useCallback(
    async (entryId: string): Promise<boolean> => {
      try {
        emitDebugLog('seeding_dashboard', { entryId })
        await seedEntryDashboard(entryId)
        emitDebugLog('dashboard_seeded', { entryId })
        return true
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Failed to seed dashboard'
        emitDebugLog('seed_dashboard_error', { entryId, error: message })
        return false
      }
    },
    [emitDebugLog]
  )

  return {
    currentEntryId,
    setCurrentEntryId,
    workspacesForCurrentEntry: workspaces,
    isLoadingWorkspaces,
    workspacesError,
    refreshWorkspaces,
    createWorkspace,
    createEntryForLegacyWorkspace,
    seedDashboard,
  }
}
