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
  'rename_workspace',
  'delete_workspace',
  // Phase 2: Informational Intents (answer questions from session state)
  'location_info',
  'last_action',
  'session_stats',
  'verify_action',
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
  'create workspace',
  'list workspaces',
  'go to dashboard',
  'rename workspace',
  'delete workspace',
  'ask where I am',
  'ask what I just did',
  'ask session stats',
  'verify recent action',
] as const

export const SUPPORTED_ACTIONS_TEXT = SUPPORTED_ACTIONS.join(', ')
