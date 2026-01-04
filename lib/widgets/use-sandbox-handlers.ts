'use client'

/**
 * Sandbox Handlers Hook
 * Phase 3.2 + 3.3: Widget Bridge Handler Wiring (Read + Write)
 *
 * Assembles bridge handlers from current UI state.
 * Designed to be used in the parent component that renders WidgetSandboxHost.
 *
 * KNOWN LIMITATION (Phase 3.2):
 * - In dashboard mode, notes.getCurrentNote and notes.getNote return null
 *   because there is no "current note" concept in the dashboard view.
 * - Notes handlers will return real data when widgets are rendered in
 *   workspace mode where a note is open (future integration).
 * - Workspace handlers (getPanels, getActivePanel) work in both modes.
 *
 * PHASE 3.3 ADDITIONS:
 * - Write handlers for workspace (openPanel, closePanel, focusPanel)
 * - Write handlers for notes (updateNote, createNote, deleteNote)
 * - Write handlers for chat (sendMessage)
 * - Rate limiting for write operations
 */

import { useMemo, useCallback, useRef } from 'react'
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
import {
  handleOpenPanel,
  handleClosePanel,
  handleFocusPanel,
  type WorkspaceWriteCallbacks,
} from './bridge-api/workspace-write'
import {
  handleUpdateNote,
  handleCreateNote,
  handleDeleteNote,
  type NotesWriteCallbacks,
} from './bridge-api/notes-write'
import {
  handleSendMessage,
  type ChatWriteCallbacks,
} from './bridge-api/chat-write'

// =============================================================================
// Types
// =============================================================================

export interface SandboxHandlerDependencies {
  /** Workspace state for panel handlers */
  workspace: WorkspaceHandlerState
  /** Notes state for note handlers */
  notes: NotesHandlerState
}

export interface WriteCallbacks {
  /** Workspace write operations */
  workspace?: WorkspaceWriteCallbacks
  /** Notes write operations */
  notes?: NotesWriteCallbacks
  /** Chat write operations */
  chat?: ChatWriteCallbacks
}

export interface UseSandboxHandlersOptions {
  /** Widget instance ID for rate limiting */
  widgetInstanceId?: string
  /** Current state dependencies */
  dependencies: SandboxHandlerDependencies
  /** Write operation callbacks (Phase 3.3) */
  writeCallbacks?: WriteCallbacks
  /** Callback when widget requests resize (optional) */
  onResizeRequest?: (width: number, height: number) => void
}

// =============================================================================
// Rate Limiter
// =============================================================================

const RATE_LIMIT_WINDOW_MS = 60 * 1000 // 1 minute
const RATE_LIMIT_MAX_OPS = 10 // 10 ops per minute per widget

interface RateLimitEntry {
  timestamps: number[]
}

const rateLimitMap = new Map<string, RateLimitEntry>()

