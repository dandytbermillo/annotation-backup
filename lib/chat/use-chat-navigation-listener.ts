/**
 * Chat Navigation Listener Hook
 *
 * Listens for chat navigation events and opens notes in the canvas.
 * This hook MUST be used inside a component wrapped by CanvasWorkspaceProvider.
 *
 * Phase 3: Action Execution Layer - Canvas Integration
 */

'use client'

import { useEffect, useCallback } from 'react'
import { useCanvasWorkspace } from '@/components/canvas/canvas-workspace-context'

export interface UseChatNavigationListenerOptions {
  /** Whether the listener is enabled */
  enabled?: boolean
  /** Called when a note is opened via chat */
  onNoteOpened?: (noteId: string) => void
  /** Called when an error occurs */
  onError?: (error: Error) => void
}

/**
 * Hook to listen for chat navigation events and open notes in the canvas.
 *
 * IMPORTANT: This hook must be used inside a component that is wrapped by
 * CanvasWorkspaceProvider. It will throw an error if used outside.
 *
 * Usage:
 * ```tsx
 * // In a component inside CanvasWorkspaceProvider
 * function CanvasContent() {
 *   useChatNavigationListener({
 *     enabled: true,
 *     onNoteOpened: (noteId) => console.log('Opened:', noteId),
 *   })
 *   return <div>...</div>
 * }
 * ```
 */
export function useChatNavigationListener(
  options: UseChatNavigationListenerOptions = {}
) {
  const { enabled = true, onNoteOpened, onError } = options

  // This hook MUST be called unconditionally (React rules of hooks)
  // It will throw if used outside CanvasWorkspaceProvider
  const workspace = useCanvasWorkspace()

  const handleChatNavigateNote = useCallback(
    async (event: CustomEvent<{ noteId: string; workspaceId?: string; entryId?: string }>) => {
      const { noteId, workspaceId } = event.detail

      try {
        // Open the note in the canvas
        await workspace.openNote(noteId, {
          workspaceId: workspaceId ?? null,
          persist: true,
        })

        onNoteOpened?.(noteId)
      } catch (error) {
        const err = error instanceof Error ? error : new Error(String(error))
        onError?.(err)
      }
    },
    [workspace, onNoteOpened, onError]
  )

  useEffect(() => {
    if (!enabled) return

    // Listen for chat navigation events
    // Cast through unknown to satisfy TypeScript's strict event handler typing
    const handler = handleChatNavigateNote as unknown as EventListener
    window.addEventListener('chat-navigate-note', handler)

    return () => {
      window.removeEventListener('chat-navigate-note', handler)
    }
  }, [enabled, handleChatNavigateNote])
}
