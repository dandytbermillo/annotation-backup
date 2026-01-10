/**
 * Chat Navigation Resolution Types
 *
 * Types for the data resolution layer that converts
 * intent args (names) into actual IDs.
 */

// =============================================================================
// Workspace Types
// =============================================================================

export interface WorkspaceMatch {
  id: string
  name: string
  entryId: string
  entryName: string
  isDefault: boolean
  updatedAt?: string
  noteCount?: number
}

export interface WorkspaceResolutionResult {
  status: 'found' | 'multiple' | 'not_found'
  workspace?: WorkspaceMatch
  matches?: WorkspaceMatch[]
  message?: string
}

// =============================================================================
// Note Types
// =============================================================================

export interface NoteMatch {
  id: string
  title: string
  noteId: string
  workspaceId?: string
  workspaceName?: string
  entryId?: string
  entryName?: string
  excerpt?: string
}

export interface NoteResolutionResult {
  status: 'found' | 'multiple' | 'not_found'
  note?: NoteMatch
  matches?: NoteMatch[]
  message?: string
}

// =============================================================================
// Entry Types
// =============================================================================

export interface EntryMatch {
  id: string
  name: string
  path?: string
  type?: 'folder' | 'note'
  parentId?: string
  parentName?: string
  isSystem: boolean
  dashboardWorkspaceId?: string  // Default workspace for navigation
}

export interface EntryResolutionResult {
  status: 'found' | 'multiple' | 'not_found'
  entry?: EntryMatch
  matches?: EntryMatch[]
  message?: string
}

// =============================================================================
// Context
// =============================================================================

import type { SessionState } from './intent-prompt'

export interface ResolutionContext {
  currentEntryId?: string
  currentEntryName?: string
  currentWorkspaceId?: string
  homeEntryId?: string
  userId: string
  sessionState?: SessionState
  visiblePanels?: string[]
  // Visible widgets with panel IDs for exact-match resolution (Step 1 of ambiguity guard)
  visibleWidgets?: Array<{ id: string; title: string; type: string }>
  // For panel write confirmation bypass
  bypassPanelWriteConfirmation?: boolean
  pendingPanelIntent?: {
    panelId: string
    intentName: string
    params: Record<string, unknown>
  }
  // Deterministic fallback: force preview mode when raw input contains
  // "list", "preview", "in the chatbox", or "in chat" keywords
  // (per panel-intent-registry-plan.md Routing Precedence)
  forcePreviewMode?: boolean
  // Pending disambiguation options (for reshow_options intent)
  pendingOptions?: Array<{
    index: number
    label: string
    sublabel?: string
    type: string
    id: string
  }>
}
