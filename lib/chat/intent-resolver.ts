/**
 * Intent Resolver
 *
 * Main entry point for resolving chat navigation intents.
 * Takes a parsed intent and resolves it to actionable data.
 */

import type { IntentResponse } from './intent-schema'
import type {
  WorkspaceResolutionResult,
  NoteResolutionResult,
  ResolutionContext,
  WorkspaceMatch,
} from './resolution-types'
import {
  resolveWorkspace,
  resolveRecentWorkspace,
  listWorkspaces,
  renameWorkspace,
  deleteWorkspace,
} from './workspace-resolver'
import { resolveNote } from './note-resolver'
import { serverPool } from '@/lib/db/pool'

// =============================================================================
// Resolution Result
// =============================================================================

export interface IntentResolutionResult {
  success: boolean
  action?:
    | 'navigate_workspace'
    | 'navigate_note'
    | 'navigate_dashboard'
    | 'create_workspace'
    | 'list_workspaces'
    | 'rename_workspace'
    | 'confirm_delete'
    | 'delete_workspace'
    | 'select'
    | 'inform'
    | 'error'

  // For navigate_workspace
  workspace?: WorkspaceMatch

  // For navigate_note
  note?: {
    id: string
    title: string
    workspaceId: string
    workspaceName: string
    entryId: string
    entryName: string
  }

  // For create_workspace
  newWorkspace?: {
    name: string
    entryId: string
  }

  // For rename_workspace
  renamedWorkspace?: WorkspaceMatch
  renamedFrom?: string  // Original name before rename

  // For confirm_delete / delete_workspace
  deleteTarget?: {
    id: string
    name: string
    isDefault: boolean
  }

  // For select (multiple matches) and list_workspaces
  options?: Array<{
    type: 'workspace' | 'note' | 'confirm_delete'
    id: string
    label: string
    sublabel?: string
    data: any
  }>

  // Message to display
  message: string
}

// =============================================================================
// Main Resolver
// =============================================================================

/**
 * Resolve an intent to actionable data.
 */
export async function resolveIntent(
  intent: IntentResponse,
  context: ResolutionContext
): Promise<IntentResolutionResult> {
  switch (intent.intent) {
    case 'open_workspace':
      return resolveOpenWorkspace(intent, context)

    case 'open_recent_workspace':
      return resolveOpenRecentWorkspace(context)

    case 'open_note':
      return resolveOpenNote(intent, context)

    case 'create_workspace':
      return resolveCreateWorkspace(intent, context)

    // Phase 1: Workspace Operations
    case 'list_workspaces':
      return resolveListWorkspaces(context)

    case 'go_to_dashboard':
      return resolveGoToDashboard(context)

    case 'rename_workspace':
      return resolveRenameWorkspace(intent, context)

    case 'delete_workspace':
      return resolveDeleteWorkspace(intent, context)

    // Phase 2: Informational Intents (resolved from sessionState)
    case 'location_info':
      return resolveLocationInfo(context)

    case 'last_action':
      return resolveLastAction(context)

    case 'session_stats':
      return resolveSessionStats(intent, context)

    case 'verify_action':
      return resolveVerifyAction(intent, context)

    case 'unsupported':
    default:
      return {
        success: false,
        action: 'error',
        message: intent.args.reason || 'That request is not supported yet.',
      }
  }
}

// =============================================================================
// Intent Handlers
// =============================================================================

