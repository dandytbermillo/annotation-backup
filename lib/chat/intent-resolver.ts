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
  EntryMatch,
} from './resolution-types'
import type { ViewPanelContent, ViewListItem } from './view-panel-types'
import { ViewContentType } from './view-panel-types'
import {
  resolveWorkspace,
  resolveRecentWorkspace,
  listWorkspaces,
  renameWorkspace,
  deleteWorkspace,
} from './workspace-resolver'
import { resolveNote } from './note-resolver'
import { resolveEntry } from './entry-resolver'
import { serverPool } from '@/lib/db/pool'
import { buildQuickLinksViewItems } from './parse-quick-links'
import { executePanelIntent, panelRegistry } from '@/lib/panels/panel-registry'
import { debugLog } from '@/lib/utils/debug-logger'

// =============================================================================
// Resolution Result
// =============================================================================

export interface IntentResolutionResult {
  success: boolean
  action?:
    | 'navigate_workspace'
    | 'navigate_note'
    | 'navigate_entry'  // Navigate to entry's dashboard
    | 'navigate_dashboard'
    | 'navigate_home'
    | 'create_workspace'
    | 'list_workspaces'
    | 'rename_workspace'
    | 'confirm_delete'
    | 'delete_workspace'
    | 'confirm_panel_write'  // Confirm before executing write panel intent
    | 'select'
    | 'select_option'  // Hybrid selection follow-up
    | 'reshow_options' // User wants to see pending options again
    | 'clarify_type'   // Entry vs workspace type conflict
    | 'inform'
    | 'show_view_panel'
    | 'open_panel_drawer'  // Open panel in right-side drawer (Widget Architecture)
    | 'answer_from_context'  // Answer clarification from chat context (no side effects)
    | 'need_context'  // LLM needs more context to answer (triggers re-call with expanded context)
    | 'general_answer'  // Answer to non-app question (time/math/static knowledge)
    | 'error'

  // For navigate_workspace
  workspace?: WorkspaceMatch

  // For navigate_entry
  entry?: EntryMatch

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
    type: 'workspace' | 'note' | 'entry' | 'confirm_delete' | 'quick_links_panel' | 'confirm_panel_write' | 'panel_drawer'
    id: string
    label: string
    sublabel?: string
    data: any
  }>

  // For show_view_panel: content to display in the view panel
  viewPanelContent?: ViewPanelContent
  showInViewPanel?: boolean

  // For inline message preview (first few items before "Show all")
  previewItems?: ViewListItem[]
  totalCount?: number

  // For select_option (hybrid selection follow-up)
  optionIndex?: number   // 1-based index from LLM
  optionLabel?: string   // label from LLM for fuzzy matching

  // For confirm_panel_write (pending panel intent awaiting confirmation)
  pendingPanelIntent?: {
    panelId: string
    intentName: string
    params: Record<string, unknown>
  }

  // For open_panel_drawer (Widget Architecture)
  panelId?: string
  panelTitle?: string
  // Semantic panel ID for action tracking (e.g., "recent", "quick-links-d")
  // Used to match user queries like "did I open quick links D?"
  semanticPanelId?: string

  // For need_context: what context the LLM needs
  contextRequest?: string

  // For general_answer: the type of answer (time/math/general)
  generalAnswerType?: 'time' | 'math' | 'general'

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

    case 'go_home':
      return resolveGoHome(context)

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

    case 'verify_request':
      return resolveVerifyRequest(intent, context)

    // Phase 3: View Panel Content Intents
    case 'show_quick_links':
      return resolveShowQuickLinks(intent, context)

    case 'preview_file':
      return resolvePreviewFile(intent, context)

    // Phase 4: Hybrid Selection Follow-up
    case 'select_option':
      return resolveSelectOption(intent)

    case 'reshow_options':
      return resolveReshowOptions(context)

    // Phase 5: Hybrid Commands - bare name resolution
    case 'resolve_name':
      return resolveBareName(intent, context)

    // Phase 6: Panel Intent Registry
    case 'panel_intent':
      return resolvePanelIntent(intent, context)

    // Phase 7: LLM-first context answers
    case 'answer_from_context':
      return resolveAnswerFromContext(intent)

    // Phase 8: Context retrieval and general answers
    case 'need_context':
      return resolveNeedContext(intent)

    case 'general_answer':
      return resolveGeneralAnswer(intent)

    // Phase 9: App data retrieval (DB lookup)
    case 'retrieve_from_app':
      return resolveRetrieveFromApp(intent, context)

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

  // Fallback: If no recent workspace, check if "Recent" panel is visible
  // This handles "open my recent" being classified as workspace intent when user meant panel
  if (context.visibleWidgets && context.visibleWidgets.length > 0) {
    const recentPanel = context.visibleWidgets.find(
      (w) => w.title.toLowerCase() === 'recent' || w.type === 'recent'
    )
    if (recentPanel) {
      return {
        success: true,
        action: 'open_panel_drawer',
        panelId: recentPanel.id,
        panelTitle: recentPanel.title || 'Recent',
        semanticPanelId: 'recent',
        message: `Opening ${recentPanel.title || 'Recent'}...`,
      }
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
    const entryName = context.currentEntryName || 'current entry'
    return {
      success: false,
      action: 'error',
      message: `You're already on ${entryName}'s dashboard.`,
    }
  }

  return {
    success: true,
    action: 'navigate_dashboard',
    message: 'Returning to dashboard...',
  }
}

