/**
 * Chat Navigation Hook
 *
 * Provides action handlers for chat navigation intents.
 * Executes navigation based on resolution results from the chat API.
 *
 * Phase 3: Action Execution Layer
 */

'use client'

import { useCallback } from 'react'
import { setActiveEntryContext } from '@/lib/entry/entry-context'
import { setActiveWorkspaceContext, requestWorkspaceListRefresh } from '@/lib/note-workspaces/state'
import type { IntentResolutionResult } from './intent-resolver'
import type { WorkspaceMatch, NoteMatch } from './resolution-types'

// =============================================================================
// Types
// =============================================================================

export interface ChatNavigationResult {
  success: boolean
  message: string
  action?: 'navigated' | 'created' | 'selected' | 'renamed' | 'deleted' | 'listed' | 'informed' | 'error'
}

export interface UseChatNavigationOptions {
  /** Called when navigation completes successfully */
  onNavigationComplete?: (result: ChatNavigationResult) => void
  /** Called when an error occurs */
  onError?: (error: Error) => void
  /** Current entry ID for context */
  currentEntryId?: string
  /** Current workspace ID for context */
  currentWorkspaceId?: string
}

// =============================================================================
// Hook
// =============================================================================

/**
 * Hook for executing chat navigation actions.
 *
 * Usage:
 * ```tsx
 * const { executeAction, navigateToWorkspace, navigateToNote, createWorkspace } = useChatNavigation({
 *   onNavigationComplete: (result) => console.log('Navigated:', result),
 * })
 *
 * // Execute based on API response
 * await executeAction(resolution)
 *
 * // Or execute specific actions
 * await navigateToWorkspace(workspaceMatch)
 * await navigateToNote(noteMatch)
 * ```
 */