async function resolveOpenWorkspace(
  intent: IntentResponse,
  context: ResolutionContext
): Promise<IntentResolutionResult> {
  const { workspaceName, entryName } = intent.args

  if (!workspaceName) {
    return {
      success: false,
      action: 'error',
      message: 'Please specify a workspace name.',
    }
  }

  const result = await resolveWorkspace(workspaceName, context, entryName)

  switch (result.status) {
    case 'found':
      return {
        success: true,
        action: 'navigate_workspace',
        workspace: result.workspace,
        message: `Opening workspace "${result.workspace!.name}"`,
      }

    case 'multiple':
      // Apply pill label rules per plan:
      // - If user mentioned entry → show "Entry / Workspace"
      // - If workspace-only → show just workspace name
      // - BUT if multiple entries share same workspace name → add entry for disambiguation
      const userMentionedEntry = !!entryName
      const matches = result.matches!

      // Check if we need entry labels for disambiguation (multiple entries with same workspace name)
      const workspaceNames = matches.map((w) => w.name.toLowerCase())
      const hasDuplicateWorkspaceNames =
        workspaceNames.length !== new Set(workspaceNames).size

      // Determine if we should show entry as sublabel
      const showEntrySublabel = userMentionedEntry || hasDuplicateWorkspaceNames

      return {
        success: true,
        action: 'select',
        options: matches.map((w) => ({
          type: 'workspace' as const,
          id: w.id,
          label: w.name,
          sublabel: showEntrySublabel ? w.entryName : undefined,
          data: w,
        })),
        message: result.message || 'Multiple workspaces found. Please select one.',
      }

    case 'not_found':
    default:
      return {
        success: false,
        action: 'error',
        message: result.message || `No workspace found matching "${workspaceName}"`,
      }
  }
}

async function resolveOpenRecentWorkspace(
  context: ResolutionContext
): Promise<IntentResolutionResult> {
  const result = await resolveRecentWorkspace(context)

  if (result.status === 'found' && result.workspace) {
    return {
      success: true,
      action: 'navigate_workspace',
      workspace: result.workspace,
      message: `Opening recent workspace "${result.workspace.name}"`,
    }
  }

  return {
    success: false,
    action: 'error',
    message: result.message || 'No recent workspace found.',
  }
}

async function resolveOpenNote(
  intent: IntentResponse,
  context: ResolutionContext
): Promise<IntentResolutionResult> {
  const { noteTitle, entryName } = intent.args

  if (!noteTitle) {
    return {
      success: false,
      action: 'error',
      message: 'Please specify a note title.',
    }
  }

  const result = await resolveNote(noteTitle, context, entryName)

  switch (result.status) {
    case 'found':
      const note = result.note!
      return {
        success: true,
        action: 'navigate_note',
        note: {
          id: note.id,
          title: note.title,
          workspaceId: note.workspaceId || '',
          workspaceName: note.workspaceName || '',
          entryId: note.entryId || '',
          entryName: note.entryName || '',
        },
        message: `Opening note "${note.title}"`,
      }

    case 'multiple':
      // Apply pill label rules per plan:
      // - If user mentioned entry → show "Entry / Workspace"
      // - If note-only → show just note title
      // - BUT if multiple notes with same title exist → add context for disambiguation
      const userMentionedEntry = !!entryName
      const noteMatches = result.matches!

      // Check if we need context labels for disambiguation (multiple notes with same title)
      const noteTitles = noteMatches.map((n) => n.title.toLowerCase())
      const hasDuplicateNoteTitles =
        noteTitles.length !== new Set(noteTitles).size

      // Determine if we should show context sublabel
      const showContextSublabel = userMentionedEntry || hasDuplicateNoteTitles

      return {
        success: true,
        action: 'select',
        options: noteMatches.map((n) => ({
          type: 'note' as const,
          id: n.id,
          label: n.title,
          sublabel: showContextSublabel
            ? n.workspaceName
              ? `${n.entryName} / ${n.workspaceName}`
              : n.entryName
            : undefined,
          data: n,
        })),
        message: result.message || 'Multiple notes found. Please select one.',
      }

    case 'not_found':
    default:
      return {
        success: false,
        action: 'error',
        message: result.message || `No note found matching "${noteTitle}"`,
      }
  }
}

async function resolveCreateWorkspace(
  intent: IntentResponse,
  context: ResolutionContext
): Promise<IntentResolutionResult> {
  const { newWorkspaceName } = intent.args

  if (!context.currentEntryId) {
    return {
      success: false,
      action: 'error',
      message: 'Please open a note first, then create a workspace inside it.',
    }
  }

  if (!newWorkspaceName) {
    // No name provided - ask for confirmation
    return {
      success: true,
      action: 'create_workspace',
      newWorkspace: {
        name: '',
        entryId: context.currentEntryId,
      },
      message: 'What would you like to name the new workspace?',
    }
  }

  // Name provided - ready to create
  return {
    success: true,
    action: 'create_workspace',
    newWorkspace: {
      name: newWorkspaceName,
      entryId: context.currentEntryId,
    },
    message: `Ready to create workspace "${newWorkspaceName}"`,
  }
}

