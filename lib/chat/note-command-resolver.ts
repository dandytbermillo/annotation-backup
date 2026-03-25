/**
 * Generic Note Command Resolver
 *
 * Maps user input + note context into a ResolvedNoteCommand.
 * Owns note-surface interpretation — deterministic patterns first,
 * optional intentHint (from LLM/arbiter) as fallback.
 *
 * This resolver does NOT:
 * - Do actual note DB lookups (that's the executor's job)
 * - Replace the cross-surface arbiter (arbiter is a hint source, not a dependency)
 * - Handle duplicate-title disambiguation (deferred to executor/Phase 3)
 */

import {
  findManifestEntry,
  getManifestVersion,
  type ResolvedNoteCommand,
} from './note-command-manifest'

// =============================================================================
// Input Types
// =============================================================================

export interface NoteResolverInput {
  userInput: string
  noteContext: {
    activeNoteId?: string
    activeNoteTitle?: string
    openNotes?: Array<{ id: string; title?: string }>
    currentWorkspaceId?: string
    currentEntryId?: string
  }
  /** Optional: pre-classified intent from LLM/arbiter when available */
  intentHint?: {
    intentFamily?: string
    noteTitle?: string
    entryName?: string
  }
}

// =============================================================================
// Deterministic Note-Surface Detection
// =============================================================================

/** Patterns for note state-info queries (singular and plural) */
const NOTE_STATE_PATTERNS = [
  /\b(?:which|what)\s+notes?\s+(?:is|are)\s+(?:open|active|current)\b/i,
  /\bwhat\s+note\s+am\s+I\s+in\b/i,
  /\bwhat\s+is\s+the\s+(?:current|active|open)\s+note\b/i,
  /\bwhat\s+note\s+is\s+this\b/i,
]

/** Pattern for note navigation commands — extracts title */
const NOTE_NAVIGATE_PATTERN = /\b(?:open|find|go\s+to)\s+(?:the\s+)?note\s+(?:called\s+)?(.+?)$/i

/**
 * Detect if the input is a note state-info query.
 */
function detectNoteStateInfo(input: string): boolean {
  return NOTE_STATE_PATTERNS.some(p => p.test(input))
}

/**
 * Detect if the input is a note navigation command and extract the title.
 * Returns the extracted title or null.
 */
function extractNoteNavigateTitle(input: string): string | null {
  const match = input.match(NOTE_NAVIGATE_PATTERN)
  if (!match) return null
  const title = match[1].trim()
  if (title.length < 1) return null
  // Minimal guardrails — reject noisy tails for deterministic bypass safety
  if (title.length > 80) return null                    // overly long extraction
  if (/[?!]/.test(title)) return null                   // question/exclamation → not a clean command
  if (/\bplease\b|\bthanks?\b/i.test(title)) return null // trailing politeness
  if (/\bin\s+\w/i.test(title)) return null             // scoped variant: "in Budget" → fall through to LLM
  if (/\bfrom\s+\w/i.test(title)) return null           // scoped: "from entry Y"
  if (/\band\s+/i.test(title)) return null              // compound: "and also..."
  if (/\bthen\s+/i.test(title)) return null             // sequential: "then do..."
  return title
}

// =============================================================================
// Generic Resolver
// =============================================================================

/**
 * Resolve a note-targeted user input into a structured ResolvedNoteCommand.
 *
 * Returns null if the input is not recognized as a note command.
 *
 * Resolution priority:
 * 1. Deterministic pattern matching (highest confidence)
 * 2. intentHint fallback (from LLM/arbiter, medium confidence)
 */
export function resolveNoteCommand(params: NoteResolverInput): ResolvedNoteCommand | null {
  const { userInput, noteContext, intentHint } = params
  const trimmed = userInput.trim()

  // --- Priority 1: Deterministic state_info detection ---
  if (detectNoteStateInfo(trimmed)) {
    const entry = findManifestEntry('state_info', 'active_note')
    if (!entry) return null

    return {
      surface: 'note',
      manifestVersion: getManifestVersion(),
      intentFamily: 'state_info',
      intentSubtype: 'active_note',
      noteAnchor: {
        source: 'active_note',
        noteId: noteContext.activeNoteId,
        isValidated: false, // live resolver will validate
      },
      selectorMode: 'contextual',
      arguments: {},
      confidence: 'high',
      executionPolicy: entry.executionPolicy,
      replayPolicy: entry.replayPolicy,
      clarificationPolicy: entry.clarificationPolicy,
      handlerId: entry.handlerId,
    }
  }

  // --- Priority 2: Deterministic navigate detection ---
  const extractedTitle = extractNoteNavigateTitle(trimmed)
  if (extractedTitle) {
    const entry = findManifestEntry('navigate', 'open_note')
    if (!entry) return null

    return {
      surface: 'note',
      manifestVersion: getManifestVersion(),
      intentFamily: 'navigate',
      intentSubtype: 'open_note',
      noteAnchor: {
        source: 'explicit_note',
        isValidated: false, // executor will resolve + validate
      },
      targetScope: {
        workspaceId: noteContext.currentWorkspaceId,
        entryId: noteContext.currentEntryId,
      },
      selectorMode: 'explicit',
      arguments: { noteTitle: extractedTitle },
      confidence: 'high',
      executionPolicy: entry.executionPolicy,
      replayPolicy: entry.replayPolicy,
      clarificationPolicy: entry.clarificationPolicy,
      handlerId: entry.handlerId,
    }
  }

  // --- Priority 3: intentHint fallback ---
  if (intentHint?.intentFamily === 'navigate' && intentHint.noteTitle) {
    const entry = findManifestEntry('navigate', 'open_note')
    if (!entry) return null

    return {
      surface: 'note',
      manifestVersion: getManifestVersion(),
      intentFamily: 'navigate',
      intentSubtype: 'open_note',
      noteAnchor: {
        source: 'explicit_note',
        isValidated: false,
      },
      targetScope: {
        workspaceId: noteContext.currentWorkspaceId,
        entryId: noteContext.currentEntryId,
      },
      selectorMode: 'explicit',
      arguments: {
        noteTitle: intentHint.noteTitle,
        ...(intentHint.entryName ? { entryName: intentHint.entryName } : {}),
      },
      confidence: 'medium', // from hint, not deterministic
      executionPolicy: entry.executionPolicy,
      replayPolicy: entry.replayPolicy,
      clarificationPolicy: entry.clarificationPolicy,
      handlerId: entry.handlerId,
    }
  }

  if (intentHint?.intentFamily === 'state_info') {
    const entry = findManifestEntry('state_info', 'active_note')
    if (!entry) return null

    return {
      surface: 'note',
      manifestVersion: getManifestVersion(),
      intentFamily: 'state_info',
      intentSubtype: 'active_note',
      noteAnchor: {
        source: 'active_note',
        noteId: noteContext.activeNoteId,
        isValidated: false,
      },
      selectorMode: 'contextual',
      arguments: {},
      confidence: 'medium', // from hint
      executionPolicy: entry.executionPolicy,
      replayPolicy: entry.replayPolicy,
      clarificationPolicy: entry.clarificationPolicy,
      handlerId: entry.handlerId,
    }
  }

  // Not recognized as a note command
  return null
}
