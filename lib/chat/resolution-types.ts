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
  isSystem: boolean
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

export interface ResolutionContext {
  currentEntryId?: string
  currentWorkspaceId?: string
  userId: string
}
