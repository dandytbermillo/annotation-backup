/**
 * Universal Selection Context
 *
 * Centralizes all selection state management for options/clarifiers.
 * This is the ONLY way to register or clear selection state.
 *
 * Per universal-selection-context plan:
 * - All option-creating paths use registerSelectionContext()
 * - All clearing paths use clearSelectionContext()
 * - Follow-up resolution reads from the registered context
 *
 * State pieces managed atomically:
 * - pendingOptions: The options array with full data
 * - pendingOptionsMessageId: Links to activeOptionSetId for Tier 3a binding
 * - pendingOptionsGraceCount: Expiration window counter
 * - lastClarification: Clarification state for intercept handling
 * - lastOptionsShown: Soft-active 2-turn TTL window
 */

import type { PendingOptionState, LastClarificationState, ClarificationOption } from './chat-navigation-context'

// =============================================================================
// Types
// =============================================================================

/**
 * Source identifiers for where options originate.
 * Used for debugging and analytics.
 */
export type SelectionContextSource =
  | 'grounding_clarifier'      // Tier 4.5 grounding-set fallback
  | 'reshow_options'           // User requested "show options"
  | 'known_noun_fuzzy'         // Tier 4 fuzzy known-noun match
  | 'widget_clarifier'         // Widget item disambiguation
  | 'panel_disambig'           // Panel disambiguation
  | 'doc_disambiguation'       // Document disambiguation
  | 'workspace_clarifier'      // Workspace picker
  | 'cross_corpus_clarifier'   // Cross-corpus retrieval
  | 'post_action_options'      // API response with new options
  | 'meta_explain_disambig'    // Meta-explain disambiguation

/**
 * Configuration for registering a selection context.
 */
export interface RegisterSelectionContextConfig {
  /** The options to register (with full data for execution) */
  options: PendingOptionState[]

  /** Message ID that displays these options (becomes activeOptionSetId) */
  messageId: string

  /** Where these options originate from */
  source: SelectionContextSource

  /** Clarification type for lastClarification state */
  clarificationType?: 'option_selection' | 'doc_disambiguation' | 'td7_high_ambiguity' | 'notes_scope'

  /** The question shown to user (for lastClarification) */
  clarificationQuestion?: string

  /** Original user input that triggered these options */
  originalInput?: string
}

/**
 * Callbacks required for state management.
 * These are passed from the component/handler context.
 */
export interface SelectionContextCallbacks {
  setPendingOptions: (options: PendingOptionState[]) => void
  setPendingOptionsMessageId: (messageId: string | null) => void
  setPendingOptionsGraceCount: (count: number) => void
  setLastClarification: (state: LastClarificationState | null) => void
  saveLastOptionsShown?: (
    options: Array<{ id: string; label: string; sublabel?: string; type: string }>,
    messageId: string
  ) => void
}

/**
 * Reason for clearing selection context.
 * Determines whether to save snapshot for later return.
 */
export type ClearReason =
  | 'stop_cancel'        // User explicitly stopped/cancelled
  | 'new_list'           // New options list replaces this one
  | 'selection_made'     // User made a selection (keep snapshot for repair)
  | 'explicit_command'   // User issued a command that bypasses options
  | 'navigation'         // Navigation action clears context

// =============================================================================
// Core Functions
// =============================================================================

/**
 * Register a selection context atomically.
 *
 * This sets all selection state pieces together:
 * - pendingOptions (the options array)
 * - pendingOptionsMessageId (for activeOptionSetId binding)
 * - pendingOptionsGraceCount (reset to 0 for fresh options)
 * - lastClarification (for clarification intercept handling)
 * - lastOptionsShown (soft-active window via saveLastOptionsShown)
 *
 * @param config - Configuration for the selection context
 * @param callbacks - State setters from component context
 */
export function registerSelectionContext(
  config: RegisterSelectionContextConfig,
  callbacks: SelectionContextCallbacks
): void {
  const {
    options,
    messageId,
    source,
    clarificationType = 'option_selection',
    clarificationQuestion = 'Which one?',
    originalInput,
  } = config

  const {
    setPendingOptions,
    setPendingOptionsMessageId,
    setPendingOptionsGraceCount,
    setLastClarification,
    saveLastOptionsShown,
  } = callbacks

  // 1. Set pending options (full data for execution)
  setPendingOptions(options)

  // 2. Set message ID (becomes activeOptionSetId for Tier 3a binding)
  setPendingOptionsMessageId(messageId)

  // 3. Reset grace count (fresh options get full window)
  setPendingOptionsGraceCount(0)

  // 4. Build clarification options (minimal data for state)
  const clarificationOptions: ClarificationOption[] = options.map(opt => ({
    id: opt.id,
    label: opt.label,
    sublabel: opt.sublabel,
    type: opt.type,
  }))

  // 5. Set lastClarification state
  setLastClarification({
    type: clarificationType,
    originalIntent: source,
    messageId,
    timestamp: Date.now(),
    clarificationQuestion,
    options: clarificationOptions,
    metaCount: 0,
    attemptCount: 0,
    exitCount: 0,
    noCount: 0,
    ...(originalInput && { originalInput }),
  })

  // 6. Save to soft-active window (2-turn TTL)
  if (saveLastOptionsShown) {
    saveLastOptionsShown(
      options.map(opt => ({
        id: opt.id,
        label: opt.label,
        sublabel: opt.sublabel,
        type: opt.type,
      })),
      messageId
    )
  }
}