// =============================================================================
// Phase 1: Workspace Operations Handlers
// =============================================================================

/**
 * Helper to format relative time
 */
function formatTimeAgo(dateString: string | null | undefined): string {
  if (!dateString) return 'Never'
  const date = new Date(dateString)
  if (isNaN(date.getTime())) return 'Never'

  const now = Date.now()
  const seconds = Math.floor((now - date.getTime()) / 1000)

  if (seconds < 60) return 'just now'
  const minutes = Math.floor(seconds / 60)
  if (minutes < 60) return `${minutes}m ago`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours}h ago`
  const days = Math.floor(hours / 24)
  if (days === 1) return 'yesterday'
  if (days < 7) return `${days}d ago`
  return date.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
}

async function resolveListWorkspaces(
  context: ResolutionContext
): Promise<IntentResolutionResult> {
  const result = await listWorkspaces(context)

  if (result.status === 'not_found') {
    return {
      success: false,
      action: 'error',
      message: result.message || 'No workspaces found.',
    }
  }

  // Return workspaces as selectable options
  const matches = result.matches || []
  return {
    success: true,
    action: 'list_workspaces',
    options: matches.map((w) => ({
      type: 'workspace' as const,
      id: w.id,
      label: w.isDefault ? `${w.name} (Default)` : w.name,
      sublabel: `${w.noteCount || 0} notes · ${formatTimeAgo(w.updatedAt)}`,
      data: w,
    })),
    message: result.message || `Found ${matches.length} workspace${matches.length === 1 ? '' : 's'}:`,
  }
}

async function resolveGoToDashboard(
  context: ResolutionContext
): Promise<IntentResolutionResult> {
  // Check if user is in a workspace (has currentWorkspaceId)
  if (!context.currentWorkspaceId) {
    return {
      success: false,
      action: 'error',
      message: "You're already on the dashboard.",
    }
  }

  return {
    success: true,
    action: 'navigate_dashboard',
    message: 'Returning to dashboard...',
  }
}

async function resolveRenameWorkspace(
  intent: IntentResponse,
  context: ResolutionContext
): Promise<IntentResolutionResult> {
  const { workspaceName, newName } = intent.args

  if (!context.currentEntryId) {
    return {
      success: false,
      action: 'error',
      message: 'Please open an entry first.',
    }
  }

  if (!workspaceName) {
    return {
      success: false,
      action: 'error',
      message: 'Please specify which workspace to rename.',
    }
  }

  // Resolve the workspace by name
  const result = await resolveWorkspace(workspaceName, context)

  switch (result.status) {
    case 'found':
      if (!newName) {
        // No new name provided - ask for it
        return {
          success: true,
          action: 'select',
          workspace: result.workspace,
          message: `What would you like to rename "${result.workspace!.name}" to?`,
        }
      }

      // Perform the rename
      const renameResult = await renameWorkspace(
        result.workspace!.id,
        newName,
        context
      )

      if (!renameResult.success) {
        return {
          success: false,
          action: 'error',
          message: renameResult.message,
        }
      }

      return {
        success: true,
        action: 'rename_workspace',
        renamedWorkspace: renameResult.workspace,
        renamedFrom: result.workspace!.name,  // Original name before rename
        message: renameResult.message,
      }

    case 'multiple':
      // Multiple matches - need user selection
      return {
        success: true,
        action: 'select',
        options: result.matches!.map((w) => ({
          type: 'workspace' as const,
          id: w.id,
          label: w.name,
          sublabel: w.isDefault ? 'Default' : undefined,
          data: { ...w, pendingNewName: newName },
        })),
        message: `Multiple workspaces match "${workspaceName}". Which one do you want to rename?`,
      }

    case 'not_found':
    default:
      return {
        success: false,
        action: 'error',
        message: result.message || `No workspace found matching "${workspaceName}". Try "list workspaces" to see available workspaces.`,
      }
  }
}

async function resolveDeleteWorkspace(
  intent: IntentResponse,
  context: ResolutionContext
): Promise<IntentResolutionResult> {
  const { workspaceName } = intent.args

  if (!context.currentEntryId) {
    return {
      success: false,
      action: 'error',
      message: 'Please open an entry first.',
    }
  }

  if (!workspaceName) {
    return {
      success: false,
      action: 'error',
      message: 'Please specify which workspace to delete.',
    }
  }

  // Resolve the workspace by name
  const result = await resolveWorkspace(workspaceName, context)

  switch (result.status) {
    case 'found':
      const workspace = result.workspace!

      // Block deletion of default workspace
      if (workspace.isDefault) {
        return {
          success: false,
          action: 'error',
          message: 'Cannot delete the default workspace.',
        }
      }

      // Return confirmation prompt with delete pill
      return {
        success: true,
        action: 'confirm_delete',
        deleteTarget: {
          id: workspace.id,
          name: workspace.name,
          isDefault: workspace.isDefault,
        },
        options: [
          {
            type: 'confirm_delete' as const,
            id: workspace.id,
            label: '🗑️ Confirm Delete',
            sublabel: workspace.name,
            data: workspace,
          },
        ],
        message: `Are you sure you want to permanently delete workspace "${workspace.name}"?`,
      }

    case 'multiple':
      // Multiple matches - need user selection first
      // Filter out default workspaces from delete options
      const deletableMatches = result.matches!.filter((w) => !w.isDefault)
      const defaultMatches = result.matches!.filter((w) => w.isDefault)

      if (deletableMatches.length === 0) {
        return {
          success: false,
          action: 'error',
          message: 'Cannot delete the default workspace.',
        }
      }

      let message = `Multiple workspaces match "${workspaceName}". Which one do you want to delete?`
      if (defaultMatches.length > 0) {
        message += ` (Note: Default workspaces cannot be deleted)`
      }

      return {
        success: true,
        action: 'select',
        options: deletableMatches.map((w) => ({
          type: 'workspace' as const,
          id: w.id,
          label: w.name,
          sublabel: `${w.noteCount || 0} notes`,
          data: { ...w, pendingDelete: true },
        })),
        message,
      }

    case 'not_found':
    default:
      return {
        success: false,
        action: 'error',
        message: result.message || `No workspace found matching "${workspaceName}". Try "list workspaces" to see available workspaces.`,
      }
  }
}

// =============================================================================
// Phase 2: Informational Intent Handlers
// =============================================================================

/**
 * Resolve location_info intent - answer "where am I?"
 */
function resolveLocationInfo(
  context: ResolutionContext
): IntentResolutionResult {
  const ss = context.sessionState

  if (!ss) {
    return {
      success: true,
      action: 'inform',
      message: "I don't have location information available. Try navigating to a workspace first.",
    }
  }

  const viewMode = ss.currentViewMode || 'unknown'

  if (viewMode === 'dashboard') {
    const entryName = ss.currentEntryName || 'an entry'
    return {
      success: true,
      action: 'inform',
      message: `You're on the dashboard of "${entryName}".`,
    }
  }

  if (viewMode === 'workspace') {
    const workspaceName = ss.currentWorkspaceName || 'unknown workspace'
    const entryName = ss.currentEntryName || 'an entry'
    return {
      success: true,
      action: 'inform',
      message: `You're in workspace "${workspaceName}" in "${entryName}".`,
    }
  }

  return {
    success: true,
    action: 'inform',
    message: "I'm not sure where you are. Try navigating to a workspace.",
  }
}