function checkRateLimit(widgetInstanceId: string): { allowed: boolean; remaining: number } {
  const now = Date.now()
  const windowStart = now - RATE_LIMIT_WINDOW_MS

  let entry = rateLimitMap.get(widgetInstanceId)
  if (!entry) {
    entry = { timestamps: [] }
    rateLimitMap.set(widgetInstanceId, entry)
  }

  // Remove old timestamps
  entry.timestamps = entry.timestamps.filter(t => t > windowStart)

  if (entry.timestamps.length >= RATE_LIMIT_MAX_OPS) {
    return { allowed: false, remaining: 0 }
  }

  entry.timestamps.push(now)
  return { allowed: true, remaining: RATE_LIMIT_MAX_OPS - entry.timestamps.length }
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
 *   writeCallbacks: {
 *     workspace: { openPanel, closePanel, focusPanel },
 *     notes: { updateNote, createNote, deleteNote },
 *     chat: { sendMessage },
 *   },
 *   onResizeRequest: (w, h) => setWidgetSize({ width: w, height: h }),
 * })
 *
 * <WidgetSandboxHost handlers={handlers} ... />
 * ```
 */
export function useSandboxHandlers(options: UseSandboxHandlersOptions): BridgeHandlers {
  const { widgetInstanceId = 'default', dependencies, writeCallbacks, onResizeRequest } = options
  const { toast } = useToast()

  // Store widgetInstanceId for rate limiting
  const widgetInstanceIdRef = useRef<string>(widgetInstanceId)
  // Keep ref in sync if widgetInstanceId changes
  widgetInstanceIdRef.current = widgetInstanceId

  // Workspace read handlers
  const workspaceGetPanels = useCallback(async () => {
    return handleGetPanels(dependencies.workspace)
  }, [dependencies.workspace])

  const workspaceGetActivePanel = useCallback(async () => {
    return handleGetActivePanel(dependencies.workspace)
  }, [dependencies.workspace])

  // Workspace write handlers (Phase 3.3)
  const workspaceOpenPanel = useCallback(async (params: { panelId: string }) => {
    const rateCheck = checkRateLimit(widgetInstanceIdRef.current)
    if (!rateCheck.allowed) {
      return { success: false, error: 'RATE_LIMITED: Too many write operations' }
    }
    return handleOpenPanel(params, writeCallbacks?.workspace || {})
  }, [writeCallbacks?.workspace])

  const workspaceClosePanel = useCallback(async (params: { panelId: string }) => {
    const rateCheck = checkRateLimit(widgetInstanceIdRef.current)
    if (!rateCheck.allowed) {
      return { success: false, error: 'RATE_LIMITED: Too many write operations' }
    }
    return handleClosePanel(params, writeCallbacks?.workspace || {})
  }, [writeCallbacks?.workspace])

  const workspaceFocusPanel = useCallback(async (params: { panelId: string }) => {
    const rateCheck = checkRateLimit(widgetInstanceIdRef.current)
    if (!rateCheck.allowed) {
      return { success: false, error: 'RATE_LIMITED: Too many write operations' }
    }
    return handleFocusPanel(params, writeCallbacks?.workspace || {})
  }, [writeCallbacks?.workspace])

  // Notes read handlers
  const notesGetCurrentNote = useCallback(async () => {
    return handleGetCurrentNote(dependencies.notes)
  }, [dependencies.notes])

  const notesGetNote = useCallback(async (params: { noteId: string }) => {
    return handleGetNote(dependencies.notes, params)
  }, [dependencies.notes])

  // Notes write handlers (Phase 3.3)
  const notesUpdateNote = useCallback(async (params: { noteId: string; content?: string; title?: string }) => {
    const rateCheck = checkRateLimit(widgetInstanceIdRef.current)
    if (!rateCheck.allowed) {
      return { success: false, error: 'RATE_LIMITED: Too many write operations' }
    }
    return handleUpdateNote(params, writeCallbacks?.notes || {})
  }, [writeCallbacks?.notes])

  const notesCreateNote = useCallback(async (params: { title: string; content?: string; parentId?: string }) => {
    const rateCheck = checkRateLimit(widgetInstanceIdRef.current)
    if (!rateCheck.allowed) {
      return { success: false, error: 'RATE_LIMITED: Too many write operations' }
    }
    return handleCreateNote(params, writeCallbacks?.notes || {})
  }, [writeCallbacks?.notes])

  const notesDeleteNote = useCallback(async (params: { noteId: string }) => {
    const rateCheck = checkRateLimit(widgetInstanceIdRef.current)
    if (!rateCheck.allowed) {
      return { success: false, error: 'RATE_LIMITED: Too many write operations' }
    }
    return handleDeleteNote(params, writeCallbacks?.notes || {})
  }, [writeCallbacks?.notes])

  // Chat write handlers (Phase 3.3)
  const chatSendMessage = useCallback(async (params: { message: string; metadata?: Record<string, unknown> }) => {
    const rateCheck = checkRateLimit(widgetInstanceIdRef.current)
    if (!rateCheck.allowed) {
      return { success: false, error: 'RATE_LIMITED: Too many write operations' }
    }
    return handleSendMessage(params, writeCallbacks?.chat || {})
  }, [writeCallbacks?.chat])

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
    // Read handlers
    'workspace.getPanels': workspaceGetPanels,
    'workspace.getActivePanel': workspaceGetActivePanel,
    'notes.getCurrentNote': notesGetCurrentNote,
    'notes.getNote': notesGetNote,
    // Write handlers (Phase 3.3)
    'workspace.openPanel': workspaceOpenPanel,
    'workspace.closePanel': workspaceClosePanel,
    'workspace.focusPanel': workspaceFocusPanel,
    'notes.updateNote': notesUpdateNote,
    'notes.createNote': notesCreateNote,
    'notes.deleteNote': notesDeleteNote,
    'chat.sendMessage': chatSendMessage,
    // UI handlers
    'ui.showToast': uiShowToast,
    'ui.requestResize': uiRequestResize,
  }), [
    workspaceGetPanels,
    workspaceGetActivePanel,
    notesGetCurrentNote,
    notesGetNote,
    workspaceOpenPanel,
    workspaceClosePanel,
    workspaceFocusPanel,
    notesUpdateNote,
    notesCreateNote,
    notesDeleteNote,
    chatSendMessage,
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
