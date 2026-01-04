'use client'

/**
 * Sandbox Handlers Hook
 * Phase 3.2: Widget Bridge Handler Wiring (Read-Only)
 *
 * Assembles bridge handlers from current UI state.
 * Designed to be used in the parent component that renders WidgetSandboxHost.
 */

import { useMemo, useCallback } from 'react'
import { useToast } from '@/components/ui/use-toast'
import type { BridgeHandlers } from './sandbox-bridge'
import {
  handleGetPanels,
  handleGetActivePanel,
  handleGetCurrentNote,
  handleGetNote,
  type WorkspaceHandlerState,
  type NotesHandlerState,
} from './bridge-api'

// =============================================================================
// Types
// =============================================================================

export interface SandboxHandlerDependencies {
  /** Workspace state for panel handlers */
  workspace: WorkspaceHandlerState
  /** Notes state for note handlers */
  notes: NotesHandlerState
}

export interface UseSandboxHandlersOptions {
  /** Current state dependencies */
  dependencies: SandboxHandlerDependencies
  /** Callback when widget requests resize (optional) */
  onResizeRequest?: (width: number, height: number) => void
}

// =============================================================================
// Hook
// =============================================================================

/**
 * Hook to create bridge handlers from current UI state.
 *
 * Usage:
 * ```tsx
 * const handlers = useSandboxHandlers({
 *   dependencies: {
 *     workspace: { panels, activePanelId },
 *     notes: { currentNote, getNoteById },
 *   },
 *   onResizeRequest: (w, h) => setWidgetSize({ width: w, height: h }),
 * })
 *
 * <WidgetSandboxHost handlers={handlers} ... />
 * ```
 */
export function useSandboxHandlers(options: UseSandboxHandlersOptions): BridgeHandlers {
  const { dependencies, onResizeRequest } = options
  const { toast } = useToast()

  // Workspace handlers
  const workspaceGetPanels = useCallback(async () => {
    return handleGetPanels(dependencies.workspace)
  }, [dependencies.workspace])

  const workspaceGetActivePanel = useCallback(async () => {
    return handleGetActivePanel(dependencies.workspace)
  }, [dependencies.workspace])

  // Notes handlers
  const notesGetCurrentNote = useCallback(async () => {
    return handleGetCurrentNote(dependencies.notes)
  }, [dependencies.notes])

  const notesGetNote = useCallback(async (params: { noteId: string }) => {
    return handleGetNote(dependencies.notes, params)
  }, [dependencies.notes])

  // UI handlers
  const uiShowToast = useCallback(async (params: { message: string; type?: string }) => {
    const variant = params.type === 'error' ? 'destructive' : 'default'
    toast({
      title: params.message,
      variant,
    })
  }, [toast])

  const uiRequestResize = useCallback(async (params: { width: number; height: number }) => {
    if (onResizeRequest) {
      onResizeRequest(params.width, params.height)
    }
    // No-op if resize handler not provided
  }, [onResizeRequest])

  // Assemble handlers object
  const handlers = useMemo<BridgeHandlers>(() => ({
    'workspace.getPanels': workspaceGetPanels,
    'workspace.getActivePanel': workspaceGetActivePanel,
    'notes.getCurrentNote': notesGetCurrentNote,
    'notes.getNote': notesGetNote,
    'ui.showToast': uiShowToast,
    'ui.requestResize': uiRequestResize,
    // Write handlers are Phase 3.3
    // Storage handlers are Phase 3.3
  }), [
    workspaceGetPanels,
    workspaceGetActivePanel,
    notesGetCurrentNote,
    notesGetNote,
    uiShowToast,
    uiRequestResize,
  ])

  return handlers
}

// =============================================================================
// Helper: Create Empty State
// =============================================================================

/**
 * Create empty handler state for contexts where state is unavailable.
 * Returns handlers that return empty/null values safely.
 */
export function createEmptyDependencies(): SandboxHandlerDependencies {
  return {
    workspace: {
      panels: [],
      activePanelId: null,
    },
    notes: {
      currentNote: null,
      getNoteById: undefined,
    },
  }
}