/**
 * Resolve last_action intent - answer "what did I just do?"
 */
function resolveLastAction(
  context: ResolutionContext
): IntentResolutionResult {
  const ss = context.sessionState
  const lastAction = ss?.lastAction

  if (!lastAction) {
    return {
      success: true,
      action: 'inform',
      message: "I don't have any record of recent actions in this session.",
    }
  }

  const timeAgo = formatTimeAgo(new Date(lastAction.timestamp).toISOString())

  switch (lastAction.type) {
    case 'open_workspace':
      return {
        success: true,
        action: 'inform',
        message: `You opened workspace "${lastAction.workspaceName}" ${timeAgo}.`,
      }

    case 'rename_workspace':
      return {
        success: true,
        action: 'inform',
        message: `You renamed workspace "${lastAction.fromName}" to "${lastAction.toName}" ${timeAgo}.`,
      }

    case 'delete_workspace':
      return {
        success: true,
        action: 'inform',
        message: `You deleted workspace "${lastAction.workspaceName}" ${timeAgo}.`,
      }

    case 'create_workspace':
      return {
        success: true,
        action: 'inform',
        message: `You created workspace "${lastAction.workspaceName}" ${timeAgo}.`,
      }

    case 'go_to_dashboard':
      return {
        success: true,
        action: 'inform',
        message: `You returned to the dashboard ${timeAgo}.`,
      }

    default:
      return {
        success: true,
        action: 'inform',
        message: `Your last action was ${timeAgo}.`,
      }
  }
}