async function resolveGoHome(
  context: ResolutionContext
): Promise<IntentResolutionResult> {
  // Check if already on Home entry's dashboard
  // homeEntryId should be available in context from DashboardInitializer
  const isOnHomeEntry = context.homeEntryId && context.currentEntryId === context.homeEntryId
  const isOnDashboard = !context.currentWorkspaceId

  if (isOnHomeEntry && isOnDashboard) {
    return {
      success: false,
      action: 'error',
      message: "You're already on the Home dashboard.",
    }
  }

  return {
    success: true,
    action: 'navigate_home',
    message: 'Going home...',
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

    case 'open_entry':
      return {
        success: true,
        action: 'inform',
        message: `You opened entry "${lastAction.entryName}" ${timeAgo}.`,
      }

    // Phase 1b: Format open_panel actions
    case 'open_panel':
      return {
        success: true,
        action: 'inform',
        message: `You opened "${lastAction.panelTitle || 'a panel'}" ${timeAgo}.`,
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

    case 'go_home':
      return {
        success: true,
        action: 'inform',
        message: `You went home ${timeAgo}.`,
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
 * Now supports both entries and workspaces.
 */
function resolveSessionStats(
  intent: IntentResponse,
  context: ResolutionContext
): IntentResolutionResult {
  const ss = context.sessionState
  const openCounts = ss?.openCounts
  const lastAction = ss?.lastAction

  // If user asked about a specific name (could be entry or workspace)
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

    // Find all matches by name (case-insensitive) - could be entry, workspace, or both
    // First try exact match, then fall back to partial match (startsWith)
    const targetLower = targetName.toLowerCase()
    let matches = Object.entries(openCounts).filter(
      ([_, data]) => data.name.toLowerCase() === targetLower
    )

    // If no exact match, try partial match (name starts with target or target starts with name)
    if (matches.length === 0) {
      matches = Object.entries(openCounts).filter(
        ([_, data]) => {
          const nameLower = data.name.toLowerCase()
          return nameLower.startsWith(targetLower) || targetLower.startsWith(nameLower)
        }
      )
    }

    if (matches.length === 0) {
      return {
        success: true,
        action: 'inform',
        message: `No, I have no record of opening "${targetName}" this session.`,
      }
    }

    // Check if both entry and workspace match (disambiguation needed)
    const entryMatch = matches.find(([_, data]) => data.type === 'entry')
    const workspaceMatch = matches.find(([_, data]) => data.type === 'workspace')

    if (entryMatch && workspaceMatch) {
      // Both match - ask for clarification
      const entryData = entryMatch[1]
      const workspaceData = workspaceMatch[1]
      return {
        success: true,
        action: 'inform',
        message: `You opened both entry "${entryData.name}" (${entryData.count}x) and workspace "${workspaceData.name}" (${workspaceData.count}x) this session. Which did you mean?`,
      }
    }

    // Single match - report it
    const [_, data] = matches[0]
    const times = data.count === 1 ? 'once' : `${data.count} times`
    const typeLabel = data.type === 'entry' ? 'entry' : 'workspace'

    // Check if last action was opening this same item
    const lastActionWasOpeningThis =
      (lastAction?.type === 'open_workspace' &&
        data.type === 'workspace' &&
        lastAction.workspaceName?.toLowerCase() === data.name.toLowerCase()) ||
      (lastAction?.type === 'open_entry' &&
        data.type === 'entry' &&
        lastAction.entryName?.toLowerCase() === data.name.toLowerCase())

    if (lastActionWasOpeningThis) {
      // Last action WAS opening this item - simple yes
      return {
        success: true,
        action: 'inform',
        message: `Yes, you opened ${typeLabel} "${data.name}" ${times} this session.`,
      }
    } else if (lastAction) {
      // Last action was something else - provide comprehensive response
      const lastActionSummary = formatLastActionSummary(lastAction)
      return {
        success: true,
        action: 'inform',
        message: `Yes, you opened ${typeLabel} "${data.name}" ${times} this session. (Not just now — your last action was ${lastActionSummary}.)`,
      }
    } else {
      // No last action info - just return session stats
      return {
        success: true,
        action: 'inform',
        message: `Yes, you opened ${typeLabel} "${data.name}" ${times} this session.`,
      }
    }
  }

  // No specific name - show summary
  if (!openCounts || Object.keys(openCounts).length === 0) {
    return {
      success: true,
      action: 'inform',
      message: "You haven't opened any entries or workspaces yet in this session.",
    }
  }

  // Separate entries and workspaces for clearer summary
  const entryItems = Object.entries(openCounts)
    .filter(([_, data]) => data.type === 'entry')
    .map(([_, data]) => `"${data.name}" (${data.count}x)`)
  const workspaceItems = Object.entries(openCounts)
    .filter(([_, data]) => data.type === 'workspace')
    .map(([_, data]) => `"${data.name}" (${data.count}x)`)

  const parts: string[] = []
  if (entryItems.length > 0) {
    parts.push(`Entries: ${entryItems.join(', ')}`)
  }
  if (workspaceItems.length > 0) {
    parts.push(`Workspaces: ${workspaceItems.join(', ')}`)
  }

  return {
    success: true,
    action: 'inform',
    message: `Opened this session: ${parts.join('. ')}.`,
  }
}

/**
 * Resolve verify_action intent - verify if a specific action was performed
 * Uses case-insensitive, trimmed comparison per the plan's name matching rules.
 *
 * Session Query Routing: Checks actionHistory for any matching action this session.
 * - For panel queries: normalizes panel names ("recent" → "Recent", "quick links d" → "Quick Links D")
 * - Falls back to lastAction if actionHistory is empty
 */
function resolveVerifyAction(
  intent: IntentResponse,
  context: ResolutionContext
): IntentResolutionResult {
  const ss = context.sessionState
  const lastAction = ss?.lastAction
  const actionHistory = ss?.actionHistory || []

  const { verifyActionType, verifyWorkspaceName, verifyFromName, verifyToName, verifyPanelName } = intent.args

  // Helper for case-insensitive, trimmed comparison
  const matches = (a?: string, b?: string): boolean => {
    if (!a || !b) return false
    return a.trim().toLowerCase() === b.trim().toLowerCase()
  }

  // Helper to convert user's panel name to canonical panelId pattern
  // This is the KEY for robust matching - compare IDs, not display names
  const toPanelIdPattern = (input: string): string | null => {
    const lower = input.trim().toLowerCase()
    // "recent" or "recents" → "recent"
    if (lower === 'recent' || lower === 'recents') return 'recent'
    // "quick links" → "quick-links", "quick links d" → "quick-links-d"
    if (lower.startsWith('quick link') || lower.startsWith('links')) {
      const badge = lower.match(/quick\s*links?\s*([a-z])?$/i)?.[1] || lower.match(/links?\s+([a-z])$/i)?.[1]
      return badge ? `quick-links-${badge.toLowerCase()}` : 'quick-links'
    }
    // Generic: convert spaces/underscores to dashes, lowercase
    return lower.replace(/[\s_]+/g, '-')
  }

  // Helper to get user-friendly panel name for responses
  const toFriendlyPanelName = (input: string): string => {
    const lower = input.trim().toLowerCase()
    if (lower === 'recent' || lower === 'recents') return 'Recent'
    if (lower.startsWith('quick link') || lower.startsWith('links')) {
      const badge = lower.match(/quick\s*links?\s*([a-z])?$/i)?.[1] || lower.match(/links?\s+([a-z])$/i)?.[1]
      return badge ? `Quick Links ${badge.toUpperCase()}` : 'Quick Links'
    }
    return input.trim()
  }

  // If no action type specified, we can't verify
  if (!verifyActionType) {
    return {
      success: true,
      action: 'inform',
      message: "I'm not sure what action you want to verify. Could you be more specific?",
    }
  }

  // ============================================================================
  // Special handling for open_panel - check actionHistory by targetId (panelId)
  // Best practice: match by canonical ID, use display name only for response
  // ============================================================================
  if (verifyActionType === 'open_panel') {
    const targetPanelIdPattern = verifyPanelName ? toPanelIdPattern(verifyPanelName) : null
    const friendlyPanelName = verifyPanelName ? toFriendlyPanelName(verifyPanelName) : null

    // Search actionHistory for matching panel opens
    const panelOpens = actionHistory.filter(entry => entry.type === 'open_panel')

    if (panelOpens.length === 0) {
      const panelDesc = friendlyPanelName ? `"${friendlyPanelName}"` : 'any panel'
      return {
        success: true,
        action: 'inform',
        message: `No, I have no record of opening ${panelDesc} this session.`,
      }
    }

    if (targetPanelIdPattern) {
      // Match by targetId (panelId) - robust against display name changes
      const matchingOpen = panelOpens.find(entry => {
        if (!entry.targetId) return false
        const entryPanelId = entry.targetId.toLowerCase()
        // Exact match or pattern match (e.g., "quick-links-d" matches "quick-links-d")
        // Also handle partial matches for badge (e.g., targetId contains the pattern)
        return entryPanelId === targetPanelIdPattern ||
               entryPanelId.includes(targetPanelIdPattern) ||
               targetPanelIdPattern.includes(entryPanelId)
      })

      if (matchingOpen) {
        return {
          success: true,
          action: 'inform',
          message: `Yes, you opened "${matchingOpen.targetName}" this session.`,
        }
      } else {
        // List what panels were opened (use display names for user-friendly response)
        const openedPanels = [...new Set(panelOpens.map(e => e.targetName))]
        if (openedPanels.length === 1) {
          return {
            success: true,
            action: 'inform',
            message: `No, I have no record of opening "${friendlyPanelName}" this session. You opened "${openedPanels[0]}".`,
          }
        } else {
          return {
            success: true,
            action: 'inform',
            message: `No, I have no record of opening "${friendlyPanelName}" this session. Panels opened: ${openedPanels.join(', ')}.`,
          }
        }
      }
    } else {
      // No specific panel name - list all opened panels
      const openedPanels = [...new Set(panelOpens.map(e => e.targetName))]
      return {
        success: true,
        action: 'inform',
        message: `Yes, you opened panels this session: ${openedPanels.join(', ')}.`,
      }
    }
  }

  // ============================================================================
  // For other action types - first check lastAction, then fallback to actionHistory
  // ============================================================================

  // Try to find a match in actionHistory first
  const historyMatch = actionHistory.find(entry => {
    if (entry.type !== verifyActionType) return false

    switch (verifyActionType) {
      case 'open_workspace':
        return !verifyWorkspaceName || matches(entry.targetName, verifyWorkspaceName)
      case 'open_entry':
        return !verifyWorkspaceName || matches(entry.targetName, verifyWorkspaceName)
      case 'rename_workspace':
        // For rename, targetName is the new name
        return !verifyToName || matches(entry.targetName, verifyToName)
      case 'delete_workspace':
        return !verifyWorkspaceName || matches(entry.targetName, verifyWorkspaceName)
      case 'create_workspace':
        return !verifyWorkspaceName || matches(entry.targetName, verifyWorkspaceName)
      case 'go_to_dashboard':
      case 'go_home':
        return true
      default:
        return false
    }
  })

  // If found in actionHistory, return success
  if (historyMatch) {
    switch (verifyActionType) {
      case 'open_workspace':
        return {
          success: true,
          action: 'inform',
          message: `Yes, you opened workspace "${historyMatch.targetName}" this session.`,
        }
      case 'open_entry':
        return {
          success: true,
          action: 'inform',
          message: `Yes, you opened entry "${historyMatch.targetName}" this session.`,
        }
      case 'rename_workspace':
        return {
          success: true,
          action: 'inform',
          message: `Yes, you renamed a workspace to "${historyMatch.targetName}" this session.`,
        }
      case 'delete_workspace':
        return {
          success: true,
          action: 'inform',
          message: `Yes, you deleted workspace "${historyMatch.targetName}" this session.`,
        }
      case 'create_workspace':
        return {
          success: true,
          action: 'inform',
          message: `Yes, you created workspace "${historyMatch.targetName}" this session.`,
        }
      case 'go_to_dashboard':
        return {
          success: true,
          action: 'inform',
          message: 'Yes, you went to the dashboard this session.',
        }
      case 'go_home':
        return {
          success: true,
          action: 'inform',
          message: 'Yes, you went home this session.',
        }
      default:
        return {
          success: true,
          action: 'inform',
          message: `Yes, you performed that action this session.`,
        }
    }
  }

  // ============================================================================
  // Fallback: Check lastAction for legacy support and "just" queries
  // ============================================================================

  if (!lastAction) {
    // No lastAction and no history match
    const targetDesc = verifyWorkspaceName || verifyPanelName || verifyActionType
    return {
      success: true,
      action: 'inform',
      message: `No, I have no record of ${formatActionTypeDescription(verifyActionType)} "${targetDesc}" this session.`,
    }
  }

  // Check if action type matches lastAction
  if (lastAction.type !== verifyActionType) {
    // Check if the specific target was in history but type doesn't match
    const targetDesc = verifyWorkspaceName || verifyPanelName || ''
    if (targetDesc) {
      return {
        success: true,
        action: 'inform',
        message: `No, I have no record of ${formatActionTypeDescription(verifyActionType)} "${targetDesc}" this session.`,
      }
    }
    const lastActionSummary = formatLastActionSummary(lastAction)
    return {
      success: true,
      action: 'inform',
      message: `No, your last action was ${lastActionSummary}.`,
    }
  }

  // LastAction type matches - verify details based on type
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
            message: `No, I have no record of opening workspace "${verifyWorkspaceName}" this session. Your last action was opening workspace "${lastAction.workspaceName}".`,
          }
        }
      }
      return {
        success: true,
        action: 'inform',
        message: `Yes, you opened workspace "${lastAction.workspaceName}".`,
      }

    case 'rename_workspace':
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
            message: `No, your last rename was "${lastAction.fromName}" to "${lastAction.toName}".`,
          }
        }
      }
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
            message: `No, I have no record of deleting workspace "${verifyWorkspaceName}" this session.`,
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
            message: `No, I have no record of creating workspace "${verifyWorkspaceName}" this session.`,
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

    case 'open_entry':
      if (verifyWorkspaceName) {
        if (matches(lastAction.entryName, verifyWorkspaceName)) {
          return {
            success: true,
            action: 'inform',
            message: `Yes, you opened entry "${lastAction.entryName}".`,
          }
        } else {
          return {
            success: true,
            action: 'inform',
            message: `No, I have no record of opening entry "${verifyWorkspaceName}" this session.`,
          }
        }
      }
      return {
        success: true,
        action: 'inform',
        message: `Yes, you opened entry "${lastAction.entryName}".`,
      }

    case 'go_home':
      return {
        success: true,
        action: 'inform',
        message: 'Yes, you went home.',
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
 * Resolve verify_request intent - verify if user asked/told/requested something
 * Checks requestHistory (user requests) separately from actionHistory (executed actions).
 *
 * Request Query Routing: Checks requestHistory for any matching request this session.
 * - For panel requests: normalizes panel names ("recent" → "Recent", "quick links d" → "Quick Links D")
 * - Uses "asked me to" / "told me to" phrasing in responses per UX Copy Rules
 */
function resolveVerifyRequest(
  intent: IntentResponse,
  context: ResolutionContext
): IntentResolutionResult {
  const ss = context.sessionState
  const requestHistory = ss?.requestHistory || []

  const { verifyRequestType, verifyRequestTargetName } = intent.args

  // Helper for case-insensitive, trimmed comparison
  const matches = (a?: string, b?: string): boolean => {
    if (!a || !b) return false
    return a.trim().toLowerCase() === b.trim().toLowerCase()
  }

  // Helper to convert user's panel name to canonical panelId pattern
  const toPanelIdPattern = (input: string): string | null => {
    const lower = input.trim().toLowerCase()
    if (lower === 'recent' || lower === 'recents') return 'recent'
    if (lower.startsWith('quick link') || lower.startsWith('links')) {
      const badge = lower.match(/quick\s*links?\s*([a-z])?$/i)?.[1] || lower.match(/links?\s+([a-z])$/i)?.[1]
      return badge ? `quick-links-${badge.toLowerCase()}` : 'quick-links'
    }
    return lower.replace(/[\s_]+/g, '-')
  }

  // Helper to get user-friendly target name for responses
  const toFriendlyName = (input: string): string => {
    const lower = input.trim().toLowerCase()
    if (lower === 'recent' || lower === 'recents') return 'Recent'
    if (lower.startsWith('quick link') || lower.startsWith('links')) {
      const badge = lower.match(/quick\s*links?\s*([a-z])?$/i)?.[1] || lower.match(/links?\s+([a-z])$/i)?.[1]
      return badge ? `Quick Links ${badge.toUpperCase()}` : 'Quick Links'
    }
    return input.trim()
  }

  // If no request type specified, check for any requests
  if (!verifyRequestType) {
    if (requestHistory.length === 0) {
      return {
        success: true,
        action: 'inform',
        message: "No, I have no record of you asking me to do anything this session.",
      }
    }

    // List all requests
    const requestTypes = [...new Set(requestHistory.map(r => r.targetName))]
    return {
      success: true,
      action: 'inform',
      message: `This session, you asked me to: ${requestTypes.join(', ')}.`,
    }
  }

  // Map verify request type to matcher
  const requestTypeMap: Record<string, (entry: typeof requestHistory[0]) => boolean> = {
    'request_open_panel': (e) => e.type === 'request_open_panel',
    'request_open_workspace': (e) => e.type === 'request_open_workspace',
    'request_open_entry': (e) => e.type === 'request_open_entry',
    'request_open_note': (e) => e.type === 'request_open_note',
    'request_list_workspaces': (e) => e.type === 'request_list_workspaces',
    'request_show_recent': (e) => e.type === 'request_show_recent',
    'request_go_home': (e) => e.type === 'request_go_home',
    'request_go_dashboard': (e) => e.type === 'request_go_dashboard',
  }

  const typeMatcher = requestTypeMap[verifyRequestType]
  if (!typeMatcher) {
    return {
      success: true,
      action: 'inform',
      message: "I'm not sure what kind of request you want to verify.",
    }
  }

  // Filter by type
  const matchingByType = requestHistory.filter(typeMatcher)

  if (matchingByType.length === 0) {
    const actionDesc = formatRequestTypeDescription(verifyRequestType)
    const targetDesc = verifyRequestTargetName ? ` "${toFriendlyName(verifyRequestTargetName)}"` : ''
    return {
      success: true,
      action: 'inform',
      message: `No, I have no record of you asking me to ${actionDesc}${targetDesc} this session.`,
    }
  }

  // If target name specified, filter further
  if (verifyRequestTargetName) {
    const targetPattern = toPanelIdPattern(verifyRequestTargetName)
    const friendlyName = toFriendlyName(verifyRequestTargetName)

    const matchingTarget = matchingByType.find(entry => {
      // Match by targetId (robust) or targetName (fallback)
      if (entry.targetId && targetPattern) {
        const entryId = entry.targetId.toLowerCase()
        return entryId === targetPattern ||
               entryId.includes(targetPattern) ||
               targetPattern.includes(entryId)
      }
      return matches(entry.targetName, verifyRequestTargetName)
    })

    if (matchingTarget) {
      return {
        success: true,
        action: 'inform',
        message: `Yes, you asked me to open "${matchingTarget.targetName}" this session.`,
      }
    } else {
      // List what they DID ask for of this type
      const requestedTargets = [...new Set(matchingByType.map(e => e.targetName))]
      if (requestedTargets.length === 1) {
        return {
          success: true,
          action: 'inform',
          message: `No, I have no record of you asking me to open "${friendlyName}" this session. You asked me to open "${requestedTargets[0]}".`,
        }
      } else {
        return {
          success: true,
          action: 'inform',
          message: `No, I have no record of you asking me to open "${friendlyName}" this session. You asked me to open: ${requestedTargets.join(', ')}.`,
        }
      }
    }
  }

  // Type matches but no specific target - confirm with list
  const requestedTargets = [...new Set(matchingByType.map(e => e.targetName))]
  const actionDesc = formatRequestTypeDescription(verifyRequestType)
  return {
    success: true,
    action: 'inform',
    message: `Yes, you asked me to ${actionDesc} this session: ${requestedTargets.join(', ')}.`,
  }
}

/**
 * Helper to format request type as human-readable description
 */
function formatRequestTypeDescription(requestType: string): string {
  switch (requestType) {
    case 'request_open_panel': return 'open a panel'
    case 'request_open_workspace': return 'open a workspace'
    case 'request_open_entry': return 'open an entry'
    case 'request_open_note': return 'open a note'
    case 'request_list_workspaces': return 'list workspaces'
    case 'request_show_recent': return 'show recent items'
    case 'request_go_home': return 'go home'
    case 'request_go_dashboard': return 'go to the dashboard'
    default: return requestType.replace('request_', '').replace(/_/g, ' ')
  }
}

/**
 * Helper to format action type as human-readable description
 */
function formatActionTypeDescription(actionType: string): string {
  switch (actionType) {
    case 'open_workspace': return 'opening workspace'
    case 'open_entry': return 'opening entry'
    case 'open_panel': return 'opening'
    case 'rename_workspace': return 'renaming workspace'
    case 'delete_workspace': return 'deleting workspace'
    case 'create_workspace': return 'creating workspace'
    case 'go_to_dashboard': return 'going to dashboard'
    case 'go_home': return 'going home'
    default: return actionType
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
    case 'open_entry':
      return `opening entry "${lastAction.entryName}"`
    case 'open_panel':
      return `opening "${lastAction.panelTitle || 'panel'}"`
    case 'rename_workspace':
      return `renaming "${lastAction.fromName}" to "${lastAction.toName}"`
    case 'delete_workspace':
      return `deleting workspace "${lastAction.workspaceName}"`
    case 'create_workspace':
      return `creating workspace "${lastAction.workspaceName}"`
    case 'go_to_dashboard':
      return 'returning to the dashboard'
    case 'go_home':
      return 'going home'
    default:
      return 'an unknown action'
  }
}

// =============================================================================
// Phase 3: View Panel Content Intent Handlers
// =============================================================================

/**
 * Resolve show_quick_links intent - open Quick Links panel in drawer
 *
 * Widget Architecture: Opens the panel drawer instead of view panel.
 * This shows the full TipTap editor which displays correct workspace names.
 *
 * Exception: If forcePreviewMode is set (user said "list", "preview", etc.),
 * redirect to panel_intent with mode='preview' to show chat preview instead.
 */
async function resolveShowQuickLinks(
  intent: IntentResponse,
  context: ResolutionContext
): Promise<IntentResolutionResult> {
  const { quickLinksPanelBadge } = intent.args

  // Debug logging per quick-links-generic-disambiguation-fix.md
  void debugLog({
    component: 'IntentResolver',
    action: 'show_quick_links_start',
    metadata: {
      explicitBadge: quickLinksPanelBadge || null,
      currentEntryId: context.currentEntryId,
      forcePreviewMode: context.forcePreviewMode || false,
    },
  })

  // Note: forcePreviewMode is applied AFTER disambiguation (at the end of this function)
  // Per plan: "list my quick links" without badge should ask which panel when multiple exist

  if (!context.currentEntryId) {
    return {
      success: false,
      action: 'error',
      message: 'Please open an entry first to view Quick Links.',
    }
  }

  // Find the Quick Links panel(s) in the current entry's dashboard workspace
  // First, get the dashboard workspace for this entry
  const dashboardResult = await serverPool.query(
    `SELECT id FROM note_workspaces
     WHERE item_id = $1 AND user_id = $2 AND is_default = true
     LIMIT 1`,
    [context.currentEntryId, context.userId]
  )

  if (dashboardResult.rows.length === 0) {
    return {
      success: false,
      action: 'error',
      message: 'No dashboard found for this entry.',
    }
  }

  const dashboardWorkspaceId = dashboardResult.rows[0].id

  // Query Quick Links panels (links_note or links_note_tiptap)
  let panelQuery = `
    SELECT id, panel_type, title, config, badge
    FROM workspace_panels
    WHERE workspace_id = $1
      AND panel_type IN ('links_note', 'links_note_tiptap')
      AND deleted_at IS NULL
  `
  const params: (string | undefined)[] = [dashboardWorkspaceId]

  // Filter by badge if specified
  if (quickLinksPanelBadge) {
    panelQuery += ` AND UPPER(badge) = UPPER($2)`
    params.push(quickLinksPanelBadge)
  }

  panelQuery += ` ORDER BY badge ASC, created_at ASC`

  const panelsResult = await serverPool.query(panelQuery, params)

  // Debug logging: panel query results
  void debugLog({
    component: 'IntentResolver',
    action: 'show_quick_links_panels_found',
    metadata: {
      panelCount: panelsResult.rows.length,
      badges: panelsResult.rows.map((p: { badge?: string }) => p.badge || 'none'),
      dashboardWorkspaceId,
      explicitBadgeFilter: quickLinksPanelBadge || null,
    },
  })

  if (panelsResult.rows.length === 0) {
    if (quickLinksPanelBadge) {
      return {
        success: false,
        action: 'error',
        message: `No Quick Links panel with badge "${quickLinksPanelBadge.toUpperCase()}" found.`,
      }
    }
    return {
      success: false,
      action: 'error',
      message: 'No Quick Links panels found in this entry.',
    }
  }

  // Per dynamic-typo-suggestions-fixes-plan.md:
  // When multiple panels exist and no specific badge requested, ALWAYS show selection.
  // Don't use lastQuickLinksBadge to auto-pick (that's only for "my last quick links").
  // This treats "quick links" as a collection, not a specific badge.
  const shouldDisambiguate = panelsResult.rows.length > 1 && !quickLinksPanelBadge

  // Debug logging: disambiguation decision
  void debugLog({
    component: 'IntentResolver',
    action: 'show_quick_links_disambiguation_decision',
    metadata: {
      panelCount: panelsResult.rows.length,
      hasExplicitBadge: !!quickLinksPanelBadge,
      shouldDisambiguate,
      reason: shouldDisambiguate
        ? 'multiple panels, no explicit badge'
        : panelsResult.rows.length === 1
          ? 'single panel'
          : 'explicit badge provided',
    },
  })

  if (shouldDisambiguate) {
    const panels = panelsResult.rows
    return {
      success: true,
      action: 'select',
      options: panels.map((p) => ({
        type: 'quick_links_panel' as const,
        id: p.id,
        label: `Quick Links ${p.badge || ''}`.trim(),
        sublabel: p.title || undefined,
        data: { panelId: p.id, badge: p.badge || '', panelType: 'quick_links' as const },
      })),
      message: `Found ${panels.length} Quick Links panels. Which one would you like to see?`,
    }
  }

  // Single panel found (or specific badge requested)
  const panel = panelsResult.rows[0]
  const panelTitle = panel.badge ? `Quick Links ${panel.badge}` : 'Quick Links'
  const badge = (panel.badge || 'a').toLowerCase()

  // If forcePreviewMode is set (user said "list", "preview", etc.),
  // redirect to panel_intent with mode='preview' for chat preview
  if (context.forcePreviewMode) {
    return resolvePanelIntent(
      {
        intent: 'panel_intent',
        args: {
          panelId: `quick-links-${badge}`,
          intentName: 'show_links',
          params: { mode: 'preview' },
        },
      },
      context
    )
  }

  // Default: open in drawer (Widget Architecture)
  return {
    success: true,
    action: 'open_panel_drawer',
    panelId: panel.id,
    panelTitle,
    // Semantic ID for action tracking (e.g., "quick-links-d")
    semanticPanelId: `quick-links-${badge}`,
    message: `Opening ${panelTitle}...`,
  }
}

/**
 * Resolve preview_file intent - preview a file in the view panel
 */
async function resolvePreviewFile(
  intent: IntentResponse,
  context: ResolutionContext
): Promise<IntentResolutionResult> {
  const { filePath } = intent.args

  if (!filePath) {
    return {
      success: false,
      action: 'error',
      message: 'Please specify a file path to preview.',
    }
  }

  // File preview is handled client-side via the file preview API
  // Here we just validate and prepare the view panel content structure

  const filename = filePath.split('/').pop() || filePath
  const ext = filename.split('.').pop()?.toLowerCase() || ''

  // Determine content type based on extension
  let contentType: ViewContentType
  let language: string | undefined

  if (['ts', 'tsx', 'js', 'jsx', 'py', 'go', 'rs', 'java', 'c', 'cpp'].includes(ext)) {
    contentType = ViewContentType.CODE
    language = ext
  } else if (ext === 'pdf') {
    contentType = ViewContentType.PDF
  } else if (['md', 'txt', 'json', 'yaml', 'yml'].includes(ext)) {
    contentType = ViewContentType.TEXT
  } else {
    contentType = ViewContentType.TEXT
  }

  const viewPanelContent: ViewPanelContent = {
    type: contentType,
    title: filename,
    subtitle: contentType === ViewContentType.CODE ? language : undefined,
    filename: filePath,
    language,
    sourceIntent: 'preview_file',
    // content will be fetched client-side via /api/chat/preview/file
  }

  return {
    success: true,
    action: 'show_view_panel',
    viewPanelContent,
    showInViewPanel: true,
    message: `Previewing ${filename}...`,
  }
}

// =============================================================================
// Phase 4: Hybrid Selection Follow-up Handlers
// =============================================================================

/**
 * Resolve select_option intent - LLM determined user wants to select from pending options
 * Returns optionIndex/optionLabel for client to map to pending options
 */
function resolveSelectOption(
  intent: IntentResponse
): IntentResolutionResult {
  const { optionIndex, optionLabel } = intent.args

  // At least one of optionIndex or optionLabel should be provided
  if (optionIndex === undefined && !optionLabel) {
    return {
      success: false,
      action: 'error',
      message: "I couldn't determine which option you meant. Please try again or click a pill.",
    }
  }

  return {
    success: true,
    action: 'select_option',
    optionIndex,
    optionLabel,
    message: 'Selecting option...',
  }
}

/**
 * Resolve reshow_options intent - user wants to see pending options again
 * The actual options are client-side state; this just signals the client to re-display them.
 */
function resolveReshowOptions(
  context: ResolutionContext
): IntentResolutionResult {
  // Check if there are pending options in context
  if (!context.pendingOptions || context.pendingOptions.length === 0) {
    return {
      success: false,
      action: 'error',
      message: 'No options to show. What would you like to do?',
    }
  }

  return {
    success: true,
    action: 'reshow_options',
    message: 'Here are your options:',
  }
}

/**
 * Resolve answer_from_context intent.
 * Per llm-chat-context-first-plan.md: pass through the LLM's answer as-is.
 * No side effects - just returns a message.
 */
function resolveAnswerFromContext(
  intent: IntentResponse
): IntentResolutionResult {
  const contextAnswer = intent.args.contextAnswer

  if (!contextAnswer) {
    return {
      success: false,
      action: 'error',
      message: "I don't have enough context to answer that. What would you like to do?",
    }
  }

  return {
    success: true,
    action: 'answer_from_context',
    message: contextAnswer,
  }
}

/**
 * Resolve need_context intent.
 * Per llm-context-retrieval-general-answers-plan.md:
 * The LLM needs more context to answer a question.
 * Server will fetch the requested context and re-call the LLM.
 */
function resolveNeedContext(
  intent: IntentResponse
): IntentResolutionResult {
  const contextRequest = intent.args.contextRequest

  if (!contextRequest) {
    return {
      success: false,
      action: 'error',
      message: "I'm not sure what additional context I need. Could you rephrase your question?",
    }
  }

  return {
    success: true,
    action: 'need_context',
    contextRequest,
    message: 'Fetching additional context...',
  }
}

/**
 * Resolve general_answer intent.
 * Per llm-context-retrieval-general-answers-plan.md:
 * Handle non-app questions (time, math, static knowledge).
 * - Time: Server will replace placeholder with actual server time
 * - Math: LLM computed the answer
 * - General: LLM provided static knowledge answer
 */
function resolveGeneralAnswer(
  intent: IntentResponse
): IntentResolutionResult {
  const { generalAnswer, answerType } = intent.args

  if (!generalAnswer) {
    return {
      success: false,
      action: 'error',
      message: "I couldn't compute an answer to that. Could you rephrase your question?",
    }
  }

  // For time questions, the server will replace the placeholder with actual time
  // For math and general, the LLM's answer is used directly
  return {
    success: true,
    action: 'general_answer',
    generalAnswerType: answerType || 'general',
    message: generalAnswer,
  }
}

// =============================================================================
// Phase 9: App Data Retrieval (DB Lookup)
// =============================================================================

/**
 * Resolve retrieve_from_app intent.
 * Per llm-layered-chat-experience-plan.md:
 * Query DB for entities (widgets, workspaces, notes, entries) not shown in chat.
 */
async function resolveRetrieveFromApp(
  intent: IntentResponse,
  context: ResolutionContext
): Promise<IntentResolutionResult> {
  const { entityType, entityQuery } = intent.args

  if (!entityType || !entityQuery) {
    return {
      success: false,
      action: 'error',
      message: "I'm not sure what you're looking for. Could you specify the type and name?",
    }
  }

  const userId = context.userId
  if (!userId) {
    return {
      success: false,
      action: 'error',
      message: "I couldn't determine your user context.",
    }
  }

  try {
    let result: { found: boolean; name?: string; count?: number }

    switch (entityType) {
      case 'widget': {
        // Search installed_widgets (Widget Manager) - the source of truth for widgets
        // Note: 'panels' is the legacy canvas table, not Widget Manager
        const widgetResult = await serverPool.query(
          `SELECT name, slug FROM installed_widgets
           WHERE (user_id = $1 OR user_id IS NULL)
             AND enabled = true
             AND (name ILIKE $2 OR slug ILIKE $2)
           ORDER BY
             CASE
               WHEN LOWER(name) = LOWER($3) THEN 0
               WHEN LOWER(slug) = LOWER($3) THEN 0
               ELSE 1
             END,
             updated_at DESC NULLS LAST
           LIMIT 5`,
          [userId, `%${entityQuery}%`, entityQuery]
        )
        if (widgetResult.rows.length > 0) {
          result = { found: true, name: widgetResult.rows[0].name, count: widgetResult.rows.length }
        } else {
          result = { found: false }
        }
        break
      }

      case 'workspace': {
        // Search note_workspaces - same table as workspace-resolver.ts uses
        // Matches the chat resolver's data source for consistency
        const currentEntryId = context.currentEntryId

        let wsResult
        if (currentEntryId) {
          // If in entry context, search within current entry first
          wsResult = await serverPool.query(
            `SELECT nw.id, nw.name, i.name as entry_name
             FROM note_workspaces nw
             LEFT JOIN items i ON nw.item_id = i.id AND i.deleted_at IS NULL
             WHERE nw.user_id = $1
               AND nw.item_id = $2
               AND nw.name ILIKE $3
             ORDER BY
               CASE WHEN LOWER(nw.name) = LOWER($4) THEN 0 ELSE 1 END,
               nw.updated_at DESC NULLS LAST
             LIMIT 5`,
            [userId, currentEntryId, `%${entityQuery}%`, entityQuery]
          )
        } else {
          // No entry context - search all user workspaces
          wsResult = await serverPool.query(
            `SELECT nw.id, nw.name, i.name as entry_name
             FROM note_workspaces nw
             LEFT JOIN items i ON nw.item_id = i.id AND i.deleted_at IS NULL
             WHERE nw.user_id = $1
               AND nw.name ILIKE $2
             ORDER BY
               CASE WHEN LOWER(nw.name) = LOWER($3) THEN 0 ELSE 1 END,
               nw.updated_at DESC NULLS LAST
             LIMIT 5`,
            [userId, `%${entityQuery}%`, entityQuery]
          )
        }

        if (wsResult.rows.length > 0) {
          const row = wsResult.rows[0]
          const entryInfo = row.entry_name ? ` (in ${row.entry_name})` : ''
          result = { found: true, name: `${row.name}${entryInfo}`, count: wsResult.rows.length }
        } else {
          result = { found: false }
        }
        break
      }

      case 'note': {
        // Search items table for notes
        const noteResult = await serverPool.query(
          `SELECT name, id FROM items
           WHERE user_id = $1
             AND type = 'note'
             AND deleted_at IS NULL
             AND name ILIKE $2
           LIMIT 5`,
          [userId, `%${entityQuery}%`]
        )
        if (noteResult.rows.length > 0) {
          result = { found: true, name: noteResult.rows[0].name, count: noteResult.rows.length }
        } else {
          result = { found: false }
        }
        break
      }

      case 'entry': {
        // Search items table for entries (folders)
        const entryResult = await serverPool.query(
          `SELECT name, id FROM items
           WHERE user_id = $1
             AND type = 'folder'
             AND deleted_at IS NULL
             AND name ILIKE $2
           LIMIT 5`,
          [userId, `%${entityQuery}%`]
        )
        if (entryResult.rows.length > 0) {
          result = { found: true, name: entryResult.rows[0].name, count: entryResult.rows.length }
        } else {
          result = { found: false }
        }
        break
      }

      default:
        return {
          success: false,
          action: 'error',
          message: `I don't know how to search for "${entityType}" entities.`,
        }
    }

    // Format response
    if (result.found) {
      const countNote = result.count && result.count > 1
        ? ` (found ${result.count} matches, showing "${result.name}")`
        : ''
      return {
        success: true,
        action: 'answer_from_context',
        message: `Yes, you have a ${entityType} called "${result.name}"${countNote}.`,
      }
    } else {
      return {
        success: true,
        action: 'answer_from_context',
        message: `I don't see a ${entityType} called "${entityQuery}" in your workspace.`,
      }
    }
  } catch (error) {
    console.error('[resolveRetrieveFromApp] DB error:', error)
    return {
      success: false,
      action: 'error',
      message: "I couldn't search for that right now. Please try again.",
    }
  }
}

// =============================================================================
// Phase 5: Hybrid Commands - Bare Name Resolution
// =============================================================================

/**
 * Resolve bare name input - check both entries and workspaces
 * Returns appropriate action based on matches:
 * - Single workspace match → navigate_workspace
 * - Single entry match → navigate_entry (to entry's dashboard)
 * - Multiple of same type → select (disambiguation)
 * - Both entry AND workspace → clarify_type (ask user)
 */
async function resolveBareName(
  intent: IntentResponse,
  context: ResolutionContext
): Promise<IntentResolutionResult> {
  const { name } = intent.args

  if (!name) {
    return {
      success: false,
      action: 'error',
      message: 'Please specify a name to search for.',
    }
  }

  // Search for workspaces matching the name
  const workspaceResult = await resolveWorkspace(name, context)

  // Search for entries matching the name (from items table)
  const entryResult = await resolveEntry(name, context)

  const hasWorkspaces = workspaceResult.status !== 'not_found'
  const hasEntries = entryResult.status !== 'not_found'

  // Case 1: No matches at all
  if (!hasWorkspaces && !hasEntries) {
    return {
      success: false,
      action: 'error',
      message: `No entry or workspace found matching "${name}".`,
    }
  }

  // Case 2: Only workspaces match
  if (hasWorkspaces && !hasEntries) {
    if (workspaceResult.status === 'found') {
      // Single workspace match - open directly
      return {
        success: true,
        action: 'navigate_workspace',
        workspace: workspaceResult.workspace,
        message: `Opening workspace "${workspaceResult.workspace!.name}"`,
      }
    } else {
      // Multiple workspace matches - disambiguate
      const matches = workspaceResult.matches!
      return {
        success: true,
        action: 'select',
        options: matches.map((w) => ({
          type: 'workspace' as const,
          id: w.id,
          label: w.name,
          sublabel: w.entryName,
          data: w,
        })),
        message: `Found ${matches.length} workspaces matching "${name}". Which one?`,
      }
    }
  }

  // Case 3: Only entries match
  if (!hasWorkspaces && hasEntries) {
    if (entryResult.status === 'found') {
      // Single entry match - navigate to entry's dashboard
      const entry = entryResult.entry!
      return {
        success: true,
        action: 'navigate_entry',
        entry,
        message: `Opening entry "${entry.name}"`,
      }
    } else {
      // Multiple entry matches - disambiguate
      const matches = entryResult.matches!
      return {
        success: true,
        action: 'select',
        options: matches.map((e) => ({
          type: 'entry' as const,
          id: e.id,
          label: e.name,
          sublabel: e.parentName,
          data: e,
        })),
        message: `Found ${matches.length} entries matching "${name}". Which one?`,
      }
    }
  }

  // Case 4: Both entry AND workspace match - ask user to clarify
  // Build options for the clarify_type action
  const options: Array<{
    type: 'workspace' | 'entry'
    id: string
    label: string
    sublabel?: string
    data: any
  }> = []

  // Add entry option(s)
  if (entryResult.status === 'found') {
    const entry = entryResult.entry!
    options.push({
      type: 'entry',
      id: entry.id,
      label: `Entry: ${entry.name}`,
      sublabel: entry.parentName || undefined,
      data: entry,
    })
  } else if (entryResult.matches) {
    // Multiple entries - add first one with count indicator
    const firstEntry = entryResult.matches[0]
    options.push({
      type: 'entry',
      id: firstEntry.id,
      label: `Entry: ${firstEntry.name}`,
      sublabel: entryResult.matches.length > 1
        ? `+${entryResult.matches.length - 1} more`
        : firstEntry.parentName || undefined,
      data: firstEntry,
    })
  }

  // Add workspace option(s)
  if (workspaceResult.status === 'found') {
    const ws = workspaceResult.workspace!
    options.push({
      type: 'workspace',
      id: ws.id,
      label: `Workspace: ${ws.name}`,
      sublabel: ws.entryName,
      data: ws,
    })
  } else if (workspaceResult.matches) {
    // Multiple workspaces - add first one with count indicator
    const firstWs = workspaceResult.matches[0]
    options.push({
      type: 'workspace',
      id: firstWs.id,
      label: `Workspace: ${firstWs.name}`,
      sublabel: workspaceResult.matches.length > 1
        ? `+${workspaceResult.matches.length - 1} more`
        : firstWs.entryName,
      data: firstWs,
    })
  }

  return {
    success: true,
    action: 'clarify_type',
    options,
    message: `Do you want the entry "${name}" or the workspace "${name}"?`,
  }
}

// =============================================================================
// Phase 6: Panel Intent Registry Handler
// =============================================================================

/**
 * Resolve panel_intent - dispatch to panel-specific handler via manifest
 */
async function resolvePanelIntent(
  intent: IntentResponse,
  context: ResolutionContext
): Promise<IntentResolutionResult> {
  const { panelId, intentName, params } = intent.args

  if (!panelId || !intentName) {
    return {
      success: false,
      action: 'error',
      message: 'Missing panel ID or intent name.',
    }
  }

  let resolvedIntentName = intentName
  let resolvedParams = params || {}

  // Deterministic fallback: if user asked to list/preview quick links and the LLM
  // returned an unknown intentName, coerce to show_links in preview mode.
  if (context.forcePreviewMode && panelId.startsWith('quick-links-') && intentName !== 'show_links') {
    resolvedIntentName = 'show_links'
    resolvedParams = {
      ...resolvedParams,
      mode: 'preview',
    }
  }

  // If the LLM returned open_link without a target, treat it as opening the panel.
  // This handles "open quick link <badge>" (singular) as panel open, not item open.
  if (
    panelId.startsWith('quick-links-') &&
    intentName === 'open_link' &&
    !resolvedParams?.name &&
    !resolvedParams?.position
  ) {
    resolvedIntentName = 'show_links'
  }

  const requestedMode = typeof resolvedParams?.mode === 'string' ? resolvedParams.mode : undefined

  // Check if this is a "show/open" intent that should open a drawer
  // Known patterns: recent + list_recent, quick-links-* + show_links
  // For unknown panelIds: treat "show" or "open" intents as drawer candidates
  // Use startsWith/includes for more lenient matching (e.g., "open_panel" matches "open")
  const isOpenIntent = ['show', 'open', 'list', 'view'].some(
    verb => resolvedIntentName.startsWith(verb) || resolvedIntentName.includes(verb)
  )
  const isKnownDrawerPattern =
    (panelId === 'recent' && resolvedIntentName === 'list_recent') ||
    (panelId.startsWith('quick-links-') && resolvedIntentName === 'show_links')

  // For unknown panelIds without manifests, try dynamic drawer resolution
  const isUnknownPanelId = panelId !== 'recent' && !panelId.startsWith('quick-links-')
  const isListDrawerCandidate = isKnownDrawerPattern || (isUnknownPanelId && isOpenIntent)

  // Resolve panel instance for drawer usage (current entry dashboard)
  type DrawerResolutionResult =
    | { status: 'found'; panelId: string; panelTitle: string; semanticPanelId: string }
    | { status: 'confirm'; panelId: string; panelTitle: string; panelType: string; semanticPanelId: string }
    | { status: 'multiple'; panels: Array<{ id: string; title: string; panel_type: string }> }
    | { status: 'not_found' }

  const resolveDrawerPanelTarget = async (): Promise<DrawerResolutionResult> => {
    if (!context.currentEntryId) return { status: 'not_found' }

    const dashboardResult = await serverPool.query(
      `SELECT id FROM note_workspaces
       WHERE item_id = $1 AND user_id = $2 AND is_default = true
       LIMIT 1`,
      [context.currentEntryId, context.userId]
    )

    if (dashboardResult.rows.length === 0) return { status: 'not_found' }

    const dashboardWorkspaceId = dashboardResult.rows[0].id

    if (panelId === 'recent') {
      const recentResult = await serverPool.query(
        `SELECT id, title
         FROM workspace_panels
         WHERE workspace_id = $1
           AND panel_type = 'recent'
           AND deleted_at IS NULL
         ORDER BY created_at ASC
         LIMIT 1`,
        [dashboardWorkspaceId]
      )

      if (recentResult.rows.length === 0) return { status: 'not_found' }

      return {
        status: 'found' as const,
        panelId: recentResult.rows[0].id,
        panelTitle: recentResult.rows[0].title || 'Recent',
        semanticPanelId: 'recent',
      }
    }

    if (panelId === 'quick-links' || panelId.startsWith('quick-links-')) {
      const badge = panelId === 'quick-links' ? null : panelId.replace('quick-links-', '')

      // If no badge specified, get all Quick Links panels for disambiguation
      if (!badge) {
        const allQuickLinksResult = await serverPool.query(
          `SELECT id, title, badge, panel_type
           FROM workspace_panels
           WHERE workspace_id = $1
             AND panel_type IN ('links_note', 'links_note_tiptap')
             AND deleted_at IS NULL
           ORDER BY badge ASC, created_at ASC`,
          [dashboardWorkspaceId]
        )

        if (allQuickLinksResult.rows.length === 0) return { status: 'not_found' }

        if (allQuickLinksResult.rows.length === 1) {
          const row = allQuickLinksResult.rows[0]
          const panelTitle = row.badge ? `Quick Links ${row.badge.toUpperCase()}` : (row.title || 'Quick Links')
          return {
            status: 'found' as const,
            panelId: row.id,
            panelTitle,
            semanticPanelId: `quick-links-${row.badge?.toLowerCase() || 'd'}`,
          }
        }

        // Multiple Quick Links → disambiguation
        return {
          status: 'multiple' as const,
          panels: allQuickLinksResult.rows.map((r: { id: string; title: string; badge: string; panel_type: string }) => ({
            id: r.id,
            title: r.badge ? `Quick Links ${r.badge.toUpperCase()}` : (r.title || 'Quick Links'),
            panel_type: r.panel_type,
          })),
        }
      }

      // Badge specified - find specific Quick Links panel
      const quickLinksResult = await serverPool.query(
        `SELECT id, title, badge
         FROM workspace_panels
         WHERE workspace_id = $1
           AND panel_type IN ('links_note', 'links_note_tiptap')
           AND UPPER(badge) = UPPER($2)
           AND deleted_at IS NULL
         ORDER BY created_at ASC
         LIMIT 1`,
        [dashboardWorkspaceId, badge]
      )

      if (quickLinksResult.rows.length === 0) return { status: 'not_found' }

      const row = quickLinksResult.rows[0]
      const panelTitle = row.badge ? `Quick Links ${row.badge.toUpperCase()}` : (row.title || 'Quick Links')

      return {
        status: 'found' as const,
        panelId: row.id,
        panelTitle,
        semanticPanelId: `quick-links-${row.badge?.toLowerCase() || 'd'}`,
      }
    }

    // Dynamic fallback: Production-style prioritized matching (Ambiguity Guard)
    // Step 0: Exact visibleWidgets match wins (uses known panel ID from context)
    // Step 1: Exact panel_type match
    // Step 2: Exact title match (case-insensitive)
    // Step 3: Multiple matches → return 'multiple' for disambiguation
    // Step 4: Fuzzy match only if it yields exactly one result

    // Helper: Normalize by sorting tokens for word-order-invariant matching (Step 0b only)
    // Strips minimal stopwords (my/your/the/a/an) to handle "open my recent" → "recent"
    // "widget demo" → "demo widget", "my recent" → "recent", "Demo Widget" → "demo widget"
    const PANEL_STOPWORDS = new Set(['my', 'your', 'the', 'a', 'an'])
    const normalizeWithSortedTokens = (s: string) =>
      s.toLowerCase()
       .replace(/[^a-z0-9\s]/g, '')
       .split(/\s+/)
       .filter(t => t && !PANEL_STOPWORDS.has(t))
       .sort()
       .join(' ')

    // Step 0: Check visibleWidgets for exact title match (no DB query needed)
    if (context.visibleWidgets && context.visibleWidgets.length > 0) {
      const normalizedPanelId = panelId.toLowerCase().replace(/-/g, ' ')

      // Step 0a: Exact match (original logic)
      const exactMatch = context.visibleWidgets.find(
        (w) => w.title.toLowerCase() === normalizedPanelId ||
               w.title.toLowerCase().replace(/[^a-z0-9]/g, '') === panelId.toLowerCase().replace(/[^a-z0-9]/g, '')
      )
      if (exactMatch) {
        return {
          status: 'found' as const,
          panelId: exactMatch.id,
          panelTitle: exactMatch.title,
          semanticPanelId: panelId,
        }
      }

      // Step 0b: Word-order-invariant match (handles "widget demo" → "Demo Widget")
      // Only auto-open if exactly ONE widget matches; otherwise fall through to disambiguation
      const sortedPanelId = normalizeWithSortedTokens(panelId)
      const tokenMatches = context.visibleWidgets.filter(
        (w) => normalizeWithSortedTokens(w.title) === sortedPanelId
      )
      if (tokenMatches.length === 1) {
        return {
          status: 'found' as const,
          panelId: tokenMatches[0].id,
          panelTitle: tokenMatches[0].title,
          semanticPanelId: panelId,
        }
      }
      // If multiple token-matches, fall through to DB-based disambiguation
    }

    // Step 1: Exact panel_type match
    const normalizedPanelType = panelId.replace(/-/g, '_').toLowerCase()

    // Helper: Format panel title with badge if available (for Quick Links disambiguation)
    const formatPanelTitle = (row: { title: string; badge?: string; panel_type: string }) => {
      if (row.badge && (row.panel_type === 'links_note' || row.panel_type === 'links_note_tiptap')) {
        return `Quick Links ${row.badge.toUpperCase()}`
      }
      return row.title || panelId
    }

    // Step 1: Try exact panel_type match
    const exactTypeResult = await serverPool.query(
      `SELECT id, title, panel_type, badge
       FROM workspace_panels
       WHERE workspace_id = $1
         AND deleted_at IS NULL
         AND panel_type = $2`,
      [dashboardWorkspaceId, normalizedPanelType]
    )

    if (exactTypeResult.rows.length === 1) {
      const row = exactTypeResult.rows[0]
      return {
        status: 'found' as const,
        panelId: row.id,
        panelTitle: formatPanelTitle(row),
        semanticPanelId: panelId,
      }
    }

    if (exactTypeResult.rows.length > 1) {
      return {
        status: 'multiple' as const,
        panels: exactTypeResult.rows.map((r: { id: string; title: string; badge?: string; panel_type: string }) => ({
          id: r.id,
          title: formatPanelTitle(r),
          panel_type: r.panel_type,
        })),
      }
    }

    // Step 2: Try exact title match (case-insensitive)
    const exactTitleResult = await serverPool.query(
      `SELECT id, title, panel_type, badge
       FROM workspace_panels
       WHERE workspace_id = $1
         AND deleted_at IS NULL
         AND LOWER(title) = LOWER($2)`,
      [dashboardWorkspaceId, panelId]
    )

    if (exactTitleResult.rows.length === 1) {
      const row = exactTitleResult.rows[0]
      return {
        status: 'found' as const,
        panelId: row.id,
        panelTitle: formatPanelTitle(row),
        semanticPanelId: panelId,
      }
    }

    if (exactTitleResult.rows.length > 1) {
      return {
        status: 'multiple' as const,
        panels: exactTitleResult.rows.map((r: { id: string; title: string; badge?: string; panel_type: string }) => ({
          id: r.id,
          title: formatPanelTitle(r),
          panel_type: r.panel_type,
        })),
      }
    }

    // Step 3: Fuzzy match - requires confirmation (never auto-open)
    const fuzzyResult = await serverPool.query(
      `SELECT id, title, panel_type, badge
       FROM workspace_panels
       WHERE workspace_id = $1
         AND deleted_at IS NULL
         AND title ILIKE $2`,
      [dashboardWorkspaceId, `%${panelId}%`]
    )

    if (fuzzyResult.rows.length === 1) {
      // Single fuzzy match: show confirm pill ("Did you mean X?")
      const row = fuzzyResult.rows[0]
      return {
        status: 'confirm' as const,
        panelId: row.id,
        panelTitle: formatPanelTitle(row),
        panelType: row.panel_type,
        semanticPanelId: panelId,
      }
    }

    if (fuzzyResult.rows.length > 1) {
      // Multiple fuzzy matches: show disambiguation pills
      return {
        status: 'multiple' as const,
        panels: fuzzyResult.rows.map((r: { id: string; title: string; badge?: string; panel_type: string }) => ({
          id: r.id,
          title: formatPanelTitle(r),
          panel_type: r.panel_type,
        })),
      }
    }

    return { status: 'not_found' as const }
  }

  // Default to drawer for list-style panel intents unless:
  // - explicitly previewed (mode === 'preview'), OR
  // - forcePreviewMode is set (user said "list", "preview", "in the chatbox", etc.)
  const shouldOpenDrawer = isListDrawerCandidate &&
    requestedMode !== 'preview' &&
    !context.forcePreviewMode

  if (shouldOpenDrawer) {
    const drawerResult = await resolveDrawerPanelTarget()

    if (drawerResult.status === 'found') {
      return {
        success: true,
        action: 'open_panel_drawer',
        panelId: drawerResult.panelId,
        panelTitle: drawerResult.panelTitle,
        semanticPanelId: drawerResult.semanticPanelId,
        message: `Opening ${drawerResult.panelTitle}...`,
      }
    }

    if (drawerResult.status === 'confirm') {
      // Single fuzzy match - show confirm pill ("Did you mean X?")
      return {
        success: true,
        action: 'select',
        options: [{
          type: 'panel_drawer' as const,
          id: drawerResult.panelId,
          label: drawerResult.panelTitle,
          sublabel: drawerResult.panelType,
          data: { panelId: drawerResult.panelId, panelTitle: drawerResult.panelTitle, panelType: drawerResult.panelType },
        }],
        message: `Did you mean "${drawerResult.panelTitle}"?`,
      }
    }

    if (drawerResult.status === 'multiple') {
      // Multiple panels match - show disambiguation pills
      return {
        success: true,
        action: 'select',
        options: drawerResult.panels.map((p: { id: string; title: string; panel_type: string }) => ({
          type: 'panel_drawer' as const, // Panel drawer type for proper handling
          id: p.id,
          label: p.title,
          sublabel: p.panel_type,
          data: { panelId: p.id, panelTitle: p.title, panelType: p.panel_type },
        })),
        message: `Multiple panels match "${panelId}". Which one would you like to open?`,
      }
    }

    // status === 'not_found' - fall through to panel registry
  }

  // Check if this is a write intent that needs confirmation
  const match = panelRegistry.findIntent({
    panelId,
    intentName: resolvedIntentName,
    params: resolvedParams || {},
  })

  if (match && match.intent.permission === 'write') {
    // Check if confirmation is bypassed (user already confirmed)
    const isBypassed = context.bypassPanelWriteConfirmation &&
      context.pendingPanelIntent?.panelId === panelId &&
      context.pendingPanelIntent?.intentName === intentName

    if (!isBypassed) {
      // Return confirmation request
      return {
        success: true,
        action: 'confirm_panel_write',
      pendingPanelIntent: {
        panelId,
        intentName: resolvedIntentName,
        params: resolvedParams || {},
      },
      options: [
        {
          type: 'confirm_panel_write' as const,
          id: 'confirm',
          label: '✓ Confirm',
          sublabel: match.intent.description,
          data: { panelId, intentName: resolvedIntentName, params: resolvedParams || {} },
        },
      ],
      message: `This action will modify data: "${match.intent.description}". Continue?`,
    }
  }
  }

  // Execute the panel intent via the registry
  const result = await executePanelIntent({
    panelId,
    intentName: resolvedIntentName,
    params: resolvedParams || {},
  })

  if (!result.success) {
    // Fallback: If panel intent fails for Recent panel, open drawer instead of showing error
    // This handles "open my recent" being routed to panel_intent with unsupported action
    if (panelId === 'recent') {
      const drawerFallback = await resolveDrawerPanelTarget()
      if (drawerFallback.status === 'found') {
        return {
          success: true,
          action: 'open_panel_drawer',
          panelId: drawerFallback.panelId,
          panelTitle: drawerFallback.panelTitle,
          semanticPanelId: drawerFallback.semanticPanelId,
          message: `Opening ${drawerFallback.panelTitle}...`,
        }
      }
    }

    return {
      success: false,
      action: 'error',
      message: result.message || result.error || 'Panel action failed.',
    }
  }

  // Handle different result types from panel handlers
  if (result.items && Array.isArray(result.items)) {
    const drawerResult = isListDrawerCandidate ? await resolveDrawerPanelTarget() : null
    const resolvedPanelId = drawerResult?.status === 'found' ? drawerResult.panelId : undefined
    const resolvedPanelTitle = drawerResult?.status === 'found' ? drawerResult.panelTitle : undefined

    // Transform panel items to ViewListItem format
    const viewItems: ViewListItem[] = result.items.map(item => ({
      id: item.id,
      name: item.title ?? item.name ?? item.id,
      type: (item.type === 'link' || item.type === 'note' || item.type === 'entry' ||
             item.type === 'workspace' || item.type === 'file')
        ? item.type
        : 'note' as const,
      meta: item.subtitle ?? item.meta,
      isSelectable: item.isSelectable,
      entryId: item.entryId,
      workspaceId: item.workspaceId,
      dashboardId: item.dashboardId,
      filePath: item.filePath,
    }))

    // Panel returned a list of items - show in view panel
    return {
      success: true,
      action: 'show_view_panel',
      panelId: resolvedPanelId,
      panelTitle: resolvedPanelTitle,
      viewPanelContent: {
        type: ViewContentType.MIXED_LIST,
        title: result.title || `${panelId} results`,
        subtitle: result.subtitle,
        items: viewItems,
        sourceIntent: 'panel_intent',
      },
      showInViewPanel: result.showInViewPanel ?? false,
      previewItems: viewItems.slice(0, 3),
      totalCount: viewItems.length,
      message: result.message || `Found ${viewItems.length} items`,
    }
  }

  if (result.navigateTo) {
    // Panel wants to trigger navigation
    const nav = result.navigateTo
    if (nav.type === 'workspace') {
      return {
        success: true,
        action: 'navigate_workspace',
        workspace: {
          id: nav.id,
          name: nav.name,
          entryId: nav.entryId || '',
          entryName: nav.entryName || '',
          isDefault: false,
        },
        message: result.message || `Opening ${nav.name}`,
      }
    } else if (nav.type === 'entry') {
      return {
        success: true,
        action: 'navigate_entry',
        entry: {
          id: nav.id,
          name: nav.name,
          parentId: nav.parentId,
          parentName: nav.parentName,
          isSystem: false,
        },
        message: result.message || `Opening ${nav.name}`,
      }
    }
  }

  // Default: just inform
  return {
    success: true,
    action: 'inform',
    message: result.message || 'Action completed.',
  }
}