/**
 * Clear selection context atomically.
 *
 * This clears all selection state pieces together.
 * Use this instead of manually clearing individual state pieces.
 *
 * @param callbacks - State setters from component context
 * @param reason - Why the context is being cleared (for debugging/analytics)
 */
export function clearSelectionContext(
  callbacks: Pick<
    SelectionContextCallbacks,
    'setPendingOptions' | 'setPendingOptionsMessageId' | 'setPendingOptionsGraceCount' | 'setLastClarification'
  >,
  reason: ClearReason
): void {
  const {
    setPendingOptions,
    setPendingOptionsMessageId,
    setPendingOptionsGraceCount,
    setLastClarification,
  } = callbacks

  // Clear all state pieces atomically
  setPendingOptions([])
  setPendingOptionsMessageId(null)
  setPendingOptionsGraceCount(0)
  setLastClarification(null)

  // Note: We don't clear lastOptionsShown here - it has its own TTL-based expiry
  // This allows "back to options" to work even after explicit stop

  // Log for debugging (optional, can be removed in production)
  if (typeof window !== 'undefined' && (window as unknown as { __DEBUG_SELECTION_CONTEXT__?: boolean }).__DEBUG_SELECTION_CONTEXT__) {
    console.log('[SelectionContext] Cleared with reason:', reason)
  }
}

/**
 * Check if a selection context is currently active.
 *
 * @param pendingOptions - Current pending options array
 * @param activeOptionSetId - Current active option set ID
 * @returns true if there's an active selection context
 */
export function hasActiveSelectionContext(
  pendingOptions: PendingOptionState[],
  activeOptionSetId: string | null
): boolean {
  return pendingOptions.length > 0 && activeOptionSetId !== null
}

/**
 * Check if all options in the context are of a specific type.
 *
 * @param options - Options to check
 * @param type - The type to check for
 * @returns true if all options match the type
 */
export function allOptionsOfType(
  options: Array<{ type: string }>,
  type: string
): boolean {
  return options.length > 0 && options.every(opt => opt.type === type)
}

// =============================================================================
// Follow-Up Resolution
// =============================================================================

/**
 * Resolve a follow-up selection from the registered context.
 *
 * This is the universal resolver that works for ALL option types.
 * It checks pendingOptions first, then falls back to lastClarification.options.
 *
 * @param index - The 0-based index of the option to select
 * @param pendingOptions - Current pending options
 * @param lastClarification - Current clarification state (fallback)
 * @returns The selected option or null if not found
 */
export function resolveSelectionByIndex(
  index: number,
  pendingOptions: PendingOptionState[],
  lastClarification: LastClarificationState | null
): PendingOptionState | null {
  // Primary: Check pendingOptions (has full data)
  if (pendingOptions.length > 0 && index >= 0 && index < pendingOptions.length) {
    return pendingOptions[index]
  }

  // Fallback: Check lastClarification.options (minimal data)
  // This handles cases where pendingOptions was cleared but lastClarification persists
  if (lastClarification?.options && index >= 0 && index < lastClarification.options.length) {
    const clarOpt = lastClarification.options[index]
    // Convert ClarificationOption to PendingOptionState-like structure
    return {
      index: index + 1,
      type: clarOpt.type as PendingOptionState['type'],
      id: clarOpt.id,
      label: clarOpt.label,
      sublabel: clarOpt.sublabel,
      // Note: data is not available from clarification options
      // Caller should handle this case appropriately
    } as PendingOptionState
  }

  return null
}

/**
 * Resolve a follow-up selection by label match.
 *
 * @param label - The label to match (case-insensitive)
 * @param pendingOptions - Current pending options
 * @param lastClarification - Current clarification state (fallback)
 * @returns The matched option or null if not found
 */
export function resolveSelectionByLabel(
  label: string,
  pendingOptions: PendingOptionState[],
  lastClarification: LastClarificationState | null
): PendingOptionState | null {
  const normalizedLabel = label.toLowerCase().trim()

  // Primary: Check pendingOptions
  const pendingMatch = pendingOptions.find(
    opt => opt.label.toLowerCase().trim() === normalizedLabel ||
           opt.label.toLowerCase().includes(normalizedLabel)
  )
  if (pendingMatch) {
    return pendingMatch
  }

  // Fallback: Check lastClarification.options
  if (lastClarification?.options) {
    const clarMatch = lastClarification.options.find(
      opt => opt.label.toLowerCase().trim() === normalizedLabel ||
             opt.label.toLowerCase().includes(normalizedLabel)
    )
    if (clarMatch) {
      const index = lastClarification.options.indexOf(clarMatch)
      return {
        index: index + 1,
        type: clarMatch.type as PendingOptionState['type'],
        id: clarMatch.id,
        label: clarMatch.label,
        sublabel: clarMatch.sublabel,
      } as PendingOptionState
    }
  }

  return null
}