/**
 * Resolve session_stats intent - answer "did I open X?" or "how many times did I open X?"
 * Returns comprehensive response: session-level + last-action clarification per the plan.
 */
function resolveSessionStats(
  intent: IntentResponse,
  context: ResolutionContext
): IntentResolutionResult {
  const ss = context.sessionState
  const openCounts = ss?.openCounts
  const lastAction = ss?.lastAction

  // If user asked about a specific workspace
  const targetName = intent.args.statsWorkspaceName
  if (targetName) {
    // If no openCounts at all, the answer is no
    if (!openCounts || Object.keys(openCounts).length === 0) {
      return {
        success: true,
        action: 'inform',
        message: `No, I have no record of opening "${targetName}" this session.`,
      }
    }

    // Find by name (case-insensitive match)
    const entry = Object.entries(openCounts).find(
      ([_, data]) => data.name.toLowerCase() === targetName.toLowerCase()
    )

    if (entry) {
      const [_, data] = entry
      const times = data.count === 1 ? 'once' : `${data.count} times`

      // Check if last action was opening this same workspace
      const lastActionWasOpeningThis =
        lastAction?.type === 'open_workspace' &&
        lastAction.workspaceName?.toLowerCase() === data.name.toLowerCase()

      if (lastActionWasOpeningThis) {
        // Last action WAS opening this workspace - simple yes
        return {
          success: true,
          action: 'inform',
          message: `Yes, you opened "${data.name}" ${times} this session.`,
        }
      } else if (lastAction) {
        // Last action was something else - provide comprehensive response
        const lastActionSummary = formatLastActionSummary(lastAction)
        return {
          success: true,
          action: 'inform',
          message: `Yes, you opened "${data.name}" ${times} this session. (Not just now — your last action was ${lastActionSummary}.)`,
        }
      } else {
        // No last action info - just return session stats
        return {
          success: true,
          action: 'inform',
          message: `Yes, you opened "${data.name}" ${times} this session.`,
        }
      }
    }

    return {
      success: true,
      action: 'inform',
      message: `No, I have no record of opening "${targetName}" this session.`,
    }
  }

  // No specific workspace - show summary
  if (!openCounts || Object.keys(openCounts).length === 0) {
    return {
      success: true,
      action: 'inform',
      message: "You haven't opened any workspaces yet in this session.",
    }
  }

  // No specific workspace - show summary
  const entries = Object.entries(openCounts)
    .map(([_, data]) => `"${data.name}" (${data.count}x)`)
    .join(', ')

  return {
    success: true,
    action: 'inform',
    message: `Workspaces opened this session: ${entries}.`,
  }
}

/**
 * Resolve verify_action intent - verify if a specific action was performed
 * Uses case-insensitive, trimmed comparison per the plan's name matching rules.
 */
