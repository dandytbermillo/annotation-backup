/**
 * Chat Navigation Intent Schema
 *
 * Defines the strict schema for LLM intent parsing.
 * The LLM can only return these predefined intents with validated arguments.
 */

import { z } from 'zod'

// =============================================================================
// Intent Types
// =============================================================================

export const IntentType = z.enum([
  'open_workspace',
  'open_recent_workspace',
  'open_note',
  'create_workspace',
  // Phase 1: Workspace Operations (current entry only)
  'list_workspaces',
  'go_to_dashboard',
  'go_home',  // Navigate to Home entry's dashboard (cross-entry)
  'rename_workspace',
  'delete_workspace',
  // Phase 2: Informational Intents (answer questions from session state)
  'location_info',
  'last_action',
  'session_stats',
  'verify_action',
  // Phase 3: View Panel Content Intents
  'show_quick_links',
  'preview_file',
  // Phase 4: Hybrid Selection Follow-up
  'select_option',  // User selects from pending options via natural language
  // Phase 5: Hybrid Commands - bare name resolution
  'resolve_name',   // Bare name input - resolve to entry or workspace
  'unsupported',
])

export type IntentType = z.infer<typeof IntentType>

// =============================================================================
// Intent Arguments
// =============================================================================

export const IntentArgs = z.object({
  // For open_workspace: the workspace name to search for
  workspaceName: z.string().optional(),

  // For open_workspace/open_note: optional entry name to scope the search
  entryName: z.string().optional(),

  // For open_note: the note title to search for
  noteTitle: z.string().optional(),

  // For create_workspace: the name for the new workspace
  newWorkspaceName: z.string().optional(),

  // For rename_workspace: the new name to rename to
  newName: z.string().optional(),

  // For session_stats: optional workspace name to query stats for
  statsWorkspaceName: z.string().optional(),

  // For verify_action: verify if a specific action was performed
  verifyActionType: z.enum(['open_workspace', 'rename_workspace', 'delete_workspace', 'create_workspace', 'go_to_dashboard']).optional(),
  verifyWorkspaceName: z.string().optional(),  // workspace name to verify
  verifyFromName: z.string().optional(),       // for rename: original name
  verifyToName: z.string().optional(),         // for rename: new name

  // For show_quick_links: panel badge (A, B, C, etc.) or panel title
  quickLinksPanelBadge: z.string().optional(),
  quickLinksPanelTitle: z.string().optional(),

  // For preview_file: file path to preview
  filePath: z.string().optional(),

  // For select_option: select from pending disambiguation options
  optionIndex: z.number().optional(),  // 1-based index of the option to select
  optionLabel: z.string().optional(),  // label of the option to select (fallback)

  // For resolve_name: bare name to resolve (entry or workspace)
  name: z.string().optional(),

  // For unsupported: brief reason why the request is not supported
  reason: z.string().optional(),
})

export type IntentArgs = z.infer<typeof IntentArgs>

// =============================================================================
// Complete Intent Response
// =============================================================================

export const IntentResponse = z.object({
  intent: IntentType,
  args: IntentArgs,
})

export type IntentResponse = z.infer<typeof IntentResponse>

// =============================================================================
// Validation Helper
// =============================================================================

/**
 * Parse and validate an intent response from the LLM.
 * Returns a validated IntentResponse or falls back to 'unsupported'.
 */
export function parseIntentResponse(raw: unknown): IntentResponse {
  try {
    const parsed = IntentResponse.parse(raw)
    return parsed
  } catch {
    // Any parsing error → unsupported intent
    return {
      intent: 'unsupported',
      args: {
        reason: 'Failed to parse LLM response',
      },
    }
  }
}

// =============================================================================
// Supported Actions (for user feedback)
// =============================================================================

export const SUPPORTED_ACTIONS = [
  'open workspace by name',
  'open recent workspace',
  'open note by title',
  'open entry or workspace by name',
  'create workspace',
  'list workspaces',
  'go to dashboard',
  'go home',
  'rename workspace',
  'delete workspace',
  'ask where I am',
  'ask what I just did',
  'ask session stats',
  'verify recent action',
  'show quick links',
  'preview file',
  'select from options',
] as const

export const SUPPORTED_ACTIONS_TEXT = SUPPORTED_ACTIONS.join(', ')
