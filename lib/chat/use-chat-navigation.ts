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
  action?: 'navigated' | 'created' | 'selected' | 'error'
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

        // Step 2: Set workspace context
        setActiveWorkspaceContext(workspace.id)

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

        case 'error':
        default:
          return {
            success: false,
            message: resolution.message,
            action: 'error',
          }
      }
    },
    [navigateToWorkspace, navigateToNote, createWorkspace]
  )

  // ---------------------------------------------------------------------------
  // Select Option (from selection pills)
  // ---------------------------------------------------------------------------

  const selectOption = useCallback(
    async (option: {
      type: 'workspace' | 'note'
      id: string
      data: WorkspaceMatch | NoteMatch
    }): Promise<ChatNavigationResult> => {
      if (option.type === 'workspace') {
        return navigateToWorkspace(option.data as WorkspaceMatch)
      } else {
        return navigateToNote(option.data as NoteMatch)
      }
    },
    [navigateToWorkspace, navigateToNote]
  )

  return {
    executeAction,
    navigateToWorkspace,
    navigateToNote,
    createWorkspace,
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