function resolveVerifyAction(
  intent: IntentResponse,
  context: ResolutionContext
): IntentResolutionResult {
  const ss = context.sessionState
  const lastAction = ss?.lastAction

  if (!lastAction) {
    return {
      success: true,
      action: 'inform',
      message: "I don't have enough info to confirm that. No recent actions recorded.",
    }
  }

  const { verifyActionType, verifyWorkspaceName, verifyFromName, verifyToName } = intent.args

  // Helper for case-insensitive, trimmed comparison
  const matches = (a?: string, b?: string): boolean => {
    if (!a || !b) return false
    return a.trim().toLowerCase() === b.trim().toLowerCase()
  }

  // If no action type specified, we can't verify
  if (!verifyActionType) {
    return {
      success: true,
      action: 'inform',
      message: "I'm not sure what action you want to verify. Could you be more specific?",
    }
  }

  // Check if action type matches
  if (lastAction.type !== verifyActionType) {
    const lastActionSummary = formatLastActionSummary(lastAction)
    return {
      success: true,
      action: 'inform',
      message: `No, the last action was ${lastActionSummary}.`,
    }
  }

  // Action type matches - now verify details based on type
  switch (verifyActionType) {
    case 'open_workspace':
      if (verifyWorkspaceName) {
        if (matches(lastAction.workspaceName, verifyWorkspaceName)) {
          return {
            success: true,
            action: 'inform',
            message: `Yes, you opened workspace "${lastAction.workspaceName}".`,
          }
        } else {
          return {
            success: true,
            action: 'inform',
            message: `No, the last action was opening workspace "${lastAction.workspaceName}".`,
          }
        }
      }
      // No specific workspace to verify, just confirm the action type
      return {
        success: true,
        action: 'inform',
        message: `Yes, you opened workspace "${lastAction.workspaceName}".`,
      }

    case 'rename_workspace':
      // For rename, we need to check fromName and toName
      if (verifyFromName || verifyToName) {
        const fromMatches = !verifyFromName || matches(lastAction.fromName, verifyFromName)
        const toMatches = !verifyToName || matches(lastAction.toName, verifyToName)

        if (fromMatches && toMatches) {
          return {
            success: true,
            action: 'inform',
            message: `Yes, you renamed "${lastAction.fromName}" to "${lastAction.toName}".`,
          }
        } else {
          return {
            success: true,
            action: 'inform',
            message: `No, the last action was renaming "${lastAction.fromName}" to "${lastAction.toName}".`,
          }
        }
      }
      // No specific names to verify
      return {
        success: true,
        action: 'inform',
        message: `Yes, you renamed "${lastAction.fromName}" to "${lastAction.toName}".`,
      }

    case 'delete_workspace':
      if (verifyWorkspaceName) {
        if (matches(lastAction.workspaceName, verifyWorkspaceName)) {
          return {
            success: true,
            action: 'inform',
            message: `Yes, you deleted workspace "${lastAction.workspaceName}".`,
          }
        } else {
          return {
            success: true,
            action: 'inform',
            message: `No, the last action was deleting workspace "${lastAction.workspaceName}".`,
          }
        }
      }
      return {
        success: true,
        action: 'inform',
        message: `Yes, you deleted workspace "${lastAction.workspaceName}".`,
      }

    case 'create_workspace':
      if (verifyWorkspaceName) {
        if (matches(lastAction.workspaceName, verifyWorkspaceName)) {
          return {
            success: true,
            action: 'inform',
            message: `Yes, you created workspace "${lastAction.workspaceName}".`,
          }
        } else {
          return {
            success: true,
            action: 'inform',
            message: `No, the last action was creating workspace "${lastAction.workspaceName}".`,
          }
        }
      }
      return {
        success: true,
        action: 'inform',
        message: `Yes, you created workspace "${lastAction.workspaceName}".`,
      }

    case 'go_to_dashboard':
      return {
        success: true,
        action: 'inform',
        message: 'Yes, you returned to the dashboard.',
      }

    default:
      return {
        success: true,
        action: 'inform',
        message: "I'm not sure how to verify that action type.",
      }
  }
}

/**
 * Helper to format last action as a summary string
 */
function formatLastActionSummary(lastAction: NonNullable<ResolutionContext['sessionState']>['lastAction']): string {
  if (!lastAction) return 'unknown'

  switch (lastAction.type) {
    case 'open_workspace':
      return `opening workspace "${lastAction.workspaceName}"`
    case 'rename_workspace':
      return `renaming "${lastAction.fromName}" to "${lastAction.toName}"`
    case 'delete_workspace':
      return `deleting workspace "${lastAction.workspaceName}"`
    case 'create_workspace':
      return `creating workspace "${lastAction.workspaceName}"`
    case 'go_to_dashboard':
      return 'returning to the dashboard'
    default:
      return 'an unknown action'
  }
}