export function useChatNavigation(options: UseChatNavigationOptions = {}) {
  const { onNavigationComplete, onError } = options

  // ---------------------------------------------------------------------------
  // Navigate to Workspace
  // ---------------------------------------------------------------------------

  const navigateToWorkspace = useCallback(
    async (workspace: WorkspaceMatch): Promise<ChatNavigationResult> => {
      try {
        // Step 1: Set entry context (must come first)
        if (workspace.entryId) {
          setActiveEntryContext(workspace.entryId)
        }

        // Step 2: Set workspace context (for other consumers)
        setActiveWorkspaceContext(workspace.id)

        // Step 3: Dispatch event for DashboardView to switch view mode
        // This handles the case where workspace context is already set to this workspace
        // (setActiveWorkspaceContext early-returns on same value, so subscription won't fire)
        if (typeof window !== 'undefined') {
          window.dispatchEvent(new CustomEvent('chat-navigate-workspace', {
            detail: { workspaceId: workspace.id, workspaceName: workspace.name },
          }))
        }

        const result: ChatNavigationResult = {
          success: true,
          message: `Opened workspace "${workspace.name}"`,
          action: 'navigated',
        }

        onNavigationComplete?.(result)
        return result
      } catch (error) {
        const err = error instanceof Error ? error : new Error(String(error))
        onError?.(err)
        return {
          success: false,
          message: `Failed to navigate: ${err.message}`,
          action: 'error',
        }
      }
    },
    [onNavigationComplete, onError]
  )

  // ---------------------------------------------------------------------------
  // Navigate to Note
  // ---------------------------------------------------------------------------

  const navigateToNote = useCallback(
    async (note: NoteMatch): Promise<ChatNavigationResult> => {
      try {
        // Step 1: Set entry context if available
        if (note.entryId) {
          setActiveEntryContext(note.entryId)
        }

        // Step 2: Set workspace context if available
        if (note.workspaceId) {
          setActiveWorkspaceContext(note.workspaceId)
        }

        // Step 3: Opening the note in the canvas requires the canvas workspace context
        // This will be handled by the UI component that renders the canvas
        // We signal the navigation intent here by setting the context

        // For now, we dispatch a custom event that the canvas can listen to
        // This decouples the chat from the canvas implementation
        const event = new CustomEvent('chat-navigate-note', {
          detail: {
            noteId: note.id,
            workspaceId: note.workspaceId,
            entryId: note.entryId,
          },
        })
        window.dispatchEvent(event)

        const result: ChatNavigationResult = {
          success: true,
          message: `Opened note "${note.title}"`,
          action: 'navigated',
        }

        onNavigationComplete?.(result)
        return result
      } catch (error) {
        const err = error instanceof Error ? error : new Error(String(error))
        onError?.(err)
        return {
          success: false,
          message: `Failed to navigate: ${err.message}`,
          action: 'error',
        }
      }
    },
    [onNavigationComplete, onError]
  )

  // ---------------------------------------------------------------------------
  // Create Workspace
  // ---------------------------------------------------------------------------

  const createWorkspace = useCallback(
    async (name: string, entryId: string): Promise<ChatNavigationResult> => {
      try {
        // Call API to create workspace
        const response = await fetch('/api/note-workspaces', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            name,
            itemId: entryId, // note_workspaces.item_id is the entry
          }),
        })

        if (!response.ok) {
          const error = await response.json()
          throw new Error(error.message || 'Failed to create workspace')
        }

        const { workspace } = await response.json()

        // Refresh workspace list
        requestWorkspaceListRefresh()

        // Navigate to the new workspace
        setActiveEntryContext(entryId)
        setActiveWorkspaceContext(workspace.id)

        const result: ChatNavigationResult = {
          success: true,
          message: `Created and opened workspace "${name}"`,
          action: 'created',
        }

        onNavigationComplete?.(result)
        return result
      } catch (error) {
        const err = error instanceof Error ? error : new Error(String(error))
        onError?.(err)
        return {
          success: false,
          message: `Failed to create workspace: ${err.message}`,
          action: 'error',
        }
      }
    },
    [onNavigationComplete, onError]
  )

  // ---------------------------------------------------------------------------
  // Go to Dashboard
  // ---------------------------------------------------------------------------

  const goToDashboard = useCallback(
    async (entryId?: string): Promise<ChatNavigationResult> => {
      try {
        // Keep entry context but clear workspace context
        // This navigates to the "dashboard" view of the entry
        if (entryId) {
          setActiveEntryContext(entryId)
        }

        // Dispatch event to signal dashboard navigation
        // DashboardView listens for this and calls handleReturnToDashboard
        if (typeof window !== 'undefined') {
          window.dispatchEvent(new CustomEvent('chat-navigate-dashboard', {
            detail: { entryId },
          }))
        }

        const result: ChatNavigationResult = {
          success: true,
          message: 'Returned to dashboard',
          action: 'navigated',
        }

        onNavigationComplete?.(result)
        return result
      } catch (error) {
        const err = error instanceof Error ? error : new Error(String(error))
        onError?.(err)
        return {
          success: false,
          message: `Failed to navigate: ${err.message}`,
          action: 'error',
        }
      }
    },
    [onNavigationComplete, onError]
  )

  // ---------------------------------------------------------------------------
  // Go Home (navigate to Home entry's dashboard)
  // ---------------------------------------------------------------------------

  const goHome = useCallback(
    async (): Promise<ChatNavigationResult> => {
      try {
        // Fetch the Home entry info from the dashboard API
        const response = await fetch('/api/dashboard/info')
        if (!response.ok) {
          throw new Error('Failed to fetch Home entry info')
        }
        const { homeEntryId, dashboardWorkspaceId } = await response.json()

        if (!homeEntryId || !dashboardWorkspaceId) {
          throw new Error('Home entry not found')
        }

        // Dispatch chat-navigate-entry event to navigate to Home entry's dashboard
        // DashboardInitializer listens for this event
        if (typeof window !== 'undefined') {
          window.dispatchEvent(new CustomEvent('chat-navigate-entry', {
            detail: {
              entryId: homeEntryId,
              dashboardId: dashboardWorkspaceId,
            },
          }))
        }

        const result: ChatNavigationResult = {
          success: true,
          message: 'Going home...',
          action: 'navigated',
        }

        onNavigationComplete?.(result)
        return result
      } catch (error) {
        const err = error instanceof Error ? error : new Error(String(error))
        onError?.(err)
        return {
          success: false,
          message: `Failed to navigate home: ${err.message}`,
          action: 'error',
        }
      }
    },
    [onNavigationComplete, onError]
  )

  // ---------------------------------------------------------------------------
  // Rename Workspace
  // ---------------------------------------------------------------------------

  const renameWorkspace = useCallback(
    async (workspaceId: string, oldName: string, newName: string): Promise<ChatNavigationResult> => {
      try {
        // First, get the workspace to retrieve its current revision
        const getResponse = await fetch(`/api/note-workspaces/${workspaceId}`)
        if (!getResponse.ok) {
          throw new Error('Failed to fetch workspace for rename')
        }
        const { workspace } = await getResponse.json()

        // Now rename with the revision
        const patchResponse = await fetch(`/api/note-workspaces/${workspaceId}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            name: newName,
            revision: workspace.revision,
            payload: workspace.payload || { openNotes: [] },
          }),
        })

        if (!patchResponse.ok) {
          const error = await patchResponse.json().catch(() => ({ error: 'Failed to rename workspace' }))
          throw new Error(error.error || 'Failed to rename workspace')
        }

        // Refresh workspace list
        requestWorkspaceListRefresh()

        const result: ChatNavigationResult = {
          success: true,
          message: `Renamed workspace "${oldName}" to "${newName}"`,
          action: 'renamed',
        }

        onNavigationComplete?.(result)
        return result
      } catch (error) {
        const err = error instanceof Error ? error : new Error(String(error))
        onError?.(err)
        return {
          success: false,
          message: `Failed to rename workspace: ${err.message}`,
          action: 'error',
        }
      }
    },
    [onNavigationComplete, onError]
  )

  // ---------------------------------------------------------------------------
  // Delete Workspace
  // ---------------------------------------------------------------------------

  const deleteWorkspace = useCallback(
    async (workspaceId: string, workspaceName: string): Promise<ChatNavigationResult> => {
      try {
        // Call API to delete workspace
        const response = await fetch(`/api/note-workspaces/${workspaceId}`, {
          method: 'DELETE',
        })

        if (!response.ok) {
          const error = await response.json().catch(() => ({ error: 'Failed to delete workspace' }))
          throw new Error(error.error || 'Failed to delete workspace')
        }

        // Refresh workspace list
        requestWorkspaceListRefresh()

        const result: ChatNavigationResult = {
          success: true,
          message: `Deleted workspace "${workspaceName}"`,
          action: 'deleted',
        }

        onNavigationComplete?.(result)
        return result
      } catch (error) {
        const err = error instanceof Error ? error : new Error(String(error))
        onError?.(err)
        return {
          success: false,
          message: `Failed to delete workspace: ${err.message}`,
          action: 'error',
        }
      }
    },
    [onNavigationComplete, onError]
  )

  // ---------------------------------------------------------------------------
  // Execute Action (from resolution result)
  // ---------------------------------------------------------------------------

  const executeAction = useCallback(
    async (resolution: IntentResolutionResult): Promise<ChatNavigationResult> => {
      if (!resolution.success) {
        return {
          success: false,
          message: resolution.message,
          action: 'error',
        }
      }

      switch (resolution.action) {
        case 'navigate_workspace':
          if (resolution.workspace) {
            return navigateToWorkspace(resolution.workspace)
          }
          return {
            success: false,
            message: 'No workspace to navigate to',
            action: 'error',
          }

        case 'navigate_note':
          if (resolution.note) {
            return navigateToNote({
              id: resolution.note.id,
              title: resolution.note.title,
              noteId: resolution.note.id,
              workspaceId: resolution.note.workspaceId,
              workspaceName: resolution.note.workspaceName,
              entryId: resolution.note.entryId,
              entryName: resolution.note.entryName,
            })
          }
          return {
            success: false,
            message: 'No note to navigate to',
            action: 'error',
          }

        case 'create_workspace':
          if (resolution.newWorkspace) {
            if (!resolution.newWorkspace.name) {
              // Name not provided - return for UI to prompt
              return {
                success: true,
                message: resolution.message,
                action: 'selected', // Needs user input
              }
            }
            return createWorkspace(
              resolution.newWorkspace.name,
              resolution.newWorkspace.entryId
            )
          }
          return {
            success: false,
            message: 'No workspace details to create',
            action: 'error',
          }

        case 'select':
          // Multiple options - return for UI to display selection
          return {
            success: true,
            message: resolution.message,
            action: 'selected',
          }

        // Phase 1: Workspace Operations
        case 'navigate_dashboard':
          return goToDashboard()

        case 'navigate_home':
          return goHome()

        case 'list_workspaces':
          // Workspace list is provided as options - return for UI to display as pills
          // Use 'selected' action so the UI renders the options as clickable pills
          return {
            success: true,
            message: resolution.message,
            action: 'selected',
          }

        case 'rename_workspace':
          // Rename was already performed by the resolver
          // Refresh workspace list so UI shows the new name
          requestWorkspaceListRefresh()
          return {
            success: true,
            message: resolution.message,
            action: 'renamed',
          }

        case 'confirm_delete':
          // Delete confirmation - return for UI to display confirmation pill
          return {
            success: true,
            message: resolution.message,
            action: 'selected', // Shows the confirmation pill
          }

        case 'delete_workspace':
          // Delete was confirmed and executed by resolver (not used directly)
          // This case is for completeness
          return {
            success: true,
            message: resolution.message,
            action: 'deleted',
          }

        // Phase 2: Informational Intents
        case 'inform':
          // Informational response - just display the message, no navigation
          return {
            success: true,
            message: resolution.message,
            action: 'informed',
          }

        case 'error':
        default:
          return {
            success: false,
            message: resolution.message,
            action: 'error',
          }
      }
    },
    [navigateToWorkspace, navigateToNote, createWorkspace, goToDashboard, goHome]
  )

  // ---------------------------------------------------------------------------
  // Select Option (from selection pills)
  // ---------------------------------------------------------------------------

  const selectOption = useCallback(
    async (option: {
      type: 'workspace' | 'note' | 'confirm_delete' | 'quick_links_panel'
      id: string
      data: WorkspaceMatch | NoteMatch | (WorkspaceMatch & { pendingDelete?: boolean; pendingNewName?: string }) | { panelId: string; badge: string; panelType: 'quick_links' }
    }): Promise<ChatNavigationResult> => {
      switch (option.type) {
        case 'workspace':
          // Check if this is a pending operation (disambiguation step)
          const workspaceData = option.data as WorkspaceMatch & { pendingDelete?: boolean; pendingNewName?: string }

          // Handle pending rename (from rename disambiguation)
          if (workspaceData.pendingNewName) {
            return renameWorkspace(workspaceData.id, workspaceData.name, workspaceData.pendingNewName)
          }

          // Handle pending delete (from delete disambiguation)
          if (workspaceData.pendingDelete) {
            // Return a result that signals the UI should show delete confirmation
            // The UI will need to show a new message with the confirmation pill
            return {
              success: true,
              message: `Are you sure you want to permanently delete workspace "${workspaceData.name}"?`,
              action: 'selected', // Triggers showing the confirmation pill
            }
          }

          // Default: navigate to workspace
          return navigateToWorkspace(option.data as WorkspaceMatch)
        case 'note':
          return navigateToNote(option.data as NoteMatch)
        case 'confirm_delete':
          // User confirmed deletion - execute delete
          const workspace = option.data as WorkspaceMatch
          return deleteWorkspace(workspace.id, workspace.name)
        case 'quick_links_panel':
          // User selected a Quick Links panel from disambiguation
          // Dispatch event for chat to re-resolve with specific badge
          const panelData = option.data as { panelId: string; badge: string; panelType: 'quick_links' }
          if (typeof window !== 'undefined') {
            window.dispatchEvent(new CustomEvent('chat-select-quick-links-panel', {
              detail: { panelId: panelData.panelId, badge: panelData.badge },
            }))
          }
          return {
            success: true,
            message: `Loading Quick Links ${panelData.badge}...`,
            action: 'selected',
          }
        default:
          return {
            success: false,
            message: 'Unknown option type',
            action: 'error',
          }
      }
    },
    [navigateToWorkspace, navigateToNote, deleteWorkspace, renameWorkspace]
  )

  return {
    executeAction,
    navigateToWorkspace,
    navigateToNote,
    createWorkspace,
    goToDashboard,
    goHome,
    renameWorkspace,
    deleteWorkspace,
    selectOption,
  }
}

// =============================================================================
// Event Types (for canvas integration)
// =============================================================================

declare global {
  interface WindowEventMap {
    'chat-navigate-note': CustomEvent<{
      noteId: string
      workspaceId?: string
      entryId?: string
    }>
  }
}
