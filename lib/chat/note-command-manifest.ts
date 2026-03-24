/**
 * Note Command Manifest
 *
 * Static contract for note command families and their execution policies.
 * This is the note-surface equivalent of the panel manifest registry —
 * it defines what note commands exist, not how they're phrased.
 *
 * The manifest is consumed by:
 * - Generic note resolver (maps user input → ResolvedNoteCommand)
 * - Executor (dispatches by policy)
 * - Memory/cache layer (validates replay against manifest version)
 *
 * This module does NOT:
 * - Move notes into the panel registry
 * - Enumerate every possible raw note phrasing
 * - Replace Stage 6 content answering
 */

// =============================================================================
// Policy Enums
// =============================================================================

export type NoteIntentFamily = 'state_info' | 'navigate' | 'read' | 'capability' | 'mutate'

export type NoteExecutionPolicy =
  | 'live_state_resolve'
  | 'open_note_in_current_workspace'
  | 'navigate_to_note_workspace'
  | 'stage6_grounded_answer'
  | 'bounded_capability_answer'
  | 'confirm_then_mutate'
  | 'blocked'

export type NoteReplayPolicy =
  | 'cache_resolution_only'
  | 'safe_with_revalidation'
  | 'never_direct_replay'

export type NoteClarificationPolicy =
  | 'clarify_on_ambiguous_target'
  | 'clarify_on_low_confidence'
  | 'clarify_target_workspace'
  | 'no_clarification'

// =============================================================================
// Manifest Entry Type
// =============================================================================

export interface NoteCommandManifestEntry {
  surface: 'note'
  manifestVersion: string
  intentFamily: NoteIntentFamily
  intentSubtype: string
  examples: string[]
  requiredArguments?: string[]
  optionalArguments?: string[]
  anchorRequirements?: {
    allowActiveNote?: boolean
    allowResolvedReference?: boolean
    allowFollowupAnchor?: boolean
    requireSpecificTarget?: boolean
  }
  selectorMode: 'explicit' | 'contextual' | 'either'
  executionPolicy: NoteExecutionPolicy
  replayPolicy: NoteReplayPolicy
  clarificationPolicy: NoteClarificationPolicy
  safetyRules: string[]
  handlerId: string
}

// =============================================================================
// Manifest Version
// =============================================================================

export const NOTE_MANIFEST_VERSION = '1.1'

// =============================================================================
// Seed Manifest Entries
// =============================================================================

export const NOTE_COMMAND_MANIFEST: NoteCommandManifestEntry[] = [
  {
    surface: 'note',
    manifestVersion: NOTE_MANIFEST_VERSION,
    intentFamily: 'state_info',
    intentSubtype: 'active_note',
    examples: [
      'which note is open?',
      'what note am I in?',
      'what is the current note?',
      'what note is this?',
    ],
    selectorMode: 'contextual',
    executionPolicy: 'live_state_resolve',
    replayPolicy: 'cache_resolution_only',
    clarificationPolicy: 'no_clarification',
    anchorRequirements: { allowActiveNote: true },
    safetyRules: ['always_re_resolve_live_state', 'never_cache_answer_text'],
    handlerId: 'note_state_info_resolver',
  },
  {
    surface: 'note',
    manifestVersion: NOTE_MANIFEST_VERSION,
    intentFamily: 'navigate',
    intentSubtype: 'open_note',
    examples: [
      'open note Project Plan',
      'find note Roadmap',
      'go to note Budget',
      'open the note called Meeting Notes',
    ],
    requiredArguments: ['noteTitle'],
    optionalArguments: ['entryName'],
    selectorMode: 'explicit',
    executionPolicy: 'open_note_in_current_workspace',
    replayPolicy: 'safe_with_revalidation',
    clarificationPolicy: 'clarify_on_ambiguous_target',
    anchorRequirements: { allowResolvedReference: true, requireSpecificTarget: true },
    safetyRules: ['validate_note_exists', 'clarify_on_multiple_matches'],
    handlerId: 'note_navigate_resolver',
  },
]

// =============================================================================
// Lookup Helpers
// =============================================================================

/**
 * Find a manifest entry by family and subtype.
 */
export function findManifestEntry(
  family: NoteIntentFamily,
  subtype: string,
): NoteCommandManifestEntry | undefined {
  return NOTE_COMMAND_MANIFEST.find(
    entry => entry.intentFamily === family && entry.intentSubtype === subtype
  )
}

/**
 * Get the current manifest version.
 */
export function getManifestVersion(): string {
  return NOTE_MANIFEST_VERSION
}

// =============================================================================
// Resolved Note Command Schema
// =============================================================================

/**
 * The normalized output of the generic note resolver.
 * This is the durable contract between resolver, executor, memory, and validator.
 */
export interface ResolvedNoteCommand {
  surface: 'note'
  manifestVersion: string
  intentFamily: NoteIntentFamily
  intentSubtype: string
  noteAnchor: {
    source: 'active_note' | 'resolved_reference' | 'followup_anchor' | 'explicit_note'
    noteId?: string
    isValidated: boolean
  }
  targetScope?: {
    workspaceId?: string
    entryId?: string
  }
  selectorMode: 'explicit' | 'contextual'
  arguments: Record<string, string | string[] | boolean | null>
  confidence: 'high' | 'medium' | 'low'
  executionPolicy: NoteExecutionPolicy
  replayPolicy: NoteReplayPolicy
  clarificationPolicy: NoteClarificationPolicy
  handlerId: string
}
