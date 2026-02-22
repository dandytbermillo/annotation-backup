/**
 * Routing Dispatcher — Unified Priority Chain
 *
 * Per routing-order-priority-plan.md, this file codifies the canonical routing
 * order in a single place. All user input flows through dispatchRouting() which
 * calls handlers in strict tier order:
 *
 *   Tier 0 — Stop / Cancel (highest priority)
 *   Tier 1 — Return / Resume / Repair (paused snapshot)
 *   Tier 2 — New Topic / Interrupt Commands (verb commands)
 *     2a: Explicit Command Bypass
 *     2b: Cross-Corpus Retrieval
 *     2c: Panel Disambiguation
 *     2d: Meta-Explain
 *     2e: Correction
 *     2f: Follow-Up
 *     2g: Preview Shortcut ("show all")
 *   Tier 3 — Clarification (active list only)
 *     3a: Selection-Only Guard (ordinals, labels on active/recent list)
 *     3b: Affirmation Without Context ("yes" with no suggestion)
 *     3c: Re-show Options ("show options")
 *   Tier 4 — Known-Noun Commands (see known-noun-routing.ts)
 *   Tier 5 — Docs / Informational Routing (last resort)
 *
 * Tiers 0, 1, 3-core are handled inside handleClarificationIntercept().
 * Tier 2 is split: interrupt detection in handleClarificationIntercept(),
 *   explicit command bypass + panel disambiguation + preview shortcut here.
 * Tiers 3a/3b/3c are post-clarification guards handled here.
 * Tier 4 is handleKnownNounRouting() from known-noun-routing.ts.
 * Tier 5 is handleDocRetrieval().
 *
 * After all tiers, unhandled input falls through to the LLM API (caller's
 * responsibility in sendMessage).
 */

import { debugLog } from '@/lib/utils/debug-logger'
import type { ChatMessage, SelectionOption, ViewPanelContent } from '@/lib/chat'
import type { UIContext } from '@/lib/chat/intent-prompt'
import type { LastClarificationState } from '@/lib/chat/chat-navigation-context'
import type { DocRetrievalState } from '@/lib/docs/doc-retrieval-state'
import { matchVisiblePanelCommand, type VisibleWidget } from '@/lib/chat/panel-command-matcher'
import type { RepairMemoryState, ClarificationSnapshot, ClarificationOption, LastSuggestionState, SuggestionCandidate, ChatSuggestions, WidgetSelectionContext, ChatProvenance } from '@/lib/chat/chat-navigation-context'
import { WIDGET_SELECTION_TTL, SOFT_ACTIVE_TURN_LIMIT } from '@/lib/chat/chat-navigation-context'
import type {
  HandlerResult,
  PendingOptionState,
  ClarificationInterceptContext,
  ClarificationInterceptResult,
  PanelDisambiguationHandlerContext,
  PanelDisambiguationHandlerResult,
  RoutingHandlerContext,
  MetaExplainHandlerContext,
  FollowUpHandlerContext,
  FollowUpHandlerResult,
} from '@/lib/chat/chat-routing'
import type { CrossCorpusHandlerContext, CrossCorpusHandlerResult } from '@/lib/chat/cross-corpus-handler'
import type { DocRetrievalHandlerContext, DocRetrievalHandlerResult } from '@/lib/chat/doc-routing'

import { handleClarificationIntercept, handlePanelDisambiguation, handleCorrection, handleMetaExplain, handleFollowUp } from '@/lib/chat/chat-routing'
import { handleCrossCorpusRetrieval } from '@/lib/chat/cross-corpus-handler'
import { handleDocRetrieval } from '@/lib/chat/doc-routing'
import { isAffirmationPhrase, isRejectionPhrase, matchesReshowPhrases, matchesShowAllHeuristic, hasGraceSkipActionVerb, hasQuestionIntent, ACTION_VERB_PATTERN, isCommandLike, isPoliteImperativeRequest } from '@/lib/chat/query-patterns'
import { handleKnownNounRouting } from '@/lib/chat/known-noun-routing'
import { callClarificationLLMClient, isLLMFallbackEnabledClient } from '@/lib/chat/clarification-llm-fallback'
import { handleGroundingSetFallback, buildGroundingContext, checkSoftActiveWindow, isSelectionLike } from '@/lib/chat/grounding-set'
import type { GroundingCandidate } from '@/lib/chat/grounding-set'
import { buildTurnSnapshot } from '@/lib/chat/ui-snapshot-builder'
import { callGroundingLLM, isGroundingLLMEnabled } from '@/lib/chat/grounding-llm-fallback'
import { getWidgetSnapshot } from '@/lib/widgets/ui-snapshot-registry'

// =============================================================================
// Helpers
// =============================================================================

/**
 * Find which list segment an item belongs to in the registry snapshot.
 * Local helper — not exported.
 */
function findSourceSegmentId(widgetId: string | undefined, itemId: string): string | undefined {
  if (!widgetId) return undefined
  const snapshot = getWidgetSnapshot(widgetId)
  if (!snapshot) return undefined

  for (const segment of snapshot.segments) {
    if (segment.segmentType === 'list') {
      if (segment.items.some(item => item.itemId === itemId)) {
        return segment.segmentId
      }
    }
  }
  return undefined
}

/**
 * Resolve a widget item ID to its widget + segment from visible snapshots.
 * Used to execute widget_option selections outside Tier 4.5 (e.g., clarifier follow-ups).
 */
function resolveWidgetItemFromSnapshots(
  getVisibleSnapshots: () => import('@/lib/widgets/ui-snapshot-registry').WidgetSnapshot[],
  itemId: string
): { widgetId: string; widgetLabel: string; segmentId?: string } | null {
  const snapshots = getVisibleSnapshots()
  for (const snapshot of snapshots) {
    for (const segment of snapshot.segments) {
      if (segment.segmentType === 'list') {
        if (segment.items.some(item => item.itemId === itemId)) {
          return {
            widgetId: snapshot.widgetId,
            widgetLabel: snapshot.title,
            segmentId: segment.segmentId,
          }
        }
      }
    }
  }
  return null
}

// =============================================================================
// Types
// =============================================================================

/**
 * Last preview state for "show all" shortcut (Tier 2g).
 * Tracks the most recent preview so the user can expand it.
 */
export interface LastPreviewState {
  source: string
  viewPanelContent: ViewPanelContent
  totalCount: number
  messageId: string
  createdAt: number
  drawerPanelId?: string
  drawerPanelTitle?: string
}

// =============================================================================
// Dispatcher Context
// =============================================================================

/**
 * Aggregated context for the routing dispatcher.
 * Combines all handler contexts into a single object so sendMessage()
 * builds it once and passes it through.
 */
export interface RoutingDispatcherContext {
  // --- Input ---
  trimmedInput: string

  // --- Suggestion Routing (Tier S) ---
  lastSuggestion: LastSuggestionState | null
  setLastSuggestion: (state: LastSuggestionState | null) => void
  addRejectedSuggestions: (labels: string[]) => void
  clearRejectedSuggestions: () => void

  // --- Clarification Intercept (Tiers 0, 1, 3) ---
  lastClarification: LastClarificationState | null
  pendingOptions: PendingOptionState[]
  /** Active option set ID — when non-null, Tier 3 is allowed to bind selections.
   *  Per routing-order-priority-plan.md line 81:
   *  "Runs only when activeOptionSetId != null (don't bind to old visible pills in history)" */
  activeOptionSetId: string | null
  /** Per universal-selection-resolver-plan.md: needed to clear activeOptionSetId when registering widget context */
  setActiveOptionSetId: (id: string | null) => void
  uiContext?: UIContext | null
  currentEntryId?: string
  addMessage: (message: ChatMessage) => void
  setLastClarification: (state: LastClarificationState | null) => void
  setIsLoading: (loading: boolean) => void
  setPendingOptions: (options: PendingOptionState[]) => void
  setPendingOptionsMessageId: (messageId: string | null) => void
  setPendingOptionsGraceCount: (count: number) => void
  setNotesScopeFollowUpActive: (active: boolean) => void
  handleSelectOption: (option: SelectionOption) => void
  repairMemory: RepairMemoryState | null
  setRepairMemory: (lastChoiceId: string | null, options: ClarificationOption[]) => void
  incrementRepairMemoryTurn: () => void
  clearRepairMemory: () => void
  clarificationSnapshot: ClarificationSnapshot | null
  saveClarificationSnapshot: (clarification: LastClarificationState, paused?: boolean, pausedReason?: 'interrupt' | 'stop') => void
  pauseSnapshotWithReason: (reason: 'interrupt' | 'stop') => void
  incrementSnapshotTurn: () => void
  clearClarificationSnapshot: () => void
  stopSuppressionCount: number
  setStopSuppressionCount: (count: number) => void
  decrementStopSuppression: () => void

  // --- Doc/Routing Handlers (Tiers 2, 5) ---
  docRetrievalState: DocRetrievalState | null
  knownTermsFetchStatus: 'snapshot' | 'cached' | 'fetched' | 'fetch_error' | 'fetch_timeout'
  usedCoreAppTermsFallback: boolean
  updateDocRetrievalState: (update: Partial<DocRetrievalState>) => void
  messages: ChatMessage[]

  // --- Explicit Command Bypass / Re-show (Tiers 2, 3) ---
  findLastOptionsMessage: (messages: ChatMessage[]) => { options: PendingOptionState[]; timestamp: Date } | null
  reshowWindowMs: number

  // --- Preview Shortcut (Tier 2g) ---
  lastPreview: LastPreviewState | null
  openPanelDrawer: (panelId: string, panelTitle?: string, executionMeta?: import('@/lib/chat/action-trace').ExecutionMeta) => void
  openPanelWithTracking: (content: ViewPanelContent, panelId?: string) => void

  // --- Grounding-Set Fallback (Tier 4.5, per grounding-set-fallback-plan.md) ---
  sessionState: import('@/lib/chat/intent-prompt').SessionState
  lastOptionsShown: import('@/lib/chat/chat-navigation-context').LastOptionsShown | null
  incrementLastOptionsShownTurn?: () => void
  /** Save last options shown for soft-active window (called wherever dispatcher creates options) */
  saveLastOptionsShown: (options: import('@/lib/chat/chat-navigation-context').ClarificationOption[], messageId: string) => void
  /** Per universal-selection-resolver-plan.md: clear soft-active window when registering widget context */
  clearLastOptionsShown?: () => void

  // --- Scope-Cue Recovery Memory (explicit-only, per scope-cue-recovery-plan) ---
  scopeCueRecoveryMemory: import('@/lib/chat/chat-navigation-context').ScopeCueRecoveryMemory | null
  clearScopeCueRecoveryMemory: () => void

  // --- Widget Registry (Tier 4.5, per widget-registry-implementation-plan.md) ---
  getVisibleSnapshots: () => import('@/lib/widgets/ui-snapshot-registry').WidgetSnapshot[]
  getActiveWidgetId: () => string | null

  // --- Widget Selection Context (per universal-selection-resolver-plan.md) ---
  widgetSelectionContext: import('@/lib/chat/chat-navigation-context').WidgetSelectionContext | null
  setWidgetSelectionContext: (context: import('@/lib/chat/chat-navigation-context').WidgetSelectionContext | null) => void
  incrementWidgetSelectionTurn: () => void
  clearWidgetSelectionContext: () => void

  // --- Focus Latch (per selection-intent-arbitration-incubation-plan.md) ---
  focusLatch: import('@/lib/chat/chat-navigation-context').FocusLatchState | null
  setFocusLatch: (latch: import('@/lib/chat/chat-navigation-context').FocusLatchState | null) => void
  suspendFocusLatch: () => void
  incrementFocusLatchTurn: () => void
  clearFocusLatch: () => void

  // --- Selection Continuity (Plan 20 — per Plan 19 canonical contract) ---
  selectionContinuity: import('@/lib/chat/chat-navigation-context').SelectionContinuityState
  updateSelectionContinuity: (updates: Partial<import('@/lib/chat/chat-navigation-context').SelectionContinuityState>) => void
  recordAcceptedChoice: (choiceId: string, action: import('@/lib/chat/chat-navigation-context').SelectionActionTrace) => void
  recordRejectedChoice: (choiceId: string) => void
  resetSelectionContinuity: () => void
}

// =============================================================================
// Dispatcher Result
// =============================================================================

export interface RoutingDispatcherResult {
  /** Whether any tier handled the input */
  handled: boolean
  /** Which tier handled it (for telemetry) */
  handledByTier?: 0 | 1 | 2 | 3 | 4 | 5
  /** Tier label for logging */
  tierLabel?: string
  /** Pass-through from clarification intercept */
  clarificationCleared: boolean
  /** Pass-through from clarification intercept */
  isNewQuestionOrCommandDetected: boolean
  /** Pass-through from follow-up handler (needed for doc retrieval context) */
  classifierCalled: boolean
  classifierResult?: boolean
  classifierTimeout: boolean
  classifierLatencyMs?: number
  classifierError: boolean
  isFollowUp: boolean
  /** Suggestion action for sendMessage() to execute (Tier S routing-only result) */
  suggestionAction?: {
    type: 'affirm_single'
    candidate: SuggestionCandidate
  } | {
    type: 'affirm_multiple'
    candidates: SuggestionCandidate[]
  } | {
    type: 'reject'
    rejectedLabels: string[]
    alternativesMessage: string
  }
  /** Grounding-set action for sendMessage() to execute (Tier 4.5 referent resolution) */
  groundingAction?: {
    type: 'execute_referent'
    /** Synthetic message to send through navigate API (e.g. "open Resume.pdf") */
    syntheticMessage: string
    candidateId: string
    candidateLabel: string
    actionHint?: string
  } | {
    type: 'execute_widget_item'
    widgetId: string
    segmentId?: string
    itemId: string
    itemLabel: string
    action: string
  }
  /** Phase 10: Semantic answer lane marker — input matched semantic question patterns */
  semanticLanePending?: boolean
  /** Dev-only: routing provenance hint for debug overlay (undefined = deterministic) */
  _devProvenanceHint?: ChatProvenance
}

/** Type alias for grounding actions (extracted from RoutingDispatcherResult for reuse) */
export type GroundingAction = NonNullable<RoutingDispatcherResult['groundingAction']>

// =============================================================================
// Explicit Command Detection (extracted to shared utility for import safety)
// =============================================================================

// Import from shared utility (extracted to avoid circular dependency with chat-routing.ts)
import { isExplicitCommand, isSelectionOnly, normalizeOrdinalTypos, isSemanticQuestionInput, classifyExecutionMeta } from '@/lib/chat/input-classifiers'
// Re-export to avoid breaking existing imports from this file
export { isExplicitCommand }

// =============================================================================
// Selection Helpers (moved from chat-navigation-panel.tsx)
// =============================================================================

/**
 * Check if input looks like a selection attempt even though deterministic
 * normalization couldn't resolve it.
 *
 * Per clarification-response-fit-plan.md "Selection-Like Typos (NEW)":
 * If input resembles an ordinal or option reference but fails deterministic
 * parsing, it should go to the constrained LLM — NOT fall through to docs.
 *
 * Signals:
 * - Short input (1–4 words)
 * - Contains ordinal-like substrings (first/second/third/etc. even if misspelled)
 * - Contains "option" or "one" keywords
 * - Single digit or single letter
 * - NOT a question, command, or known verb phrase
 */
function looksSelectionLike(input: string): boolean {
  const n = input.toLowerCase().trim()
  const wordCount = n.split(/\s+/).length

  // Must be short — long inputs are unlikely selection attempts
  if (wordCount > 4) return false

  // Skip if it has question intent or command verbs
  if (hasQuestionIntent(n)) return false
  if (/^(open|show|go|search|find|help|stop|cancel|back|return)\b/i.test(n)) return false

  // Contains ordinal-like fragments anywhere in token (not just at word start).
  // Catches "sesecond" (contains "sec"), "thrid" (contains "thr"), etc.
  if (/(fir|frs|fis|sec|sco|sed|thi|thr|tir|fou|fif|las)/i.test(n)) return true
  // "option" / "one" at word boundary (these are structural, not ordinal fragments)
  if (/\b(opt|one)\w*/i.test(n)) return true

  // Pure digit or single letter (a–e)
  if (/^[1-9]$/.test(n) || /^[a-e]$/i.test(n)) return true

  // Contains "option" or "number" keyword
  if (/\b(option|choice|number|pick|select)\b/i.test(n)) return true

  return false
}

/**
 * Extract ordinal index from input, supporting both strict patterns and embedded ordinals.
 * This mirrors resolveOrdinalIndex from grounding-set.ts but returns in the format expected
 * by the universal resolver.
 *
 * Strict patterns: "first", "the second one", "option 3"
 * Embedded patterns: "can you open that second one pls", "open the first option in the widget"
 */
function extractOrdinalIndex(input: string, optionCount: number): number | undefined {
  const normalized = normalizeOrdinalTypos(input).toLowerCase()

  const ordinalMap: Record<string, number> = {
    'first': 0, '1': 0, '1st': 0, 'option 1': 0, 'the first one': 0, 'the first option': 0, 'first option': 0,
    'second': 1, '2': 1, '2nd': 1, 'option 2': 1, 'the second one': 1, 'the second option': 1, 'second option': 1,
    'third': 2, '3': 2, '3rd': 2, 'option 3': 2, 'the third one': 2, 'the third option': 2, 'third option': 2,
    'fourth': 3, '4': 3, '4th': 3, 'option 4': 3, 'the fourth one': 3, 'the fourth option': 3, 'fourth option': 3,
    'fifth': 4, '5': 4, '5th': 4, 'option 5': 4, 'the fifth one': 4, 'the fifth option': 4, 'fifth option': 4,
  }

  // Handle "last"
  if (normalized === 'last' || normalized === 'the last one' || normalized === 'the last option') {
    const index = optionCount - 1
    return index >= 0 ? index : undefined
  }

  // 1. Exact whole-string match
  if (ordinalMap[normalized] !== undefined) {
    const index = ordinalMap[normalized]
    return index < optionCount ? index : undefined
  }

  // 2. Extract embedded ordinal from within a longer string.
  //    Handles inputs like "can you open that second one pls" where the
  //    ordinal is embedded in a command sentence.
  const embeddedOrdinals: [RegExp, number][] = [
    [/\bfirst\b|(?<!\d)1st\b/, 0],
    [/\bsecond\b|(?<!\d)2nd\b/, 1],
    [/\bthird\b|(?<!\d)3rd\b/, 2],
    [/\bfourth\b|(?<!\d)4th\b/, 3],
    [/\bfifth\b|(?<!\d)5th\b/, 4],
    [/\bsixth\b/, 5],
    [/\bseventh\b/, 6],
    [/\beighth\b/, 7],
    [/\bninth\b/, 8],
    [/\blast\b/, optionCount - 1],
  ]

  for (const [pattern, index] of embeddedOrdinals) {
    if (pattern.test(normalized) && index >= 0 && index < optionCount) {
      return index
    }
  }

  // 3. Single digit number
  const singleDigit = normalized.match(/\b([1-9])\b/)
  if (singleDigit) {
    const index = parseInt(singleDigit[1], 10) - 1
    if (index >= 0 && index < optionCount) {
      return index
    }
  }

  return undefined
}


/**
 * Find exact match in pending options by label or sublabel.
 * Returns the matched option or undefined if no exact match.
 */
function findExactOptionMatch(
  input: string,
  options: PendingOptionState[]
): PendingOptionState | undefined {
  const normalized = input.trim().toLowerCase()

  // Try exact label match first
  const labelMatch = options.find(opt => opt.label.toLowerCase() === normalized)
  if (labelMatch) return labelMatch

  // Try exact sublabel match
  const sublabelMatch = options.find(
    opt => opt.sublabel && opt.sublabel.toLowerCase() === normalized
  )
  if (sublabelMatch) return sublabelMatch

  // Try "contains" match - input contains the option label
  // e.g., "pls show the Links Panel D" contains "Links Panel D"
  // Only match if exactly one option label is found (avoid ambiguity)
  const containsMatches = options.filter(opt =>
    normalized.includes(opt.label.toLowerCase())
  )
  if (containsMatches.length === 1) {
    return containsMatches[0]
  }

  // Phase 2a.1: Label matching for visible options
  // Try "starts with" match - label starts with input
  // e.g., "workspace 6" matches "Workspace 6 (Home)"
  // Only match if exactly one option starts with the input (avoid ambiguity)
  const startsWithMatches = options.filter(opt =>
    opt.label.toLowerCase().startsWith(normalized)
  )
  if (startsWithMatches.length === 1) {
    return startsWithMatches[0]
  }

  // Phase 2a.1: Try "label contains input" match
  // e.g., "workspace 6" is found within "Workspace 6 (Home)"
  // Require minimum 3 chars to avoid false positives
  // Only match if exactly one option contains the input (avoid ambiguity)
  if (normalized.length >= 3) {
    const labelContainsMatches = options.filter(opt =>
      opt.label.toLowerCase().includes(normalized)
    )
    if (labelContainsMatches.length === 1) {
      return labelContainsMatches[0]
    }
  }

  return undefined
}

// =============================================================================
// Universal Selection Follow-Up Resolver
// Per universal-selection-resolver-plan.md Phase 4
// =============================================================================

/**
 * Resolve selection follow-ups against chat or widget selection contexts.
 * Precedence: chat context first, then widget context.
 * Gate: Must be selection-like and NOT a question.
 *
 * Returns { handled: true, groundingAction } for widget selections,
 * or { handled: true, matchedOption } for chat selections (caller handles).
 */
function resolveSelectionFollowUp(
  input: string,
  chatContext: {
    pendingOptions: PendingOptionState[]
    activeOptionSetId: string | null
  },
  widgetContext: WidgetSelectionContext | null,
  getVisibleSnapshots: () => ReturnType<typeof getWidgetSnapshot>[]
): {
  handled: boolean
  matchedChatOption?: PendingOptionState
  groundingAction?: GroundingAction
} {
  // Gate: must be selection-like
  if (!isSelectionLike(input)) {
    return { handled: false }
  }

  // Question-intent filter using shared utilities (no local regex duplication).
  // Per universal-selection-resolver-plan.md Phase 4:
  // - isPoliteImperativeRequest: "can you open..." / "could you show..." (query-patterns.ts:363)
  // - isCommandLike: action verb + no question-word prefix (handles trailing ? correctly)
  if (hasQuestionIntent(input) && !isPoliteImperativeRequest(input) && !isCommandLike(input)) {
    return { handled: false }
  }

  // Precedence 1: Chat context first
  if (chatContext.pendingOptions.length > 0 && chatContext.activeOptionSetId !== null) {
    // Use extractOrdinalIndex for embedded ordinal support (e.g., "can you open the second one")
    const ordinalIndex = extractOrdinalIndex(input, chatContext.pendingOptions.length)

    if (ordinalIndex !== undefined) {
      const match = chatContext.pendingOptions[ordinalIndex]
      return { handled: true, matchedChatOption: match }
    }

    // Try label match (reuse existing helper)
    const labelMatch = findExactOptionMatch(input, chatContext.pendingOptions)
    if (labelMatch) {
      return { handled: true, matchedChatOption: labelMatch }
    }
  }

  // Precedence 2: Widget context (only if chat context didn't match)
  if (widgetContext && widgetContext.turnsSinceShown < WIDGET_SELECTION_TTL) {
    // Use extractOrdinalIndex for embedded ordinal support (e.g., "can you open that second one pls")
    const ordinalIndex = extractOrdinalIndex(input, widgetContext.options.length)

    if (ordinalIndex !== undefined) {
      const match = widgetContext.options[ordinalIndex]
      return {
        handled: true,
        groundingAction: {
          type: 'execute_widget_item',
          widgetId: widgetContext.widgetId,
          segmentId: widgetContext.segmentId,
          itemId: match.id,
          itemLabel: match.label,
          action: 'open',
        },
      }
    }

    // Try label match for widget options — convert to PendingOptionState format
    const widgetOptionsAsPending: PendingOptionState[] = widgetContext.options.map((opt, idx) => ({
      index: idx + 1,
      type: 'widget_option' as const,
      id: opt.id,
      label: opt.label,
      sublabel: opt.sublabel,
      data: undefined, // Widget options don't carry data payload
    }))
    const labelMatch = findExactOptionMatch(input, widgetOptionsAsPending)
    if (labelMatch) {
      return {
        handled: true,
        groundingAction: {
          type: 'execute_widget_item',
          widgetId: widgetContext.widgetId,
          segmentId: widgetContext.segmentId,
          itemId: labelMatch.id,
          itemLabel: labelMatch.label,
          action: 'open',
        },
      }
    }
  }

  return { handled: false }
}

// =============================================================================
// Grounding-Set Helpers
// =============================================================================

/**
 * Build a grounded clarifier message from candidates.
 * Per plan §F: On need_more_info, ask a single grounded clarifier.
 */
function buildGroundedClarifier(candidates: GroundingCandidate[]): string {
  if (candidates.length === 0) {
    return "I'm not sure what you're referring to. Could you tell me what you'd like to do?"
  }

  // Group by type for natural phrasing
  const options = candidates.filter(c => c.type === 'option' || c.type === 'widget_option')
  const referents = candidates.filter(c => c.type === 'referent')
  const capabilities = candidates.filter(c => c.type === 'capability')

  if (options.length > 0) {
    const labels = options.slice(0, 5).map(c => c.label)
    return `Which option did you mean? ${labels.join(', ')}?`
  }

  if (referents.length > 0 && capabilities.length > 0) {
    const refLabels = referents.map(c => c.label)
    const capLabels = capabilities.map(c => c.label.toLowerCase())
    return `Do you want to ${capLabels.join(', ')} ${refLabels[0]}, or something else?`
  }

  if (referents.length > 0) {
    return `Are you referring to ${referents[0].label}?`
  }

  return "I'm not sure what you're referring to. Could you tell me what you'd like to do?"
}

/**
 * Bind a grounded clarifier to pending options so follow-up replies can resolve.
 * Only binds option/widget_option candidates (others are ignored).
 * Returns the built options so they can be added to the clarifier message.
 *
 * Per universal-selection-resolver-plan.md Phase 3:
 * - If ALL options are widget_option → register widgetSelectionContext (not pendingOptions)
 * - If mixed or chat-only → use existing pendingOptions/lastClarification behavior
 */
function bindGroundingClarifierOptions(
  ctx: RoutingDispatcherContext,
  candidates: GroundingCandidate[],
  messageId: string
): PendingOptionState[] {
  const optionCandidates = candidates.filter(c => c.type === 'option' || c.type === 'widget_option')
  if (optionCandidates.length === 0) return []

  // Check if ALL candidates are widget_option
  const allWidgetOptions = optionCandidates.every(c => c.type === 'widget_option')

  if (allWidgetOptions) {
    // Per universal-selection-resolver-plan.md Phase 3:
    // Register widgetSelectionContext instead of pendingOptions for pure widget lists
    const firstCandidate = optionCandidates[0]
    const widgetInfo = resolveWidgetItemFromSnapshots(ctx.getVisibleSnapshots, firstCandidate.id)

    if (widgetInfo) {
      // Build options in exact same order as candidates (for ordinal alignment)
      // Note: GroundingCandidate doesn't have sublabel, so we omit it
      const widgetOptions = optionCandidates.map(c => ({
        id: c.id,
        label: c.label,
      }))

      // Register widget selection context
      ctx.setWidgetSelectionContext({
        optionSetId: messageId,
        widgetId: widgetInfo.widgetId,
        segmentId: widgetInfo.segmentId,
        options: widgetOptions,
        timestamp: Date.now(),
        turnsSinceShown: 0,
      })

      // Clear chat selection context to prevent cross-context ambiguity
      // CRITICAL: Must clear activeOptionSetId to prevent Tier 3a from matching against old options
      // CRITICAL: Must clear lastOptionsShown to prevent soft-active window (Tier 4.5) from matching old options
      // CRITICAL: Must clear clarificationSnapshot to prevent POST-ACTION ORDINAL WINDOW from matching old options
      ctx.setPendingOptions([])
      ctx.setPendingOptionsMessageId(null)
      ctx.setPendingOptionsGraceCount(0)
      ctx.setActiveOptionSetId(null)
      ctx.setLastClarification(null)
      ctx.clearLastOptionsShown?.()
      ctx.clearClarificationSnapshot()

      void debugLog({
        component: 'ChatNavigation',
        action: 'grounding_clarifier_widget_context',
        metadata: {
          messageId,
          widgetId: widgetInfo.widgetId,
          optionCount: widgetOptions.length,
          optionLabels: widgetOptions.map(o => o.label),
        },
      })

      // Still return options for message UI rendering (pills display)
      // but they are NOT bound to pendingOptions
      return optionCandidates.map((candidate, index) => ({
        index,
        id: candidate.id,
        label: candidate.label,
        type: 'widget_option' as const,
        data: {
          widgetId: widgetInfo.widgetId,
          segmentId: widgetInfo.segmentId,
          itemId: candidate.id,
        },
      }))
    } else {
      // Per universal-selection-resolver-plan.md Phase 3 (lines 79-81):
      // Widget list candidates without valid widgetInfo (missing widgetId/segmentId)
      // should NOT be registered in chat context. Clear stale context and keep pills UI-only.
      ctx.setPendingOptions([])
      ctx.setPendingOptionsMessageId(null)
      ctx.setPendingOptionsGraceCount(0)
      ctx.setActiveOptionSetId(null)
      ctx.setLastClarification(null)
      ctx.clearLastOptionsShown?.()
      ctx.clearWidgetSelectionContext()
      ctx.clearClarificationSnapshot()

      void debugLog({
        component: 'ChatNavigation',
        action: 'grounding_clarifier_widget_no_registry',
        metadata: {
          messageId,
          candidateCount: optionCandidates.length,
          candidateLabels: optionCandidates.map(c => c.label),
          reason: 'widget_option_candidates_not_in_snapshot_registry',
        },
      })

      // Return pills for UI-only display (clickable but not ordinal-selectable)
      return optionCandidates.map((candidate, index) => ({
        index,
        id: candidate.id,
        label: candidate.label,
        type: 'widget_option' as const,
        data: undefined, // No execution data available
      }))
    }
  }

  // Mixed or chat-only options: use existing pendingOptions/lastClarification behavior
  const pendingOptions: PendingOptionState[] = []

  optionCandidates.forEach((candidate, index) => {
    if (candidate.type === 'widget_option') {
      const widgetInfo = resolveWidgetItemFromSnapshots(ctx.getVisibleSnapshots, candidate.id)
      pendingOptions.push({
        index,
        id: candidate.id,
        label: candidate.label,
        type: 'widget_option',
        data: {
          widgetId: widgetInfo?.widgetId,
          segmentId: widgetInfo?.segmentId,
          itemId: candidate.id,
        },
      })
      return
    }

    // For option-type candidates, attempt to find a full option with data.
    // Per universal-selection-resolver-plan.md Phase 3: only register if we can attach execution data.
    const messageOption = ctx.findLastOptionsMessage(ctx.messages)?.options.find(opt => opt.id === candidate.id)
    if (messageOption) {
      pendingOptions.push({
        index,
        id: messageOption.id,
        label: messageOption.label,
        sublabel: messageOption.sublabel,
        type: messageOption.type,
        data: messageOption.data,
      })
    }
    // If candidate not found in message history, we cannot attach execution data.
    // Per plan: do NOT add to pendingOptions (would be unexecutable).
  })

  // Per universal-selection-resolver-plan.md Phase 3 (lines 76-78):
  // If we cannot attach execution data to option-type candidates, do NOT leave stale
  // pendingOptions active. Clear chat selection context to prevent cross-binding.
  if (pendingOptions.length === 0) {
    // Clear stale chat context — pills will be UI-only (clickable but not ordinal-selectable)
    // CRITICAL: Must also clear clarificationSnapshot to prevent POST-ACTION ORDINAL WINDOW from matching old options
    ctx.setPendingOptions([])
    ctx.setPendingOptionsMessageId(null)
    ctx.setPendingOptionsGraceCount(0)
    ctx.setActiveOptionSetId(null)
    ctx.setLastClarification(null)
    ctx.clearLastOptionsShown?.()
    ctx.clearClarificationSnapshot()

    void debugLog({
      component: 'ChatNavigation',
      action: 'grounding_clarifier_no_exec_data',
      metadata: {
        candidateCount: candidates.length,
        reason: 'option_candidates_not_in_message_history',
      },
    })

    return []
  }

  // Clear widget selection context to prevent cross-context ambiguity
  ctx.clearWidgetSelectionContext()

  ctx.setPendingOptions(pendingOptions)
  ctx.setPendingOptionsMessageId(messageId)
  ctx.setPendingOptionsGraceCount(0)
  ctx.saveLastOptionsShown(
    pendingOptions.map(opt => ({
      id: opt.id,
      label: opt.label,
      sublabel: opt.sublabel,
      type: opt.type,
    })),
    messageId
  )

  // Sync lastClarification so bare labels can be matched through handleClarificationIntercept.
  // This matches the pattern used in Tier 3c re-show options (lines 1609-1622).
  ctx.setLastClarification({
    type: 'option_selection',
    originalIntent: 'grounding_clarifier',
    messageId,
    timestamp: Date.now(),
    clarificationQuestion: 'Which one?',
    options: pendingOptions.map(opt => ({
      id: opt.id,
      label: opt.label,
      sublabel: opt.sublabel,
      type: opt.type,
    })),
    metaCount: 0,
  })

  void debugLog({
    component: 'ChatNavigation',
    action: 'grounding_clarifier_bound_options',
    metadata: {
      messageId,
      candidateCount: candidates.length,
      pendingCount: pendingOptions.length,
    },
  })

  return pendingOptions
}

// =============================================================================
// Pre-Latch Guard (Rule 12)
// =============================================================================

/**
 * Per selection-intent-arbitration-incubation-plan Rule 12:
 * If no latch is active, exactly one fresh visible list-segment candidate group
 * exists, and no active chat option set exists, ordinals default to that visible
 * widget list without clarifying.
 */
function isPreLatchDefault(
  turnSnapshot: import('@/lib/chat/ui-snapshot-builder').TurnSnapshotResult,
  ctx: RoutingDispatcherContext
): boolean {
  // Rule 12: all three conditions must hold
  // 1. No latch (caller already checked)
  // 2. Exactly one fresh visible list-segment candidate group
  const totalListSegments = turnSnapshot.openWidgets.reduce((sum, w) => sum + w.listSegmentCount, 0)
  if (totalListSegments !== 1) return false
  // 3. No active chat option set
  const chatActive = !!(ctx.lastClarification?.options?.length)
  if (chatActive) return false
  return true
}

// =============================================================================
// Unified Routing Dispatcher
// =============================================================================

/**
 * Dispatch user input through the canonical tier-ordered priority chain.
 *
 * Call order (per routing-order-priority-plan.md):
 *
 *   TIER 0 — Stop / Cancel          ─┐
 *   TIER 1 — Return / Resume / Repair ├─ handleClarificationIntercept()
 *   TIER 3 — Clarification (active)  ─┘
 *   TIER 2a — Explicit Command Bypass (clear pending options)
 *   TIER 2b — Cross-Corpus Retrieval
 *   TIER 2c — Panel Disambiguation
 *   TIER 2d — Meta-Explain
 *   TIER 2e — Correction
 *   TIER 2f — Follow-Up
 *   TIER 2g — Preview Shortcut ("show all" expansion)
 *   TIER S  — Suggestion Reject / Affirm (routing-only; sendMessage executes)
 *   TIER 3a — Selection-Only Guard (ordinals/labels on active or recent list)
 *   TIER 3b — Affirmation Without Context ("yes" with no suggestion)
 *   TIER 3c — Re-show Options ("show options", "what were those")
 *   TIER 4  — Known-Noun Commands    (allowlist + fuzzy match)
 *   TIER 5  — Doc Retrieval
 *
 * NOTE: Tiers 0, 1, 3-core are inside handleClarificationIntercept because they
 * share deep state (snapshot, repair memory, stop suppression). Extracting
 * them would require passing 25+ fields with no architectural benefit.
 * The tier order within that function is already correct.
 */
export async function dispatchRouting(
  ctx: RoutingDispatcherContext
): Promise<RoutingDispatcherResult> {
  const defaultResult: RoutingDispatcherResult = {
    handled: false,
    clarificationCleared: false,
    isNewQuestionOrCommandDetected: false,
    classifierCalled: false,
    classifierTimeout: false,
    classifierError: false,
    isFollowUp: false,
  }

  // Feature flag: selection intent arbitration (focus latch model)
  const isLatchEnabled = process.env.NEXT_PUBLIC_SELECTION_INTENT_ARBITRATION_V1 === 'true'

  // NOTE: lastOptionsShown turn increment is deferred to AFTER Tier 4.5
  // so the soft-active check can read the state before it expires on the same turn.
  // See increment call after the Tier 4.5 block below.

  // =========================================================================
  // BUILD TURN SNAPSHOT — used by ALL tiers (moved early for latch/intercept)
  // Per selection-intent-arbitration-incubation-plan.md: snapshot must be
  // available before intercept for focus-latch validity check.
  // =========================================================================
  const turnSnapshot = buildTurnSnapshot({})
  const hasVisibleWidgetItems = turnSnapshot.openWidgets.length > 0

  // DIAGNOSTIC: Log openWidgets state
  void debugLog({
    component: 'ChatNavigation',
    action: 'turn_snapshot_built',
    metadata: {
      openWidgetsCount: turnSnapshot.openWidgets.length,
      widgetLabels: turnSnapshot.openWidgets.map(w => w.label),
      widgetIds: turnSnapshot.openWidgets.map(w => w.id),
      widgetOptionCounts: turnSnapshot.openWidgets.map(w => w.options.length),
      hasBadgeLetters: turnSnapshot.hasBadgeLetters,
      activeSnapshotWidgetId: turnSnapshot.activeSnapshotWidgetId,
      input: ctx.trimmedInput,
    },
  })

  // Helper: set focus latch when a widget item is successfully resolved.
  // Called at ALL widget resolution return paths (Phase 5a completeness).
  const trySetWidgetLatch = (opts: { widgetId?: string; itemId?: string; trigger: string }) => {
    if (!isLatchEnabled) return
    let sourceWidget: typeof turnSnapshot.openWidgets[0] | undefined
    if (opts.widgetId) {
      sourceWidget = turnSnapshot.openWidgets.find(w => w.id === opts.widgetId)
    } else if (opts.itemId) {
      sourceWidget = turnSnapshot.openWidgets.find(w =>
        w.options.some(opt => opt.id === opts.itemId)
      )
    }
    if (sourceWidget) {
      ctx.setFocusLatch({
        kind: 'resolved',
        widgetId: sourceWidget.id,
        widgetLabel: sourceWidget.label,
        latchedAt: Date.now(),
        turnsSinceLatched: 0,
      })
      void debugLog({ component: 'ChatNavigation', action: 'focus_latch_set', metadata: { widgetId: sourceWidget.id, widgetLabel: sourceWidget.label, trigger: opts.trigger } })
    }
  }

  // Latch validity: check discriminated union kind for resolution/expiry
  if (isLatchEnabled && ctx.focusLatch) {
    if (ctx.focusLatch.kind === 'resolved') {
      // Capture narrowed type — TS narrows to ResolvedFocusLatch here
      const resolvedLatch = ctx.focusLatch
      // Resolved latch: verify widget is still open
      const stillOpen = turnSnapshot.openWidgets.some(w => w.id === resolvedLatch.widgetId)
      if (!stillOpen) {
        void debugLog({ component: 'ChatNavigation', action: 'focus_latch_cleared', metadata: { reason: 'widget_gone', widgetId: resolvedLatch.widgetId } })
        ctx.clearFocusLatch()
      }
    } else if (ctx.focusLatch.kind === 'pending') {
      // Capture narrowed type — TS narrows to PendingFocusLatch here
      const pendingLatch = ctx.focusLatch
      // Pending latch: try to resolve via panelId → widget slug
      const resolved = turnSnapshot.openWidgets.find(w => w.panelId === pendingLatch.pendingPanelId)
      if (resolved) {
        // Upgrade pending → resolved
        ctx.setFocusLatch({
          kind: 'resolved',
          widgetId: resolved.id,
          widgetLabel: pendingLatch.widgetLabel,
          latchedAt: pendingLatch.latchedAt,
          turnsSinceLatched: pendingLatch.turnsSinceLatched,
          suspended: pendingLatch.suspended,
        })
        void debugLog({ component: 'ChatNavigation', action: 'focus_latch_upgraded', metadata: { from: 'pending', widgetId: resolved.id, panelId: pendingLatch.pendingPanelId } })
      } else if (pendingLatch.turnsSinceLatched >= 2) {
        // Graceful degradation: pending latch expired without resolution
        void debugLog({ component: 'ChatNavigation', action: 'focus_latch_cleared', metadata: { reason: 'pending_expired', pendingPanelId: pendingLatch.pendingPanelId } })
        ctx.clearFocusLatch()
      }
      // else: keep pending alive (async registration window, turnsSinceLatched < 2)
    }
  }

  // Wrap all tier routing in try/finally to guarantee focus latch TTL increment
  // on ALL return paths (per selection-intent-arbitration-incubation-plan Phase 2c)
  try {

  // =========================================================================
  // Semantic Answer Lane — Early detection
  //
  // Must run before handleClarificationIntercept so the flag can be passed in.
  // Detects semantic question inputs ("explain what just happened", "why did I do that?")
  // and marks them for bypass of clarification, cross-corpus, grounding, and docs tiers.
  // Input still falls through to LLM API — this only prevents interception.
  // =========================================================================
  const isSemanticAnswerLaneEnabled = process.env.NEXT_PUBLIC_SEMANTIC_CONTINUITY_ANSWER_LANE_ENABLED === 'true'
  const semanticLaneDetected = isSemanticAnswerLaneEnabled && isSemanticQuestionInput(ctx.trimmedInput)
  if (semanticLaneDetected) {
    void debugLog({
      component: 'ChatNavigation',
      action: 'semantic_answer_lane_entry',
      metadata: {
        input: ctx.trimmedInput,
        hasLastAction: !!ctx.sessionState?.lastAction,
        actionHistoryLength: ctx.sessionState?.actionHistory?.length ?? 0,
      },
    })
    defaultResult.semanticLanePending = true
  }

  // =========================================================================
  // TIERS 0, 1, 3 — Clarification Intercept
  // (Stop/Cancel, Return/Resume/Repair, Active Clarification)
  //
  // This single handler covers three tiers because they share deep state
  // (snapshot lifecycle, repair memory, stop suppression). The internal
  // order is: Tier 0 → Tier 1 → Tier 3, matching the plan.
  // =========================================================================
  const clarificationResult = await handleClarificationIntercept({
    trimmedInput: ctx.trimmedInput,
    lastClarification: ctx.lastClarification,
    lastSuggestion: ctx.lastSuggestion,
    pendingOptions: ctx.pendingOptions,
    uiContext: ctx.uiContext,
    currentEntryId: ctx.currentEntryId,
    addMessage: ctx.addMessage,
    setLastClarification: ctx.setLastClarification,
    setIsLoading: ctx.setIsLoading,
    setPendingOptions: ctx.setPendingOptions,
    setPendingOptionsMessageId: ctx.setPendingOptionsMessageId,
    setPendingOptionsGraceCount: ctx.setPendingOptionsGraceCount,
    setNotesScopeFollowUpActive: ctx.setNotesScopeFollowUpActive,
    handleSelectOption: ctx.handleSelectOption,
    repairMemory: ctx.repairMemory,
    setRepairMemory: ctx.setRepairMemory,
    incrementRepairMemoryTurn: ctx.incrementRepairMemoryTurn,
    clearRepairMemory: ctx.clearRepairMemory,
    clarificationSnapshot: ctx.clarificationSnapshot,
    saveClarificationSnapshot: ctx.saveClarificationSnapshot,
    pauseSnapshotWithReason: ctx.pauseSnapshotWithReason,
    incrementSnapshotTurn: ctx.incrementSnapshotTurn,
    clearClarificationSnapshot: ctx.clearClarificationSnapshot,
    stopSuppressionCount: ctx.stopSuppressionCount,
    setStopSuppressionCount: ctx.setStopSuppressionCount,
    decrementStopSuppression: ctx.decrementStopSuppression,
    saveLastOptionsShown: ctx.saveLastOptionsShown,
    // Widget selection context (per universal-selection-resolver-plan.md)
    widgetSelectionContext: ctx.widgetSelectionContext,
    clearWidgetSelectionContext: ctx.clearWidgetSelectionContext,
    setActiveOptionSetId: ctx.setActiveOptionSetId,
    // Focus latch (per selection-intent-arbitration-incubation-plan.md)
    // When feature flag is off, pass null/no-ops so latch checks are inactive
    focusLatch: isLatchEnabled ? ctx.focusLatch : null,
    setFocusLatch: isLatchEnabled ? ctx.setFocusLatch : () => {},
    suspendFocusLatch: isLatchEnabled ? ctx.suspendFocusLatch : () => {},
    clearFocusLatch: isLatchEnabled ? ctx.clearFocusLatch : () => {},
    hasVisibleWidgetItems,
    totalListSegmentCount: turnSnapshot.openWidgets.reduce((sum, w) => sum + w.listSegmentCount, 0),
    lastOptionsShown: ctx.lastOptionsShown,
    isLatchEnabled,
    activeSnapshotWidgetId: isLatchEnabled ? (turnSnapshot.activeSnapshotWidgetId ?? null) : null,
    // Scope-cue recovery memory (explicit-only, per scope-cue-recovery-plan)
    scopeCueRecoveryMemory: ctx.scopeCueRecoveryMemory,
    clearScopeCueRecoveryMemory: ctx.clearScopeCueRecoveryMemory,
    // Selection continuity (Plan 20 — per Plan 19 canonical contract)
    selectionContinuity: ctx.selectionContinuity,
    updateSelectionContinuity: ctx.updateSelectionContinuity,
    resetSelectionContinuity: ctx.resetSelectionContinuity,
    // Phase 10: Semantic answer lane (escape hatch for semantic question inputs)
    semanticLaneDetected,
  })

  const { clarificationCleared, isNewQuestionOrCommandDetected } = clarificationResult

  if (clarificationResult.handled) {
    // Per plan §10: clear stale suggestion state when stop/interrupt fires
    if (ctx.lastSuggestion) {
      ctx.setLastSuggestion(null)
    }
    return {
      handled: true,
      handledByTier: 0, // Could be 0, 1, or 3 — logged internally
      tierLabel: 'clarification_intercept',
      clarificationCleared,
      isNewQuestionOrCommandDetected,
      classifierCalled: false,
      classifierTimeout: false,
      classifierError: false,
      isFollowUp: false,
      _devProvenanceHint: clarificationResult._devProvenanceHint,
    }
  }

  // =========================================================================
  // TIER 2 — New Topic / Interrupt Commands
  //
  // Explicit commands bypass pending options and execute immediately.
  // Panel disambiguation catches multi-panel matches deterministically.
  // Cross-corpus handles notes-corpus-intent detection.
  // Meta-explain, correction, follow-up handle specific response patterns.
  // Preview shortcut expands a recent preview list.
  // =========================================================================

  // Tier 2a: Explicit Command Bypass — clear pending options for verb commands
  if (isExplicitCommand(ctx.trimmedInput)) {
    const lastOptionsMessage = ctx.findLastOptionsMessage(ctx.messages)
    const hasRecentOptions = lastOptionsMessage &&
      (Date.now() - lastOptionsMessage.timestamp.getTime()) <= ctx.reshowWindowMs

    if (ctx.pendingOptions.length > 0 || hasRecentOptions) {
      void debugLog({
        component: 'ChatNavigation',
        action: 'explicit_command_bypass',
        metadata: {
          input: ctx.trimmedInput,
          hadPendingOptions: ctx.pendingOptions.length > 0,
          hadRecentOptions: !!hasRecentOptions,
          tier: 2,
        },
      })

      ctx.setPendingOptions([])
      ctx.setPendingOptionsMessageId(null)
      ctx.setPendingOptionsGraceCount(0)
    }
    // Don't return — let the command proceed through remaining tiers
  }

  // ==========================================================================
  // Widget Selection Context Guard — Skip Tier 2b for selection follow-ups
  //
  // Per universal-selection-resolver-plan.md: If widgetSelectionContext is active
  // and input is selection-like and not a question, skip cross-corpus retrieval
  // so the universal resolver (Tier 3.5) can handle it.
  // ==========================================================================
  // Focus latch / pre-latch skip: when a widget has focus (latch active or
  // pre-latch focused via activeSnapshotWidgetId) and input is selection-like,
  // skip cross-corpus so Tier 4.5 resolves against widget items.
  // Note: ctx.focusLatch may be stale (React state from previous render) when
  // the intercept just set it via setFocusLatch. Use turnSnapshot.activeSnapshotWidgetId
  // as the reliable synchronous signal.
  const skipCrossCorpusForFocusLatch = isLatchEnabled
    && isSelectionLike(ctx.trimmedInput)
    && !hasQuestionIntent(ctx.trimmedInput)
    && !isExplicitCommand(ctx.trimmedInput)
    && (
      (ctx.focusLatch && !ctx.focusLatch.suspended)  // Active latch
      || ((!ctx.focusLatch || ctx.focusLatch.suspended)  // Pre-latch
        && !!turnSnapshot.activeSnapshotWidgetId
        && !ctx.lastClarification?.options?.length)
    )

  const skipCrossCorpusForWidgetSelection = (ctx.widgetSelectionContext !== null
    && isSelectionLike(ctx.trimmedInput)
    && !hasQuestionIntent(ctx.trimmedInput))
    || skipCrossCorpusForFocusLatch

  if (semanticLaneDetected) {
    void debugLog({
      component: 'ChatNavigation',
      action: 'semantic_lane_skip_cross_corpus',
      metadata: { input: ctx.trimmedInput },
    })
  }

  if (skipCrossCorpusForWidgetSelection || semanticLaneDetected) {
    if (skipCrossCorpusForWidgetSelection) {
      void debugLog({
        component: 'ChatNavigation',
        action: 'skip_cross_corpus_widget_context',
        metadata: {
          input: ctx.trimmedInput,
          widgetId: ctx.widgetSelectionContext?.widgetId,
          reason: skipCrossCorpusForFocusLatch
            ? 'focus_latch_or_prelatch_active_and_selection_like'
            : 'widget_selection_context_active_and_selection_like',
        },
      })
    }
    // Fall through to Tier 2c, 3.5, etc.
  } else {
    // Tier 2b: Cross-Corpus Retrieval
    const crossCorpusResult = await handleCrossCorpusRetrieval({
      trimmedInput: ctx.trimmedInput,
      docRetrievalState: ctx.docRetrievalState,
      visibleWidgets: ctx.uiContext?.dashboard?.visibleWidgets,
      addMessage: ctx.addMessage,
      updateDocRetrievalState: ctx.updateDocRetrievalState,
      setIsLoading: ctx.setIsLoading,
      setPendingOptions: ctx.setPendingOptions,
      setPendingOptionsMessageId: ctx.setPendingOptionsMessageId as (messageId: string) => void,
      setLastClarification: ctx.setLastClarification,
    })
    if (crossCorpusResult.handled) {
      return {
        ...defaultResult,
        handled: true,
        handledByTier: 2,
        tierLabel: 'cross_corpus',
        clarificationCleared,
        isNewQuestionOrCommandDetected,
      }
    }
  }

  // Tier 2c: Panel Disambiguation (deterministic, pre-LLM)
  // Question intent override: "what is links panel?" should route to docs (Tier 5),
  // not get caught by token-subset matching in panel disambiguation.
  // Exception: polite commands like "can you open links panel" have question intent
  // (^can) but should still reach Tier 2c when they match visible panels.
  const questionIntentBlocks = (() => {
    if (!hasQuestionIntent(ctx.trimmedInput)) return false
    // Check if this is actually a polite command that matches visible panels
    const dw = ctx.uiContext?.mode === 'dashboard' ? ctx.uiContext?.dashboard?.visibleWidgets : undefined
    const pe = dw?.length ? matchVisiblePanelCommand(ctx.trimmedInput, dw) : null
    if (pe && pe.type !== 'none') {
      void debugLog({
        component: 'ChatNavigation',
        action: 'question_intent_overridden_by_panel_evidence',
        metadata: { input: ctx.trimmedInput, matchType: pe.type, matchCount: pe.matches.length, tier: '2c' },
      })
      return false // Polite command — don't block Tier 2c
    }
    return true // Genuine question — block Tier 2c
  })()
  if (questionIntentBlocks) {
    void debugLog({
      component: 'ChatNavigation',
      action: 'skip_panel_disambiguation_question_intent',
      metadata: { input: ctx.trimmedInput, reason: 'question_intent_detected', tier: '2c' },
    })
    // Skip Tier 2c — fall through to later tiers (Tier 4 isFullQuestionAboutNoun or Tier 5 docs)
  } else {
    const panelDisambiguationResult = handlePanelDisambiguation({
      trimmedInput: ctx.trimmedInput,
      visibleWidgets: ctx.uiContext?.dashboard?.visibleWidgets,
      addMessage: ctx.addMessage,
      setIsLoading: ctx.setIsLoading,
      setPendingOptions: ctx.setPendingOptions,
      setPendingOptionsMessageId: ctx.setPendingOptionsMessageId,
      setLastClarification: ctx.setLastClarification,
      saveLastOptionsShown: ctx.saveLastOptionsShown,
      clearWidgetSelectionContext: ctx.clearWidgetSelectionContext,
      clearFocusLatch: isLatchEnabled ? ctx.clearFocusLatch : undefined,
      openPanelDrawer: ctx.openPanelDrawer,
    })
    if (panelDisambiguationResult.handled) {
      return {
        ...defaultResult,
        handled: true,
        handledByTier: 2,
        tierLabel: 'panel_disambiguation',
        clarificationCleared,
        isNewQuestionOrCommandDetected,
      }
    }
  }

  // Tier 2d: Meta-Explain
  // Semantic answer lane: skip meta-explain for semantic question inputs.
  // "explain what just happened" matches isMetaExplainOutsideClarification (startsWith('explain ')),
  // which would return handled: true and block the input from reaching the LLM API.
  if (semanticLaneDetected) {
    void debugLog({
      component: 'ChatNavigation',
      action: 'semantic_lane_skip_meta_explain',
      metadata: { input: ctx.trimmedInput },
    })
  }
  const metaExplainResult = !semanticLaneDetected ? await handleMetaExplain({
    trimmedInput: ctx.trimmedInput,
    docRetrievalState: ctx.docRetrievalState,
    messages: ctx.messages,
    lastClarification: ctx.lastClarification,
    clarificationCleared,
    knownTermsFetchStatus: ctx.knownTermsFetchStatus,
    usedCoreAppTermsFallback: ctx.usedCoreAppTermsFallback,
    addMessage: ctx.addMessage,
    updateDocRetrievalState: ctx.updateDocRetrievalState,
    setIsLoading: ctx.setIsLoading,
    setPendingOptions: ctx.setPendingOptions,
    setPendingOptionsMessageId: ctx.setPendingOptionsMessageId as (messageId: string) => void,
    setLastClarification: ctx.setLastClarification,
    saveLastOptionsShown: ctx.saveLastOptionsShown,
  }) : { handled: false }
  if (metaExplainResult.handled) {
    return {
      ...defaultResult,
      handled: true,
      handledByTier: 2,
      tierLabel: 'meta_explain',
      clarificationCleared,
      isNewQuestionOrCommandDetected,
    }
  }

  // Tier 2e: Correction ("no / not that" after doc retrieval)
  const correctionResult = handleCorrection({
    trimmedInput: ctx.trimmedInput,
    docRetrievalState: ctx.docRetrievalState,
    knownTermsFetchStatus: ctx.knownTermsFetchStatus,
    usedCoreAppTermsFallback: ctx.usedCoreAppTermsFallback,
    addMessage: ctx.addMessage,
    updateDocRetrievalState: ctx.updateDocRetrievalState,
    setIsLoading: ctx.setIsLoading,
  })
  if (correctionResult.handled) {
    return {
      ...defaultResult,
      handled: true,
      handledByTier: 2,
      tierLabel: 'correction',
      clarificationCleared,
      isNewQuestionOrCommandDetected,
    }
  }

  // Tier 2f: Follow-Up ("tell me more", pronoun follow-up)
  const followUpResult = await handleFollowUp({
    trimmedInput: ctx.trimmedInput,
    docRetrievalState: ctx.docRetrievalState,
    isNewQuestionOrCommandDetected,
    knownTermsFetchStatus: ctx.knownTermsFetchStatus,
    usedCoreAppTermsFallback: ctx.usedCoreAppTermsFallback,
    addMessage: ctx.addMessage,
    updateDocRetrievalState: ctx.updateDocRetrievalState,
    setIsLoading: ctx.setIsLoading,
  })

  const {
    classifierCalled,
    classifierResult,
    classifierTimeout,
    classifierLatencyMs,
    classifierError,
  } = followUpResult
  const isFollowUp = followUpResult.handled

  if (followUpResult.handled) {
    return {
      ...defaultResult,
      handled: true,
      handledByTier: 2,
      tierLabel: 'follow_up',
      clarificationCleared,
      isNewQuestionOrCommandDetected,
      classifierCalled,
      classifierResult,
      classifierTimeout,
      classifierLatencyMs,
      classifierError,
      isFollowUp: true,
    }
  }

  // Tier 2g: Preview Shortcut — "show all" expansion when a preview exists
  const PREVIEW_TIMEOUT_MS = 2 * 60 * 1000 // 2 minutes
  const previewIsRecent = ctx.lastPreview && (Date.now() - ctx.lastPreview.createdAt) < PREVIEW_TIMEOUT_MS

  if (previewIsRecent && ctx.lastPreview && matchesShowAllHeuristic(ctx.trimmedInput)) {
    // Keyword heuristic matched - open view panel directly
    void debugLog({
      component: 'ChatNavigation',
      action: 'show_all_shortcut',
      metadata: { source: ctx.lastPreview.source, totalCount: ctx.lastPreview.totalCount, method: 'heuristic', tier: '2g' },
    })

    if (ctx.lastPreview.drawerPanelId) {
      const previewMeta = classifyExecutionMeta({
        matchKind: 'context_expand',
        candidateCount: 1,
        resolverPath: 'previewShortcut',
      })
      ctx.openPanelDrawer(ctx.lastPreview.drawerPanelId, ctx.lastPreview.drawerPanelTitle, previewMeta)
    } else {
      ctx.openPanelWithTracking(ctx.lastPreview.viewPanelContent, ctx.lastPreview.drawerPanelId)
    }

    const assistantMessage: ChatMessage = {
      id: `assistant-${Date.now()}`,
      role: 'assistant',
      content: `Opening full list for ${ctx.lastPreview.source}.`,
      timestamp: new Date(),
      isError: false,
    }
    ctx.addMessage(assistantMessage)
    ctx.setIsLoading(false)
    return {
      ...defaultResult,
      handled: true,
      handledByTier: 2,
      tierLabel: 'preview_shortcut_heuristic',
      clarificationCleared,
      isNewQuestionOrCommandDetected,
      classifierCalled,
      classifierResult,
      classifierTimeout,
      classifierLatencyMs,
      classifierError,
      isFollowUp,
    }
  }

  // Tier 2g (cont.): LLM classifier fallback — if preview exists but heuristic didn't match,
  // ask the LLM if user wants to expand the preview
  if (previewIsRecent && ctx.lastPreview && !hasGraceSkipActionVerb(ctx.trimmedInput)) {
    try {
      const classifyResponse = await fetch('/api/chat/classify-expand', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          userMessage: ctx.trimmedInput,
          previewSource: ctx.lastPreview.source,
          previewCount: ctx.lastPreview.totalCount,
        }),
      })

      if (classifyResponse.ok) {
        const { expand } = await classifyResponse.json()
        if (expand) {
          void debugLog({
            component: 'ChatNavigation',
            action: 'show_all_shortcut',
            metadata: { source: ctx.lastPreview.source, totalCount: ctx.lastPreview.totalCount, method: 'classifier', tier: '2g' },
          })

          if (ctx.lastPreview.drawerPanelId) {
            const classifierMeta = classifyExecutionMeta({
              matchKind: 'context_expand',
              candidateCount: 1,
              resolverPath: 'previewShortcut',
            })
            ctx.openPanelDrawer(ctx.lastPreview.drawerPanelId, ctx.lastPreview.drawerPanelTitle, classifierMeta)
          } else {
            ctx.openPanelWithTracking(ctx.lastPreview.viewPanelContent, ctx.lastPreview.drawerPanelId)
          }

          const assistantMessage: ChatMessage = {
            id: `assistant-${Date.now()}`,
            role: 'assistant',
            content: `Opening full list for ${ctx.lastPreview.source}.`,
            timestamp: new Date(),
            isError: false,
          }
          ctx.addMessage(assistantMessage)
          ctx.setIsLoading(false)
          return {
            ...defaultResult,
            handled: true,
            handledByTier: 2,
            tierLabel: 'preview_shortcut_classifier',
            clarificationCleared,
            isNewQuestionOrCommandDetected,
            classifierCalled,
            classifierResult,
            classifierTimeout,
            classifierLatencyMs,
            classifierError,
            isFollowUp,
          }
        }
      }
    } catch (classifyError) {
      // Classifier failed - continue with normal intent parsing
      void debugLog({
        component: 'ChatNavigation',
        action: 'classify_expand_error',
        metadata: { error: String(classifyError), tier: '2g' },
      })
    }
  }

  // =========================================================================
  // TIER S — Suggestion Reject / Affirm
  //
  // Per suggestion-routing-unification-plan.md:
  // Runs AFTER stop/return/interrupt (Tiers 0–2) so "stop" is never
  // misinterpreted as a rejection. Returns a routing-only action for
  // sendMessage() to execute (no API calls in the dispatcher).
  //
  // Per plan §10: if stop/interrupt fired earlier while a suggestion was
  // active, clear lastSuggestion to avoid stale confirm/reject on next turn.
  // This is handled by the clarificationCleared flag — if clarification
  // intercept handled the input, we never reach this point.
  // =========================================================================
  if (ctx.lastSuggestion) {
    // Rejection: "no", "nope", "cancel" etc.
    if (isRejectionPhrase(ctx.trimmedInput)) {
      const rejectedLabels = ctx.lastSuggestion.candidates.map(c => c.label)

      void debugLog({
        component: 'ChatNavigation',
        action: 'suggestion_rejected',
        metadata: { rejectedLabels, userInput: ctx.trimmedInput, tier: 'S' },
      })

      // Clear suggestion state
      ctx.addRejectedSuggestions(rejectedLabels)
      ctx.setLastSuggestion(null)

      // Build response message
      let alternativesMessage = 'Okay — what would you like instead?'
      if (ctx.lastSuggestion.candidates.length > 1) {
        const alternativesList = ctx.lastSuggestion.candidates.map(c => c.label.toLowerCase()).join(', ')
        alternativesMessage = `Okay — what would you like instead?\nYou can try: ${alternativesList}.`
      }

      const assistantMessage: ChatMessage = {
        id: `assistant-${Date.now()}`,
        role: 'assistant',
        content: alternativesMessage,
        timestamp: new Date(),
        isError: false,
      }
      ctx.addMessage(assistantMessage)
      ctx.setIsLoading(false)

      return {
        ...defaultResult,
        handled: true,
        handledByTier: 2,
        tierLabel: 'suggestion_reject',
        suggestionAction: {
          type: 'reject',
          rejectedLabels,
          alternativesMessage,
        },
        clarificationCleared,
        isNewQuestionOrCommandDetected,
      }
    }

    // Affirmation: "yes", "yeah", "sure" etc.
    if (isAffirmationPhrase(ctx.trimmedInput)) {
      const candidates = ctx.lastSuggestion.candidates

      if (candidates.length === 1) {
        // Single candidate: return action for sendMessage() to execute
        const candidate = candidates[0]

        void debugLog({
          component: 'ChatNavigation',
          action: 'affirmation_confirm_single',
          metadata: { candidate: candidate.label, primaryAction: candidate.primaryAction, tier: 'S' },
        })

        // Clear suggestion state (before API call in sendMessage)
        ctx.setLastSuggestion(null)
        ctx.clearRejectedSuggestions()

        return {
          ...defaultResult,
          handled: true,
          handledByTier: 2,
          tierLabel: 'suggestion_affirm_single',
          suggestionAction: {
            type: 'affirm_single',
            candidate,
          },
          clarificationCleared,
          isNewQuestionOrCommandDetected,
        }
      } else {
        // Multiple candidates: ask which one
        void debugLog({
          component: 'ChatNavigation',
          action: 'affirmation_multiple_candidates',
          metadata: { candidateCount: candidates.length, tier: 'S' },
        })

        const assistantMessage: ChatMessage = {
          id: `assistant-${Date.now()}`,
          role: 'assistant',
          content: 'Which one?',
          timestamp: new Date(),
          isError: false,
          suggestions: {
            type: 'choose_multiple' as const,
            candidates: candidates,
          },
        }
        ctx.addMessage(assistantMessage)
        ctx.setIsLoading(false)

        return {
          ...defaultResult,
          handled: true,
          handledByTier: 2,
          tierLabel: 'suggestion_affirm_multiple',
          suggestionAction: {
            type: 'affirm_multiple',
            candidates,
          },
          clarificationCleared,
          isNewQuestionOrCommandDetected,
        }
      }
    }
  }

  // =========================================================================
  // TIER 3 — Clarification Sub-Tiers (post-intercept)
  //
  // These run after Tier 2 handlers. They handle selection patterns,
  // affirmation without context, and re-show options — all clarification-
  // adjacent behaviors that don't need deep snapshot state.
  // =========================================================================

  // Tier 3a: Selection-Only Guard — ordinals/labels on active option set
  // Guard #1 (per routing-order-priority-plan.md line 81):
  // "Runs only when activeOptionSetId != null (don't bind to old visible pills in history)"
  // Question intent override: questions like "what is X?" should never bind to active list
  // Widget context bypass (per universal-selection-resolver-plan.md Phase 5.2):
  // If widgetSelectionContext is active, skip this guard and defer to universal resolver
  // Focus latch bypass (per selection-intent-arbitration-incubation-plan.md Rule 2, 6):
  // When latch is active, selection-like input must resolve against the latched widget
  // in Tier 4.5, NOT against stale/recoverable chat options here.
  const hasActiveFocusLatch = isLatchEnabled && ctx.focusLatch && !ctx.focusLatch.suspended
  // Pre-latch bypass (per incubation plan Rule 12, relaxed with Phase 0 focus signal):
  // When a focused widget exists (activeSnapshotWidgetId) or exactly one list-segment visible,
  // no active chat, and input is selection-like → skip Tier 3a so Tier 4.5 resolves against widget.
  const isPreLatchWidgetScope = isLatchEnabled
    && (!ctx.focusLatch || ctx.focusLatch.suspended)
    && (isPreLatchDefault(turnSnapshot, ctx) || (!!turnSnapshot.activeSnapshotWidgetId && !ctx.lastClarification?.options?.length))
    && isSelectionLike(ctx.trimmedInput)
  if (ctx.pendingOptions.length > 0 && ctx.activeOptionSetId !== null && !hasQuestionIntent(ctx.trimmedInput) && !ctx.widgetSelectionContext && !hasActiveFocusLatch && !isPreLatchWidgetScope) {
    const optionLabels = ctx.pendingOptions.map(opt => opt.label)
    const selectionResult = isSelectionOnly(ctx.trimmedInput, ctx.pendingOptions.length, optionLabels, 'strict')

    if (selectionResult.isSelection && selectionResult.index !== undefined) {
      // Pure selection pattern - handle locally for speed
      const selectedOption = ctx.pendingOptions[selectionResult.index]

      void debugLog({
        component: 'ChatNavigation',
        action: 'selection_only_guard',
        metadata: {
          input: ctx.trimmedInput,
          index: selectionResult.index,
          selectedLabel: selectedOption.label,
          tier: '3a',
        },
        // V5 Metrics: Track clarification resolved
        metrics: {
          event: 'clarification_resolved',
          selectedLabel: selectedOption.label,
          timestamp: Date.now(),
        },
      })

      // Use grace window: keep options for one more turn
      ctx.setPendingOptionsGraceCount(1)

      if (selectedOption.type === 'widget_option') {
        const widgetInfo = resolveWidgetItemFromSnapshots(ctx.getVisibleSnapshots, selectedOption.id)
        if (widgetInfo) {
          trySetWidgetLatch({ widgetId: widgetInfo.widgetId, trigger: 'selection_only_widget_option' })
          ctx.setIsLoading(false)
          return {
            ...defaultResult,
            handled: true,
            handledByTier: 3,
            tierLabel: 'selection_only_widget_option',
            clarificationCleared,
            isNewQuestionOrCommandDetected,
            classifierCalled,
            classifierResult,
            classifierTimeout,
            classifierLatencyMs,
            classifierError,
            isFollowUp,
            groundingAction: {
              type: 'execute_widget_item',
              widgetId: widgetInfo.widgetId,
              segmentId: widgetInfo.segmentId,
              itemId: selectedOption.id,
              itemLabel: selectedOption.label,
              action: 'open',
            },
          }
        }
      }

      // Execute the selection directly
      const optionToSelect: SelectionOption = {
        type: selectedOption.type as SelectionOption['type'],
        id: selectedOption.id,
        label: selectedOption.label,
        sublabel: selectedOption.sublabel,
        data: selectedOption.data as SelectionOption['data'],
      }

      ctx.setIsLoading(false)
      ctx.handleSelectOption(optionToSelect)
      return {
        ...defaultResult,
        handled: true,
        handledByTier: 3,
        tierLabel: 'selection_only_guard',
        clarificationCleared,
        isNewQuestionOrCommandDetected,
        classifierCalled,
        classifierResult,
        classifierTimeout,
        classifierLatencyMs,
        classifierError,
        isFollowUp,
      }
    }

    // Phase 2a.1: Try label matching for visible options
    // e.g., "workspace 6" matches "Workspace 6 (Home)"
    const labelMatch = findExactOptionMatch(ctx.trimmedInput, ctx.pendingOptions)
    if (labelMatch) {
      void debugLog({
        component: 'ChatNavigation',
        action: 'label_match_selection',
        metadata: {
          input: ctx.trimmedInput,
          matchedLabel: labelMatch.label,
          tier: '3a',
        },
        // V5 Metrics: Track clarification resolved via label match
        metrics: {
          event: 'clarification_resolved',
          selectedLabel: labelMatch.label,
          timestamp: Date.now(),
        },
      })

      // Use grace window: keep options for one more turn
      ctx.setPendingOptionsGraceCount(1)

      if (labelMatch.type === 'widget_option') {
        const widgetInfo = resolveWidgetItemFromSnapshots(ctx.getVisibleSnapshots, labelMatch.id)
        if (widgetInfo) {
          trySetWidgetLatch({ widgetId: widgetInfo.widgetId, trigger: 'label_match_widget_option' })
          ctx.setIsLoading(false)
          return {
            ...defaultResult,
            handled: true,
            handledByTier: 3,
            tierLabel: 'label_match_widget_option',
            clarificationCleared,
            isNewQuestionOrCommandDetected,
            classifierCalled,
            classifierResult,
            classifierTimeout,
            classifierLatencyMs,
            classifierError,
            isFollowUp,
            groundingAction: {
              type: 'execute_widget_item',
              widgetId: widgetInfo.widgetId,
              segmentId: widgetInfo.segmentId,
              itemId: labelMatch.id,
              itemLabel: labelMatch.label,
              action: 'open',
            },
          }
        }
      }

      // Execute the selection directly
      const optionToSelect: SelectionOption = {
        type: labelMatch.type as SelectionOption['type'],
        id: labelMatch.id,
        label: labelMatch.label,
        sublabel: labelMatch.sublabel,
        data: labelMatch.data as SelectionOption['data'],
      }

      ctx.setIsLoading(false)
      ctx.handleSelectOption(optionToSelect)
      return {
        ...defaultResult,
        handled: true,
        handledByTier: 3,
        tierLabel: 'label_match_selection',
        clarificationCleared,
        isNewQuestionOrCommandDetected,
        classifierCalled,
        classifierResult,
        classifierTimeout,
        classifierLatencyMs,
        classifierError,
        isFollowUp,
      }
    }

    // Not a pure selection or label match.
    // Per clarification-response-fit-plan.md "Selection-Like Typos (NEW)":
    // Step 2: If input looks selection-like, call constrained LLM before falling through.
    // Step 3: If LLM abstains/low confidence → ask_clarify (NOT route to docs).
    if (looksSelectionLike(ctx.trimmedInput) && isLLMFallbackEnabledClient()) {
      void debugLog({
        component: 'ChatNavigation',
        action: 'selection_typo_llm_fallback_attempt',
        metadata: { input: ctx.trimmedInput, pendingCount: ctx.pendingOptions.length, tier: '3a' },
      })

      try {
        const llmResult = await callClarificationLLMClient({
          userInput: ctx.trimmedInput,
          options: ctx.pendingOptions.map(opt => ({
            id: opt.id,
            label: opt.label,
            sublabel: opt.sublabel,
          })),
          context: 'selection_typo_fallback',
        })

        if (llmResult.success && llmResult.response) {
          const { decision, choiceId, confidence } = llmResult.response

          void debugLog({
            component: 'ChatNavigation',
            action: 'selection_typo_llm_result',
            metadata: {
              input: ctx.trimmedInput,
              decision,
              choiceId,
              confidence,
              latencyMs: llmResult.latencyMs,
              tier: '3a',
            },
          })

          // LLM selected an option with sufficient confidence
          if (decision === 'select' && choiceId) {
            const matchedOption = ctx.pendingOptions.find(opt => opt.id === choiceId)
            if (matchedOption) {
              ctx.setPendingOptionsGraceCount(1)
              const optionToSelect: SelectionOption = {
                type: matchedOption.type as SelectionOption['type'],
                id: matchedOption.id,
                label: matchedOption.label,
                sublabel: matchedOption.sublabel,
                data: matchedOption.data as SelectionOption['data'],
              }
              ctx.setIsLoading(false)
              ctx.handleSelectOption(optionToSelect)
              return {
                ...defaultResult,
                handled: true,
                handledByTier: 3,
                tierLabel: 'selection_typo_llm_select',
                clarificationCleared,
                isNewQuestionOrCommandDetected,
                classifierCalled: true,
                classifierResult: true,
                classifierTimeout,
                classifierLatencyMs: llmResult.latencyMs,
                classifierError,
                isFollowUp,
              }
            }
          }

          // LLM abstained or low confidence → ask_clarify (do NOT route to docs)
          if (decision === 'ask_clarify' || decision === 'none' || !choiceId) {
            const askMessage: ChatMessage = {
              id: `assistant-${Date.now()}`,
              role: 'assistant',
              content: "I couldn't tell which option you meant. Could you try again or say 'back to options' to see the list?",
              timestamp: new Date(),
              isError: false,
            }
            ctx.addMessage(askMessage)
            ctx.setIsLoading(false)
            return {
              ...defaultResult,
              handled: true,
              handledByTier: 3,
              tierLabel: 'selection_typo_llm_ask_clarify',
              clarificationCleared,
              isNewQuestionOrCommandDetected,
              classifierCalled: true,
              classifierResult: false,
              classifierTimeout,
              classifierLatencyMs: llmResult.latencyMs,
              classifierError,
              isFollowUp,
            }
          }

          // decision === 'reroute' or 'reject_list' → let it fall through to later tiers
        }
        // LLM call failed — fall through gracefully
      } catch (llmError) {
        void debugLog({
          component: 'ChatNavigation',
          action: 'selection_typo_llm_error',
          metadata: { input: ctx.trimmedInput, error: String(llmError), tier: '3a' },
        })
        // On LLM error, fall through to later tiers (graceful degradation)
      }
    } else {
      // Not selection-like or LLM disabled — log passthrough
      void debugLog({
        component: 'ChatNavigation',
        action: 'selection_guard_passthrough',
        metadata: { input: ctx.trimmedInput, pendingCount: ctx.pendingOptions.length, tier: '3a' },
      })
    }
  }

  // Tier 3a (cont.): Fallback Selection — use message-derived options when pendingOptions is empty
  // but activeOptionSetId is still set (options were presented recently and not yet cleared)
  // Focus latch + pre-latch bypass: same guards as primary Tier 3a — when latch is active or
  // pre-latch conditions met (Rule 12), skip message-derived selection to let Tier 4.5 resolve.
  if (ctx.pendingOptions.length === 0 && ctx.activeOptionSetId !== null && !hasQuestionIntent(ctx.trimmedInput) && !hasActiveFocusLatch && !isPreLatchWidgetScope) {
    const now = Date.now()
    const lastOptionsMessage = ctx.findLastOptionsMessage(ctx.messages)
    const messageAge = lastOptionsMessage ? now - lastOptionsMessage.timestamp.getTime() : null
    const isWithinGraceWindow = lastOptionsMessage && messageAge !== null && messageAge <= ctx.reshowWindowMs

    if (isWithinGraceWindow && lastOptionsMessage) {
      // Use selection-only guard for message-derived options too
      const optionLabels = lastOptionsMessage.options.map(opt => opt.label)
      const selectionResult = isSelectionOnly(ctx.trimmedInput, lastOptionsMessage.options.length, optionLabels, 'strict')

      if (selectionResult.isSelection && selectionResult.index !== undefined) {
        const selectedOption = lastOptionsMessage.options[selectionResult.index]
        void debugLog({
          component: 'ChatNavigation',
          action: 'selection_from_message',
          metadata: {
            input: ctx.trimmedInput,
            index: selectionResult.index,
            selectedLabel: selectedOption.label,
            tier: '3a',
          },
        })

        // Per universal-selection-resolver-plan.md: clear widget context when restoring chat options
        ctx.clearWidgetSelectionContext()
        // Restore pendingOptions and execute selection
        ctx.setPendingOptions(lastOptionsMessage.options)
        const optionToSelect: SelectionOption = {
          type: selectedOption.type as SelectionOption['type'],
          id: selectedOption.id,
          label: selectedOption.label,
          sublabel: selectedOption.sublabel,
          data: selectedOption.data as SelectionOption['data'],
        }
        ctx.setIsLoading(false)
        ctx.handleSelectOption(optionToSelect)
        return {
          ...defaultResult,
          handled: true,
          handledByTier: 3,
          tierLabel: 'selection_from_message',
          clarificationCleared,
          isNewQuestionOrCommandDetected,
          classifierCalled,
          classifierResult,
          classifierTimeout,
          classifierLatencyMs,
          classifierError,
          isFollowUp,
        }
      }

      // Tier 3a (cont.): Label/shorthand matching for message-derived options
      // isSelectionOnly only matches ordinals ("first", "2", "d").
      // findExactOptionMatch handles shorthand like "panel e", "workspace 6",
      // "links panel d" via label contains/startsWith/exact matching.
      const labelMatch = findExactOptionMatch(ctx.trimmedInput, lastOptionsMessage.options)
      if (labelMatch) {
        void debugLog({
          component: 'ChatNavigation',
          action: 'label_match_from_message',
          metadata: {
            input: ctx.trimmedInput,
            matchedLabel: labelMatch.label,
            tier: '3a',
          },
        })

        // Per universal-selection-resolver-plan.md: clear widget context when restoring chat options
        ctx.clearWidgetSelectionContext()
        // Restore pendingOptions and execute selection
        ctx.setPendingOptions(lastOptionsMessage.options)
        const optionToSelect: SelectionOption = {
          type: labelMatch.type as SelectionOption['type'],
          id: labelMatch.id,
          label: labelMatch.label,
          sublabel: labelMatch.sublabel,
          data: labelMatch.data as SelectionOption['data'],
        }
        ctx.setIsLoading(false)
        ctx.handleSelectOption(optionToSelect)
        return {
          ...defaultResult,
          handled: true,
          handledByTier: 3,
          tierLabel: 'label_match_from_message',
          clarificationCleared,
          isNewQuestionOrCommandDetected,
          classifierCalled,
          classifierResult,
          classifierTimeout,
          classifierLatencyMs,
          classifierError,
          isFollowUp,
        }
      }

      // Not a pure selection or label match - let it go to LLM with context
      void debugLog({
        component: 'ChatNavigation',
        action: 'message_options_passthrough_to_llm',
        metadata: { input: ctx.trimmedInput, optionsCount: lastOptionsMessage.options.length, tier: '3a' },
      })
    }
  }

  // Tier 3b: Affirmation Without Context — "yes" when no active suggestion
  if (!ctx.lastSuggestion && isAffirmationPhrase(ctx.trimmedInput)) {
    void debugLog({
      component: 'ChatNavigation',
      action: 'affirmation_without_context',
      metadata: { userInput: ctx.trimmedInput, tier: '3b' },
    })

    const assistantMessage: ChatMessage = {
      id: `assistant-${Date.now()}`,
      role: 'assistant',
      content: 'Yes to which option?',
      timestamp: new Date(),
      isError: false,
    }
    ctx.addMessage(assistantMessage)
    ctx.setIsLoading(false)
    return {
      ...defaultResult,
      handled: true,
      handledByTier: 3,
      tierLabel: 'affirmation_without_context',
      clarificationCleared,
      isNewQuestionOrCommandDetected,
      classifierCalled,
      classifierResult,
      classifierTimeout,
      classifierLatencyMs,
      classifierError,
      isFollowUp,
    }
  }

  // Tier 3c: Re-show Options — "show options", "what were those"
  if (matchesReshowPhrases(ctx.trimmedInput)) {
    const now = Date.now()
    const lastOptionsMessage = ctx.findLastOptionsMessage(ctx.messages)
    const messageAge = lastOptionsMessage ? now - lastOptionsMessage.timestamp.getTime() : null
    const isWithinGraceWindow = lastOptionsMessage && messageAge !== null && messageAge <= ctx.reshowWindowMs

    if (isWithinGraceWindow && lastOptionsMessage) {
      void debugLog({
        component: 'ChatNavigation',
        action: 'reshow_options_deterministic',
        metadata: { optionsCount: lastOptionsMessage.options.length, messageAgeMs: messageAge, tier: '3c' },
      })

      // Re-render options without calling LLM
      const messageId = `assistant-${Date.now()}`
      const assistantMessage: ChatMessage = {
        id: messageId,
        role: 'assistant',
        content: 'Here are your options:',
        timestamp: new Date(),
        isError: false,
        options: lastOptionsMessage.options.map((opt) => ({
          type: opt.type as SelectionOption['type'],
          id: opt.id,
          label: opt.label,
          sublabel: opt.sublabel,
          data: opt.data as SelectionOption['data'],
        })),
      }
      ctx.addMessage(assistantMessage)

      // Per universal-selection-resolver-plan.md: clear widget context when restoring chat options
      ctx.clearWidgetSelectionContext()
      // Restore pendingOptions for selection handling
      ctx.setPendingOptions(lastOptionsMessage.options)
      ctx.setPendingOptionsMessageId(messageId)
      ctx.setPendingOptionsGraceCount(0)

      // Populate soft-active window so shorthand works after re-show
      ctx.saveLastOptionsShown(
        lastOptionsMessage.options.map(opt => ({ id: opt.id, label: opt.label, sublabel: opt.sublabel, type: opt.type })),
        messageId,
      )

      // Per options-visible-clarification-sync-plan.md: sync lastClarification on re-show
      ctx.setLastClarification({
        type: 'option_selection',
        originalIntent: 'reshow_options',
        messageId,
        timestamp: Date.now(),
        clarificationQuestion: 'Here are your options:',
        options: lastOptionsMessage.options.map(opt => ({
          id: opt.id,
          label: opt.label,
          sublabel: opt.sublabel,
          type: opt.type,
        })),
        metaCount: 0,
      })

      ctx.setIsLoading(false)
      return {
        ...defaultResult,
        handled: true,
        handledByTier: 3,
        tierLabel: 'reshow_options',
        clarificationCleared,
        isNewQuestionOrCommandDetected,
        classifierCalled,
        classifierResult,
        classifierTimeout,
        classifierLatencyMs,
        classifierError,
        isFollowUp,
      }
    } else {
      // Grace window expired or no prior options
      void debugLog({
        component: 'ChatNavigation',
        action: 'reshow_options_expired',
        metadata: { hasLastOptionsMessage: !!lastOptionsMessage, messageAgeMs: messageAge, tier: '3c' },
      })

      const assistantMessage: ChatMessage = {
        id: `assistant-${Date.now()}`,
        role: 'assistant',
        content: "No options are open. Say 'show quick links' to see them again.",
        timestamp: new Date(),
        isError: false,
      }
      ctx.addMessage(assistantMessage)
      ctx.setIsLoading(false)
      return {
        ...defaultResult,
        handled: true,
        handledByTier: 3,
        tierLabel: 'reshow_options_expired',
        clarificationCleared,
        isNewQuestionOrCommandDetected,
        classifierCalled,
        classifierResult,
        classifierTimeout,
        classifierLatencyMs,
        classifierError,
        isFollowUp,
      }
    }
  }

  // =========================================================================
  // TIER 3.5 — Universal Selection Follow-Up Resolver
  //
  // Per universal-selection-resolver-plan.md Phase 4:
  // Handle selection follow-ups that weren't caught by Tier 3a (which was
  // bypassed when widgetSelectionContext is active). This ensures widget
  // selection follow-ups route through execute_widget_item, not handleSelectOption.
  // =========================================================================
  const selectionResult = resolveSelectionFollowUp(
    ctx.trimmedInput,
    {
      pendingOptions: ctx.pendingOptions,
      activeOptionSetId: ctx.activeOptionSetId,
    },
    ctx.widgetSelectionContext,
    ctx.getVisibleSnapshots
  )

  if (selectionResult.handled) {
    if (selectionResult.groundingAction && selectionResult.groundingAction.type === 'execute_widget_item') {
      // Widget selection — return groundingAction for caller to execute
      void debugLog({
        component: 'ChatNavigation',
        action: 'universal_resolver_widget_selection',
        metadata: {
          input: ctx.trimmedInput,
          widgetId: selectionResult.groundingAction.widgetId,
          itemId: selectionResult.groundingAction.itemId,
          tier: '3.5',
        },
      })

      ctx.setIsLoading(false)
      // Clear widget selection context after successful resolution
      ctx.clearWidgetSelectionContext()
      if (selectionResult.groundingAction?.type === 'execute_widget_item') {
        trySetWidgetLatch({ widgetId: selectionResult.groundingAction.widgetId, trigger: 'universal_resolver_widget' })
      }
      return {
        ...defaultResult,
        handled: true,
        handledByTier: 3,
        tierLabel: 'universal_resolver_widget',
        groundingAction: selectionResult.groundingAction,
        clarificationCleared,
        isNewQuestionOrCommandDetected,
        classifierCalled,
        classifierResult,
        classifierTimeout,
        classifierLatencyMs,
        classifierError,
        isFollowUp,
      }
    }

    if (selectionResult.matchedChatOption) {
      // Chat selection — execute via handleSelectOption
      void debugLog({
        component: 'ChatNavigation',
        action: 'universal_resolver_chat_selection',
        metadata: {
          input: ctx.trimmedInput,
          selectedLabel: selectionResult.matchedChatOption.label,
          tier: '3.5',
        },
      })

      ctx.setPendingOptionsGraceCount(1)
      ctx.setIsLoading(false)

      // If it's a widget_option, resolve through execute_widget_item
      if (selectionResult.matchedChatOption.type === 'widget_option') {
        const widgetInfo = resolveWidgetItemFromSnapshots(ctx.getVisibleSnapshots, selectionResult.matchedChatOption.id)
        if (widgetInfo) {
          trySetWidgetLatch({ widgetId: widgetInfo.widgetId, trigger: 'universal_resolver_chat_widget_option' })
          return {
            ...defaultResult,
            handled: true,
            handledByTier: 3,
            tierLabel: 'universal_resolver_chat_widget_option',
            groundingAction: {
              type: 'execute_widget_item',
              widgetId: widgetInfo.widgetId,
              segmentId: widgetInfo.segmentId,
              itemId: selectionResult.matchedChatOption.id,
              itemLabel: selectionResult.matchedChatOption.label,
              action: 'open',
            },
            clarificationCleared,
            isNewQuestionOrCommandDetected,
            classifierCalled,
            classifierResult,
            classifierTimeout,
            classifierLatencyMs,
            classifierError,
            isFollowUp,
          }
        }
      }

      // Regular chat option — execute via handleSelectOption
      const optionToSelect: SelectionOption = {
        type: selectionResult.matchedChatOption.type as SelectionOption['type'],
        id: selectionResult.matchedChatOption.id,
        label: selectionResult.matchedChatOption.label,
        sublabel: selectionResult.matchedChatOption.sublabel,
        data: selectionResult.matchedChatOption.data as SelectionOption['data'],
      }

      ctx.handleSelectOption(optionToSelect)
      return {
        ...defaultResult,
        handled: true,
        handledByTier: 3,
        tierLabel: 'universal_resolver_chat',
        clarificationCleared,
        isNewQuestionOrCommandDetected,
        classifierCalled,
        classifierResult,
        classifierTimeout,
        classifierLatencyMs,
        classifierError,
        isFollowUp,
      }
    }
  }

  // =========================================================================
  // TIER 3.6 — Hybrid Selection Resolver (Deterministic Miss → Constrained LLM)
  //
  // Per universal-selection-resolver-plan.md Phase 4 & Reliability Addendum item 8:
  // If an active executable selection context exists and deterministic
  // ordinal/label matching failed, call constrained LLM with active context
  // candidates. Retry prompt only as final fallback after LLM need_more_info/error.
  //
  // IMPORTANT: Do NOT trigger for new commands (e.g., "open links panel d").
  // These should escape the selection context and execute normally via Tier 4.
  // =========================================================================
  // Recoverable chat context: lastOptionsShown has recently-shown options even when
  // pendingOptions was cleared by Tier 2a explicit command bypass.
  // Guard: if widget lists are currently visible, do not recover stale chat options.
  const hasVisibleWidgetListInRegistry = ctx.getVisibleSnapshots().some(snapshot =>
    snapshot.segments.some(segment =>
      segment.segmentType === 'list' &&
      Array.isArray((segment as { items?: unknown[] }).items) &&
      ((segment as { items?: unknown[] }).items?.length ?? 0) > 0
    )
  )
  const hasRecoverableChatContext = ctx.pendingOptions.length === 0
    && ctx.lastOptionsShown !== null
    && ctx.lastOptionsShown.options.length > 0
    && ctx.lastOptionsShown.turnsSinceShown <= SOFT_ACTIVE_TURN_LIMIT
    && !hasVisibleWidgetListInRegistry

  const hasActiveExecutableContext =
    (ctx.widgetSelectionContext !== null && ctx.widgetSelectionContext.turnsSinceShown < WIDGET_SELECTION_TTL) ||
    (ctx.pendingOptions.length > 0 && ctx.activeOptionSetId !== null) ||
    hasRecoverableChatContext

  // Explicit command escape (Phase 4 step 3):
  // If input has an action verb + non-selection target, it's a new command, not a selection miss.
  // Let it fall through to Tier 4 known-noun routing.
  const hasSelectionKeyword = /\b(option|choice|item)\b/i.test(ctx.trimmedInput)
  const looksLikeNewCommand = ACTION_VERB_PATTERN.test(ctx.trimmedInput)
    && !isSelectionOnly(ctx.trimmedInput, 10, [], 'embedded').isSelection
    && !hasSelectionKeyword

  if (hasActiveExecutableContext && isSelectionLike(ctx.trimmedInput) && !looksLikeNewCommand && !isNewQuestionOrCommandDetected) {
    // Deterministic matching failed but input is selection-like with active context.
    // Try constrained LLM before showing retry prompt.
    void debugLog({
      component: 'ChatNavigation',
      action: 'deterministic_miss_trying_constrained_llm',
      metadata: {
        input: ctx.trimmedInput,
        hasWidgetContext: ctx.widgetSelectionContext !== null,
        hasChatContext: ctx.pendingOptions.length > 0,
        hasRecoverableChatContext,
        hasVisibleWidgetListInRegistry,
        tier: '3.6',
      },
    })

    // Build candidates from active context.
    // Priority: pendingOptions > lastOptionsShown (recoverable) > widgetSelectionContext
    // This ensures recently-shown clarification options are preferred over ambient widget items.
    const llmCandidates: { id: string; label: string; type: string; actionHint?: string }[] = []
    let sourceContext: 'chat' | 'recoverable_chat' | 'widget' = 'chat'

    if (ctx.pendingOptions.length > 0 && ctx.activeOptionSetId !== null) {
      // Priority 1: Active chat context (pendingOptions)
      for (const opt of ctx.pendingOptions) {
        llmCandidates.push({ id: opt.id, label: opt.label, type: opt.type || 'option' })
      }
      sourceContext = 'chat'
    } else if (hasRecoverableChatContext && ctx.lastOptionsShown) {
      // Priority 2: Recoverable chat context (lastOptionsShown — cleared by Tier 2a but still recent)
      for (const opt of ctx.lastOptionsShown.options) {
        llmCandidates.push({ id: opt.id, label: opt.label, type: opt.type || 'option' })
      }
      sourceContext = 'recoverable_chat'
    } else if (ctx.widgetSelectionContext !== null && ctx.widgetSelectionContext.turnsSinceShown < WIDGET_SELECTION_TTL) {
      // Priority 3: Widget context
      for (const opt of ctx.widgetSelectionContext.options) {
        llmCandidates.push({ id: opt.id, label: opt.label, type: 'widget_option', actionHint: 'open' })
      }
      sourceContext = 'widget'
    }

    if (llmCandidates.length > 0 && isGroundingLLMEnabled()) {
      try {
        const llmResult = await callGroundingLLM({
          userInput: ctx.trimmedInput,
          candidates: llmCandidates,
        })

        void debugLog({
          component: 'ChatNavigation',
          action: llmResult.success ? 'tier3_6_constrained_llm_called' : 'tier3_6_constrained_llm_error',
          metadata: {
            input: ctx.trimmedInput,
            success: llmResult.success,
            decision: llmResult.response?.decision,
            choiceId: llmResult.response?.choiceId,
            confidence: llmResult.response?.confidence,
            latencyMs: llmResult.latencyMs,
            sourceContext,
            error: llmResult.error,
          },
        })

        if (llmResult.success && llmResult.response?.decision === 'select' && llmResult.response.choiceId) {
          const choiceId = llmResult.response.choiceId

          // Safety: validate choiceId is in candidates
          const validChoice = llmCandidates.find(c => c.id === choiceId)
          if (validChoice) {
            if (sourceContext === 'widget' && ctx.widgetSelectionContext) {
              // Widget execution path
              void debugLog({
                component: 'ChatNavigation',
                action: 'tier3_6_llm_widget_select',
                metadata: { choiceId, label: validChoice.label, confidence: llmResult.response.confidence },
              })
              ctx.clearWidgetSelectionContext()
              ctx.setIsLoading(false)
              return {
                ...defaultResult,
                handled: true,
                handledByTier: 3,
                tierLabel: 'tier3_6_constrained_llm_widget_select',
                clarificationCleared,
                isNewQuestionOrCommandDetected,
                classifierCalled,
                classifierResult,
                classifierTimeout,
                classifierLatencyMs,
                classifierError,
                isFollowUp,
                groundingAction: {
                  type: 'execute_widget_item',
                  widgetId: ctx.widgetSelectionContext.widgetId,
                  segmentId: ctx.widgetSelectionContext.segmentId,
                  itemId: choiceId,
                  itemLabel: validChoice.label,
                  action: 'open',
                },
              }
            } else {
              // Chat / recoverable-chat execution path
              // For recoverable context, pendingOptions is empty — look up from findLastOptionsMessage
              const matchingOption = ctx.pendingOptions.find(opt => opt.id === choiceId)
                || (sourceContext === 'recoverable_chat'
                  ? ctx.findLastOptionsMessage(ctx.messages)?.options.find(opt => opt.id === choiceId)
                  : undefined)

              // widget_option with type+data must fall through to the widget handler at line ~2430,
              // not handleSelectOption (which doesn't handle 'widget_option' type).
              const matchingOptionIsWidget = matchingOption && 'type' in matchingOption
                && (matchingOption as { type: string }).type === 'widget_option'
              if (matchingOption && 'type' in matchingOption && 'data' in matchingOption && !matchingOptionIsWidget) {
                void debugLog({
                  component: 'ChatNavigation',
                  action: 'tier3_6_llm_chat_select',
                  metadata: {
                    choiceId,
                    label: validChoice.label,
                    confidence: llmResult.response.confidence,
                    sourceContext,
                  },
                })
                ctx.handleSelectOption(matchingOption as unknown as SelectionOption)
                ctx.setIsLoading(false)
                return {
                  ...defaultResult,
                  handled: true,
                  handledByTier: 3,
                  tierLabel: sourceContext === 'recoverable_chat'
                    ? 'tier3_6_constrained_llm_recoverable_chat_select'
                    : 'tier3_6_constrained_llm_chat_select',
                  clarificationCleared,
                  isNewQuestionOrCommandDetected,
                  classifierCalled,
                  classifierResult,
                  classifierTimeout,
                  classifierLatencyMs,
                  classifierError,
                  isFollowUp,
                }
              }
              // Chat option found but missing type/data — resolve via widget snapshots
              const matchingOptionType = (matchingOption as { type?: string } | undefined)?.type
              if (matchingOptionType === 'widget_option') {
                const widgetInfo = resolveWidgetItemFromSnapshots(ctx.getVisibleSnapshots, choiceId)
                if (widgetInfo) {
                  void debugLog({
                    component: 'ChatNavigation',
                    action: 'tier3_6_llm_chat_widget_option_select',
                    metadata: { choiceId, label: validChoice.label, widgetId: widgetInfo.widgetId },
                  })
                  trySetWidgetLatch({ widgetId: widgetInfo.widgetId, trigger: 'tier3_6_llm_chat_widget_option' })
                  ctx.setIsLoading(false)
                  return {
                    ...defaultResult,
                    handled: true,
                    handledByTier: 3,
                    tierLabel: 'tier3_6_constrained_llm_chat_widget_select',
                    clarificationCleared,
                    isNewQuestionOrCommandDetected,
                    classifierCalled,
                    classifierResult,
                    classifierTimeout,
                    classifierLatencyMs,
                    classifierError,
                    isFollowUp,
                    groundingAction: {
                      type: 'execute_widget_item',
                      widgetId: widgetInfo.widgetId,
                      segmentId: widgetInfo.segmentId,
                      itemId: choiceId,
                      itemLabel: validChoice.label,
                      action: 'open',
                    },
                  }
                }
              }
            }
          }
        }
        // LLM returned need_more_info, invalid choiceId, or error — fall through to retry prompt
      } catch (err) {
        void debugLog({
          component: 'ChatNavigation',
          action: 'tier3_6_constrained_llm_exception',
          metadata: { input: ctx.trimmedInput, error: String(err) },
        })
        // Fall through to retry prompt
      }
    }

    // Final fallback: targeted retry prompt (LLM disabled, failed, or returned need_more_info)
    const retryMessage: ChatMessage = {
      id: `assistant-${Date.now()}`,
      role: 'assistant',
      content: "I didn't catch that. Say 'first', 'second', etc. or tap an option pill.",
      timestamp: new Date(),
      isError: false,
    }
    ctx.addMessage(retryMessage)
    ctx.setIsLoading(false)

    return {
      ...defaultResult,
      handled: true,
      handledByTier: 3,
      tierLabel: 'deterministic_miss_retry',
      clarificationCleared,
      isNewQuestionOrCommandDetected,
      classifierCalled,
      classifierResult,
      classifierTimeout,
      classifierLatencyMs,
      classifierError,
      isFollowUp,
    }
  }

  // =========================================================================
  // TIER 4 — Known-Noun Commands
  //
  // Per routing-order-priority-plan.md Core Principle #4:
  // "Known-noun commands should execute before docs."
  //
  // Priority within Tier 4:
  //   1. Question signal → skip (let Tier 5 handle)
  //   2. Exact known-noun match → execute (open panel)
  //   3. Near match (fuzzy) → "Did you mean ___?"
  //   4. No match → fall through to Tier 5
  //
  // Rule: If a known-noun executes while a paused snapshot exists,
  // the snapshot remains paused (no implicit resume).
  // =========================================================================

  // turnSnapshot already built before intercept (see above)

  const hasSoftActiveSelectionLike = ctx.activeOptionSetId === null
    && !!ctx.lastOptionsShown
    && ctx.lastOptionsShown.options.length > 0
    && isSelectionLike(ctx.trimmedInput, { hasBadgeLetters: turnSnapshot.hasBadgeLetters })

  // hasVisibleWidgetItems already computed with turnSnapshot above

  const knownNounResult = handleKnownNounRouting({
    trimmedInput: ctx.trimmedInput,
    visibleWidgets: ctx.uiContext?.dashboard?.visibleWidgets,
    addMessage: ctx.addMessage,
    setIsLoading: ctx.setIsLoading,
    openPanelDrawer: ctx.openPanelDrawer,
    setPendingOptions: ctx.setPendingOptions,
    setPendingOptionsMessageId: ctx.setPendingOptionsMessageId,
    setPendingOptionsGraceCount: ctx.setPendingOptionsGraceCount,
    setActiveOptionSetId: ctx.setActiveOptionSetId,
    setLastClarification: ctx.setLastClarification,
    handleSelectOption: ctx.handleSelectOption,
    hasActiveOptionSet: ctx.pendingOptions.length > 0 && ctx.activeOptionSetId !== null,
    hasSoftActiveSelectionLike,
    hasVisibleWidgetList: hasVisibleWidgetItems,
    saveLastOptionsShown: ctx.saveLastOptionsShown,
    clearWidgetSelectionContext: ctx.clearWidgetSelectionContext,
    clearLastOptionsShown: ctx.clearLastOptionsShown,
    clearClarificationSnapshot: ctx.clearClarificationSnapshot,
    clearFocusLatch: isLatchEnabled ? ctx.clearFocusLatch : undefined,
  })
  if (knownNounResult.handled) {
    return {
      ...defaultResult,
      handled: true,
      handledByTier: 4,
      tierLabel: 'known_noun',
      clarificationCleared,
      isNewQuestionOrCommandDetected,
      classifierCalled,
      classifierResult,
      classifierTimeout,
      classifierLatencyMs,
      classifierError,
      isFollowUp,
    }
  }

  // =========================================================================
  // TIER 4.5 — Grounding-Set Fallback
  //
  // Per grounding-set-fallback-plan.md: After deterministic routing fails,
  // use a small explicit "grounding set" to prevent dead-end replies.
  // Insertion point: after Tier 4 (known-noun) and before Tier 5 (doc retrieval).
  //
  // Decision flow:
  //   1) Check paused re-anchor (stop-paused ordinal guidance)
  //   2) Check soft-active window (post-action selection persistence)
  //   3) Build grounding sets → multi-list guard → deterministic match
  //   4) If deterministic fails + candidates exist → constrained LLM
  //   5) If no candidates → ask missing slot
  // =========================================================================
  if (semanticLaneDetected) {
    void debugLog({
      component: 'ChatNavigation',
      action: 'semantic_lane_skip_grounding',
      metadata: { input: ctx.trimmedInput },
    })
  }
  if (!semanticLaneDetected) {
    // NOTE: Paused re-anchor (H) is NOT handled here — it's already handled by
    // the stop-paused ordinal guard in handleClarificationIntercept() (Tier 0,
    // chat-routing.ts lines 1987-2009). That runs before Tier 4.5, so stop-paused
    // ordinals never reach here. Duplicating it would risk double-messages.
    // checkPausedReAnchor() is exported for future use if Tier 0 logic changes.

    // turnSnapshot is already built before Tier 4 (see above) and reused here.

    // G) Soft-active window check — uses lastOptionsShown (dedicated state),
    // NOT clarificationSnapshot (which has a different lifecycle).
    const softActiveOptions = (ctx.activeOptionSetId === null && ctx.lastOptionsShown)
      ? ctx.lastOptionsShown.options
      : null
    const isSoftActive = softActiveOptions !== null && softActiveOptions.length > 0
      && isSelectionLike(ctx.trimmedInput, { hasBadgeLetters: turnSnapshot.hasBadgeLetters })

    // ActiveWidget preference: reorder openWidgets so the active widget's list
    // comes first. Only affects ordinal binding when no widget is named explicitly
    // and checkMultiListAmbiguity has already passed.
    if (turnSnapshot.activeSnapshotWidgetId && turnSnapshot.openWidgets.length > 1) {
      const activeIdx = turnSnapshot.openWidgets.findIndex(
        w => w.id === turnSnapshot.activeSnapshotWidgetId
      )
      if (activeIdx > 0) {
        const [active] = turnSnapshot.openWidgets.splice(activeIdx, 1)
        turnSnapshot.openWidgets.unshift(active)
      }
    }

    // Build grounding context from existing state
    const groundingCtx = buildGroundingContext({
      // If soft-active, treat as having an active option set
      activeOptionSetId: isSoftActive ? 'soft-active' : ctx.activeOptionSetId,
      lastClarification: isSoftActive
        ? { type: 'option_selection' as const, originalIntent: '', messageId: '', timestamp: Date.now(), options: softActiveOptions! }
        : ctx.lastClarification,
      clarificationSnapshot: ctx.clarificationSnapshot,
      sessionState: ctx.sessionState,
      repairMemory: ctx.repairMemory,
      openWidgets: turnSnapshot.openWidgets,
    })

    // Determine activeWidgetId with correct pre-latch guard
    // Per selection-intent-arbitration-incubation-plan Rules 2, 6, 12:
    let activeWidgetId: string | undefined
    if (isLatchEnabled && ctx.focusLatch && !ctx.focusLatch.suspended) {
      // Latch active → scope to latched widget (Rule 2, 6, Test 9)
      if (ctx.focusLatch.kind === 'resolved') {
        activeWidgetId = ctx.focusLatch.widgetId
      } else {
        // Pending latch: widget not yet registered, use activeSnapshotWidgetId as fallback
        activeWidgetId = turnSnapshot.activeSnapshotWidgetId ?? undefined
      }
    } else if (isLatchEnabled && (!ctx.focusLatch || ctx.focusLatch.suspended) && isPreLatchDefault(turnSnapshot, ctx)) {
      // Pre-latch Rule 12 (strict): exactly one fresh visible list-segment, no active chat
      // activeSnapshotWidgetId may be null (no panel focused), so fall back to sole visible widget
      activeWidgetId = turnSnapshot.activeSnapshotWidgetId
        ?? turnSnapshot.openWidgets.find(w => w.listSegmentCount > 0)?.id
    } else if (isLatchEnabled && (!ctx.focusLatch || ctx.focusLatch.suspended)
        && turnSnapshot.activeSnapshotWidgetId
        && !ctx.lastClarification?.options?.length
        && isSelectionLike(ctx.trimmedInput)) {
      // Pre-latch focused (relaxed): widget has UI focus + no active chat + selection-like input.
      // Handles dashboards with multiple list segments (totalListSegmentCount > 1) where
      // the focus signal from Phase 0 disambiguates which widget the ordinal targets.
      activeWidgetId = turnSnapshot.activeSnapshotWidgetId
    }
    // else: no activeWidgetId → multi-list ambiguity handling fires normally

    // Pending latch + no activeWidgetId: widget hasn't registered yet.
    // Per plan: only swallow selection-like inputs; let commands/questions fall through normally.
    // The latchBlocksStaleChat invariant (in handleClarificationIntercept) still prevents stale-chat capture.
    if (isLatchEnabled && ctx.focusLatch && ctx.focusLatch.kind === 'pending' && !activeWidgetId
        && isSelectionLike(ctx.trimmedInput, { hasBadgeLetters: turnSnapshot.hasBadgeLetters })) {
      if (ctx.focusLatch.turnsSinceLatched === 0) {
        // First turn with pending latch + selection-like input — show loading message
        const loadingMsg: ChatMessage = {
          id: `assistant-${Date.now()}`,
          role: 'assistant',
          content: 'Still loading that panel — try again in a moment.',
          timestamp: new Date(),
          isError: false,
        }
        ctx.addMessage(loadingMsg)
        ctx.setIsLoading(false)
        void debugLog({ component: 'ChatNavigation', action: 'pending_latch_still_loading', metadata: { pendingPanelId: ctx.focusLatch.pendingPanelId, turnsSinceLatched: 0 } })
        return { ...defaultResult, handled: true }
      }
      // Cooldown: turnsSinceLatched > 0 — return handled silently (no message, no fall-through
      // to Tier 4.5 grounding) to prevent multi-list ambiguity from firing against unresolved pending latch.
      // The latch will either resolve on the next validity check or expire at turnsSinceLatched >= 2.
      void debugLog({ component: 'ChatNavigation', action: 'pending_latch_cooldown_silent', metadata: { pendingPanelId: ctx.focusLatch.pendingPanelId, turnsSinceLatched: ctx.focusLatch.turnsSinceLatched } })
      ctx.setIsLoading(false)
      return { ...defaultResult, handled: true }
    }

    // Run grounding-set fallback
    const groundingResult = handleGroundingSetFallback(ctx.trimmedInput, groundingCtx, {
      hasBadgeLetters: turnSnapshot.hasBadgeLetters,
      activeWidgetId,
    })

    // Handle multi-list ambiguity
    if (groundingResult.multiListAmbiguity && groundingResult.askClarifier) {
      const ambiguityMsg: ChatMessage = {
        id: `assistant-${Date.now()}`,
        role: 'assistant',
        content: groundingResult.clarifierMessage || 'I see multiple option lists open. Which one do you mean?',
        timestamp: new Date(),
        isError: false,
      }
      ctx.addMessage(ambiguityMsg)
      ctx.setIsLoading(false)

      return {
        ...defaultResult,
        handled: true,
        handledByTier: 4,
        tierLabel: 'grounding_multi_list_ambiguity',
        clarificationCleared,
        isNewQuestionOrCommandDetected,
        classifierCalled,
        classifierResult,
        classifierTimeout,
        classifierLatencyMs,
        classifierError,
        isFollowUp,
      }
    }

    // Deterministic match succeeded
    if (groundingResult.handled && groundingResult.selectedCandidate) {
      void debugLog({
        component: 'ChatNavigation',
        action: 'grounding_deterministic_select',
        metadata: {
          input: ctx.trimmedInput,
          candidateId: groundingResult.selectedCandidate.id,
          candidateLabel: groundingResult.selectedCandidate.label,
          resolvedBy: groundingResult.resolvedBy,
        },
      })

      // Execute the selected candidate
      // For option-type candidates, use handleSelectOption
      if (groundingResult.selectedCandidate.type === 'option' ||
          groundingResult.selectedCandidate.type === 'widget_option') {
        // Find matching option in pendingOptions or snapshot
        const matchingOption = ctx.pendingOptions.find(
          opt => opt.id === groundingResult.selectedCandidate!.id
        ) || (ctx.clarificationSnapshot?.options.find(
          opt => opt.id === groundingResult.selectedCandidate!.id
        ))

        // widget_option must fall through to the dedicated execute_widget_item handler,
        // not handleSelectOption (which doesn't handle 'widget_option' type).
        if (matchingOption && 'type' in matchingOption && 'data' in matchingOption
            && groundingResult.selectedCandidate!.type !== 'widget_option') {
          ctx.handleSelectOption(matchingOption as unknown as SelectionOption)
          ctx.setIsLoading(false)
          return {
            ...defaultResult,
            handled: true,
            handledByTier: 4,
            tierLabel: 'grounding_deterministic_select',
            clarificationCleared,
            isNewQuestionOrCommandDetected,
            classifierCalled,
            classifierResult,
            classifierTimeout,
            classifierLatencyMs,
            classifierError,
            isFollowUp,
          }
        }

        // Fallback: recover full option data from the most recent options message
        const lastOptionsMessage = ctx.findLastOptionsMessage(ctx.messages)
        const messageAge = lastOptionsMessage ? Date.now() - lastOptionsMessage.timestamp.getTime() : null
        const isWithinWindow = lastOptionsMessage
          && messageAge !== null
          && messageAge <= ctx.reshowWindowMs
        const messageOption = isWithinWindow
          ? lastOptionsMessage.options.find(opt => opt.id === groundingResult.selectedCandidate!.id)
          : null

        // widget_option must route to the dedicated execute_widget_item handler below,
        // not through handleSelectOption (which doesn't handle 'widget_option' type).
        if (messageOption && groundingResult.selectedCandidate!.type !== 'widget_option') {
          const optionToSelect: SelectionOption = {
            type: messageOption.type as SelectionOption['type'],
            id: messageOption.id,
            label: messageOption.label,
            sublabel: messageOption.sublabel,
            data: messageOption.data as SelectionOption['data'],
          }
          ctx.handleSelectOption(optionToSelect)
          ctx.setIsLoading(false)
          return {
            ...defaultResult,
            handled: true,
            handledByTier: 4,
            tierLabel: 'grounding_deterministic_select_message_fallback',
            clarificationCleared,
            isNewQuestionOrCommandDetected,
            classifierCalled,
            classifierResult,
            classifierTimeout,
            classifierLatencyMs,
            classifierError,
            isFollowUp,
          }
        }
      }

      // Widget registry item — not in chat options (expected for registry items).
      // Return execute_widget_item for sendMessage() to handle.
      if (groundingResult.selectedCandidate.type === 'widget_option') {
        const sourceWidget = turnSnapshot.openWidgets.find(w =>
          w.options.some(opt => opt.id === groundingResult.selectedCandidate!.id)
        )

        void debugLog({
          component: 'ChatNavigation',
          action: 'grounding_widget_item_execute',
          metadata: {
            candidateId: groundingResult.selectedCandidate.id,
            candidateLabel: groundingResult.selectedCandidate.label,
            widgetId: sourceWidget?.id,
          },
        })

        // Latch-on: successful widget item resolution (Phase 5a)
        trySetWidgetLatch({ widgetId: sourceWidget?.id, trigger: 'grounding_widget_item_execute' })

        return {
          ...defaultResult,
          handled: true,
          handledByTier: 4,
          tierLabel: 'grounding_widget_item_execute',
          clarificationCleared,
          isNewQuestionOrCommandDetected,
          classifierCalled,
          classifierResult,
          classifierTimeout,
          classifierLatencyMs,
          classifierError,
          isFollowUp,
          groundingAction: {
            type: 'execute_widget_item',
            widgetId: sourceWidget?.id || '',
            segmentId: findSourceSegmentId(sourceWidget?.id, groundingResult.selectedCandidate.id),
            itemId: groundingResult.selectedCandidate.id,
            itemLabel: groundingResult.selectedCandidate.label,
            action: 'open',
          },
        }
      }

      // Option found but missing 'type'/'data' fields — can't execute.
      // Log and fall through to Tier 5.
      void debugLog({
        component: 'ChatNavigation',
        action: 'grounding_deterministic_select_no_executable',
        metadata: {
          candidateId: groundingResult.selectedCandidate!.id,
          reason: 'matching_option_missing_fields',
        },
      })
    }

    // LLM fallback needed
    if (groundingResult.needsLLM && groundingResult.llmCandidates && groundingResult.llmCandidates.length > 0) {
      // Narrow gate: skip LLM only for command-like panel intents
      // (explicit command + matches visible panel). Other non-selection inputs still get LLM.
      const isCommandPanelIntent =
        isExplicitCommand(ctx.trimmedInput) &&
        matchVisiblePanelCommand(ctx.trimmedInput, ctx.uiContext?.dashboard?.visibleWidgets).type !== 'none'

      if (isCommandPanelIntent) {
        void debugLog({
          component: 'ChatNavigation',
          action: 'grounding_llm_skipped_command_panel_intent',
          metadata: {
            input: ctx.trimmedInput,
            candidateCount: groundingResult.llmCandidates.length,
            reason: 'routing_continues_to_panel_command_path',
          },
        })
        // Fall through — panel command should be handled by Tier 2c, not grounding LLM.
        // Routing continues to subsequent tiers.
      } else if (isGroundingLLMEnabled()) {
        try {
          // Per incubation plan §Observability: log LLM attempt
          void debugLog({ component: 'ChatNavigation', action: 'selection_dual_source_llm_attempt', metadata: { input: ctx.trimmedInput, candidateCount: groundingResult.llmCandidates.length, activeWidgetId } })

          const llmResult = await callGroundingLLM({
            userInput: ctx.trimmedInput,
            candidates: groundingResult.llmCandidates.map(c => ({
              id: c.id,
              label: c.label,
              type: c.type,
              actionHint: c.actionHint,
            })),
          })

          void debugLog({
            component: 'ChatNavigation',
            action: llmResult.success ? 'grounding_llm_called' : 'grounding_llm_error',
            metadata: {
              input: ctx.trimmedInput,
              success: llmResult.success,
              decision: llmResult.response?.decision,
              choiceId: llmResult.response?.choiceId,
              confidence: llmResult.response?.confidence,
              latencyMs: llmResult.latencyMs,
              error: llmResult.error,
            },
          })

          // Per incubation plan §Observability: log LLM result
          void debugLog({ component: 'ChatNavigation', action: 'selection_dual_source_llm_result', metadata: { success: llmResult.success, decision: llmResult.response?.decision, choiceId: llmResult.response?.choiceId, latencyMs: llmResult.latencyMs } })

          if (llmResult.success && llmResult.response) {
            if (llmResult.response.decision === 'select' && llmResult.response.choiceId) {
              // LLM selected a candidate — find and execute
              const selected = groundingResult.llmCandidates.find(
                c => c.id === llmResult.response!.choiceId
              )

              if (selected) {
                void debugLog({
                  component: 'ChatNavigation',
                  action: 'grounding_llm_select',
                  metadata: {
                    candidateId: selected.id,
                    candidateLabel: selected.label,
                    confidence: llmResult.response.confidence,
                  },
                })

                // Try to execute via handleSelectOption
                const matchingOption = ctx.pendingOptions.find(opt => opt.id === selected.id)
                  || (ctx.clarificationSnapshot?.options.find(opt => opt.id === selected.id))

                // widget_option must fall through to the dedicated execute_widget_item handler,
                // not handleSelectOption (which doesn't handle 'widget_option' type).
                if (matchingOption && 'type' in matchingOption && 'data' in matchingOption
                    && selected.type !== 'widget_option') {
                  ctx.handleSelectOption(matchingOption as unknown as SelectionOption)
                  ctx.setIsLoading(false)
                  return {
                    ...defaultResult,
                    handled: true,
                    handledByTier: 4,
                    tierLabel: 'grounding_llm_select',
                    clarificationCleared,
                    isNewQuestionOrCommandDetected,
                    classifierCalled,
                    classifierResult,
                    classifierTimeout,
                    classifierLatencyMs,
                    classifierError,
                    isFollowUp,
                    _devProvenanceHint: 'llm_executed' as const,
                  }
                }

                // Fallback: recover full option data from the most recent options message
                const lastOptionsMessage = ctx.findLastOptionsMessage(ctx.messages)
                const messageAge = lastOptionsMessage ? Date.now() - lastOptionsMessage.timestamp.getTime() : null
                const isWithinWindow = lastOptionsMessage
                  && messageAge !== null
                  && messageAge <= ctx.reshowWindowMs
                const messageOption = isWithinWindow
                  ? lastOptionsMessage.options.find(opt => opt.id === selected.id)
                  : null

                // widget_option must route to the dedicated execute_widget_item handler below,
                // not through handleSelectOption (which doesn't handle 'widget_option' type).
                // Per universal-selection-resolver-plan.md:10.
                if (messageOption && selected.type !== 'widget_option') {
                  const optionToSelect: SelectionOption = {
                    type: messageOption.type as SelectionOption['type'],
                    id: messageOption.id,
                    label: messageOption.label,
                    sublabel: messageOption.sublabel,
                    data: messageOption.data as SelectionOption['data'],
                  }
                  ctx.handleSelectOption(optionToSelect)
                  ctx.setIsLoading(false)
                  return {
                    ...defaultResult,
                    handled: true,
                    handledByTier: 4,
                    tierLabel: 'grounding_llm_select_message_fallback',
                    clarificationCleared,
                    isNewQuestionOrCommandDetected,
                    classifierCalled,
                    classifierResult,
                    classifierTimeout,
                    classifierLatencyMs,
                    classifierError,
                    isFollowUp,
                    _devProvenanceHint: 'llm_executed' as const,
                  }
                }

                // Referent-type candidate selected by LLM but not in pending options.
                // Per plan §5: "LLM select → execute deterministically."
                // Return a structured action for sendMessage() to execute via navigate API,
                // following the same pattern as suggestionAction.
                if (selected.type === 'referent') {
                  const action = selected.actionHint || 'open'
                  const syntheticMessage = `${action} ${selected.label}`

                  void debugLog({
                    component: 'ChatNavigation',
                    action: 'grounding_referent_execute',
                    metadata: {
                      candidateId: selected.id,
                      candidateLabel: selected.label,
                      actionHint: selected.actionHint,
                      syntheticMessage,
                    },
                  })

                  return {
                    ...defaultResult,
                    handled: true,
                    handledByTier: 4,
                    tierLabel: 'grounding_llm_referent_execute',
                    clarificationCleared,
                    isNewQuestionOrCommandDetected,
                    classifierCalled,
                    classifierResult,
                    classifierTimeout,
                    classifierLatencyMs,
                    classifierError,
                    isFollowUp,
                    _devProvenanceHint: 'llm_executed' as const,
                    groundingAction: {
                      type: 'execute_referent',
                      syntheticMessage,
                      candidateId: selected.id,
                      candidateLabel: selected.label,
                      actionHint: selected.actionHint,
                    },
                  }
                }

                // Widget registry item selected by LLM
                if (selected.type === 'widget_option') {
                  const sourceWidget = turnSnapshot.openWidgets.find(w =>
                    w.options.some(opt => opt.id === selected.id)
                  )

                  void debugLog({
                    component: 'ChatNavigation',
                    action: 'grounding_llm_widget_item_execute',
                    metadata: {
                      candidateId: selected.id,
                      candidateLabel: selected.label,
                      widgetId: sourceWidget?.id,
                      confidence: llmResult.response!.confidence,
                    },
                  })

                  trySetWidgetLatch({ widgetId: sourceWidget?.id, trigger: 'grounding_llm_widget_item_execute' })

                  return {
                    ...defaultResult,
                    handled: true,
                    handledByTier: 4,
                    tierLabel: 'grounding_llm_widget_item_execute',
                    clarificationCleared,
                    isNewQuestionOrCommandDetected,
                    classifierCalled,
                    classifierResult,
                    classifierTimeout,
                    classifierLatencyMs,
                    classifierError,
                    isFollowUp,
                    _devProvenanceHint: 'llm_executed' as const,
                    groundingAction: {
                      type: 'execute_widget_item',
                      widgetId: sourceWidget?.id || '',
                      segmentId: findSourceSegmentId(sourceWidget?.id, selected.id),
                      itemId: selected.id,
                      itemLabel: selected.label,
                      action: 'open',
                    },
                  }
                }
              }
            }

            // need_more_info or failed select → ask grounded clarifier
            if (llmResult.response.decision === 'need_more_info' || !llmResult.response.choiceId) {
              void debugLog({
                component: 'ChatNavigation',
                action: 'grounding_llm_need_more_info',
                metadata: { input: ctx.trimmedInput },
              })

              const clarifierMsgId = `assistant-${Date.now()}`
              const boundOptions = bindGroundingClarifierOptions(ctx, groundingResult.llmCandidates, clarifierMsgId)
              const clarifierMsg: ChatMessage = {
                id: clarifierMsgId,
                role: 'assistant',
                content: buildGroundedClarifier(groundingResult.llmCandidates),
                timestamp: new Date(),
                isError: false,
                options: boundOptions.map(opt => ({
                  type: opt.type as SelectionOption['type'],
                  id: opt.id,
                  label: opt.label,
                  sublabel: opt.sublabel,
                  data: opt.data as SelectionOption['data'],
                })),
              }
              ctx.addMessage(clarifierMsg)
              ctx.setIsLoading(false)

              // Per incubation plan §Observability: LLM generated clarifier wording
              void debugLog({ component: 'ChatNavigation', action: 'selection_clarifier_llm_generated', metadata: { candidateCount: groundingResult.llmCandidates.length, input: ctx.trimmedInput } })

              return {
                ...defaultResult,
                handled: true,
                handledByTier: 4,
                tierLabel: 'grounding_llm_need_more_info',
                clarificationCleared,
                isNewQuestionOrCommandDetected,
                classifierCalled,
                classifierResult,
                classifierTimeout,
                classifierLatencyMs,
                classifierError,
                isFollowUp,
                _devProvenanceHint: 'llm_influenced' as const,
              }
            }
          }

          // LLM failed/timeout — ask same grounded clarifier (no silent fallthrough)
          if (!llmResult.success) {
            void debugLog({
              component: 'ChatNavigation',
              action: 'grounding_llm_timeout',
              metadata: { error: llmResult.error, latencyMs: llmResult.latencyMs },
            })

            const clarifierMsgId = `assistant-${Date.now()}`
            const boundOptions = bindGroundingClarifierOptions(ctx, groundingResult.llmCandidates, clarifierMsgId)
            const clarifierMsg: ChatMessage = {
              id: clarifierMsgId,
              role: 'assistant',
              content: buildGroundedClarifier(groundingResult.llmCandidates),
              timestamp: new Date(),
              isError: false,
              options: boundOptions.map(opt => ({
                type: opt.type as SelectionOption['type'],
                id: opt.id,
                label: opt.label,
                sublabel: opt.sublabel,
                data: opt.data as SelectionOption['data'],
              })),
            }
            ctx.addMessage(clarifierMsg)
            ctx.setIsLoading(false)

            // Per incubation plan §Observability: template fallback used on LLM failure
            void debugLog({ component: 'ChatNavigation', action: 'selection_clarifier_llm_fallback_template', metadata: { reason: 'llm_timeout', candidateCount: groundingResult.llmCandidates.length, input: ctx.trimmedInput } })

            return {
              ...defaultResult,
              handled: true,
              handledByTier: 4,
              tierLabel: 'grounding_llm_fallback_clarifier',
              clarificationCleared,
              isNewQuestionOrCommandDetected,
              classifierCalled,
              classifierResult,
              classifierTimeout,
              classifierLatencyMs,
              classifierError,
              isFollowUp,
              _devProvenanceHint: 'llm_influenced' as const,
            }
          }
        } catch (error) {
          void debugLog({
            component: 'ChatNavigation',
            action: 'grounding_llm_error',
            metadata: { error: error instanceof Error ? error.message : 'Unknown error' },
          })
          // Fall through to Tier 5
        }
      } else {
        // Grounding LLM disabled — show clarifier with candidates instead of falling through
        // This prevents the main API from misinterpreting widget-scoped selection as panel commands
        void debugLog({
          component: 'ChatNavigation',
          action: 'grounding_llm_disabled_clarifier',
          metadata: {
            input: ctx.trimmedInput,
            candidateCount: groundingResult.llmCandidates.length,
            candidates: groundingResult.llmCandidates.slice(0, 5).map(c => c.label),
          },
        })

        const clarifierMsgId = `assistant-${Date.now()}`
        const boundOptions = bindGroundingClarifierOptions(ctx, groundingResult.llmCandidates, clarifierMsgId)
        const clarifierMsg: ChatMessage = {
          id: clarifierMsgId,
          role: 'assistant',
          content: buildGroundedClarifier(groundingResult.llmCandidates),
          timestamp: new Date(),
          isError: false,
          options: boundOptions.map(opt => ({
            type: opt.type as SelectionOption['type'],
            id: opt.id,
            label: opt.label,
            sublabel: opt.sublabel,
            data: opt.data as SelectionOption['data'],
          })),
        }
        ctx.addMessage(clarifierMsg)
        ctx.setIsLoading(false)

        // Per incubation plan §Observability: template fallback (LLM disabled)
        void debugLog({ component: 'ChatNavigation', action: 'selection_clarifier_llm_fallback_template', metadata: { reason: 'llm_disabled', candidateCount: groundingResult.llmCandidates.length, input: ctx.trimmedInput } })

        return {
          ...defaultResult,
          handled: true,
          handledByTier: 4,
          tierLabel: 'grounding_llm_disabled_clarifier',
          clarificationCleared,
          isNewQuestionOrCommandDetected,
          classifierCalled,
          classifierResult,
          classifierTimeout,
          classifierLatencyMs,
          classifierError,
          isFollowUp,
        }
      }
    }

    // No list grounding set — ask for missing slot.
    // handleGroundingSetFallback already verified input is selection-like
    // before setting askClarifier=true, so no redundant check needed.
    if (groundingResult.askClarifier && !groundingResult.needsLLM) {
      const clarifierMsg: ChatMessage = {
        id: `assistant-${Date.now()}`,
        role: 'assistant',
        content: groundingResult.clarifierMessage || "I'm not sure what you're referring to. Could you tell me what you'd like to do?",
        timestamp: new Date(),
        isError: false,
      }
      ctx.addMessage(clarifierMsg)
      ctx.setIsLoading(false)

      return {
        ...defaultResult,
        handled: true,
        handledByTier: 4,
        tierLabel: 'grounding_missing_slot',
        clarificationCleared,
        isNewQuestionOrCommandDetected,
        classifierCalled,
        classifierResult,
        classifierTimeout,
        classifierLatencyMs,
        classifierError,
        isFollowUp,
      }
    }
  }

  // Per grounding-set-fallback-plan.md §G: increment soft-active turn counter
  // AFTER Tier 4.5 so the soft-active check can read the state before it expires.
  // If Tier 4.5 handled the input, it returned early and this line is never reached,
  // which is correct — a used soft-active turn should still count.
  if (ctx.incrementLastOptionsShownTurn) {
    ctx.incrementLastOptionsShownTurn()
  }

  // Per universal-selection-resolver-plan.md: increment widget selection turn counter
  // in parallel with lastOptionsShown turn counter.
  if (ctx.incrementWidgetSelectionTurn) {
    ctx.incrementWidgetSelectionTurn()
  }

  // =========================================================================
  // TIER 4.6 — Widget Context Questions
  //
  // Per widget-ui-snapshot-plan.md: When user asks about "this widget" and
  // widget context segments exist, skip doc retrieval and let the API handle
  // it with widgetContextSegments in the payload.
  //
  // Patterns: "what does this widget mean?", "what is this widget?",
  //           "explain this widget", "tell me about this widget"
  // =========================================================================
  const widgetContextQuestionPattern = /\b(this|the)\s+(widget|panel)\b/i
  const isWidgetContextQuestion = widgetContextQuestionPattern.test(ctx.trimmedInput)

  if (isWidgetContextQuestion) {
    // Check if we have visible widget snapshots with context segments
    const visibleSnapshots = ctx.getVisibleSnapshots?.() ?? []
    const hasWidgetContext = visibleSnapshots.some(snap =>
      snap.segments.some(seg => seg.segmentType === 'context')
    )

    if (hasWidgetContext) {
      void debugLog({
        component: 'ChatNavigation',
        action: 'tier_4_6_widget_context_question',
        metadata: {
          input: ctx.trimmedInput,
          snapshotCount: visibleSnapshots.length,
          reason: 'skip_docs_use_widget_context',
        },
      })

      // Return handled: false so it falls through to the API call,
      // where widgetContextSegments will be included in the payload
      return {
        ...defaultResult,
        handled: false,
        handledByTier: undefined,
        tierLabel: 'widget_context_passthrough',
        clarificationCleared,
        isNewQuestionOrCommandDetected,
        classifierCalled,
        classifierResult,
        classifierTimeout,
        classifierLatencyMs,
        classifierError,
        isFollowUp,
      }
    }
  }

  // =========================================================================
  // TIER 5 — Docs / Informational Routing
  //
  // Only reached when all higher tiers declined. Routes doc-style queries
  // ("what is X", "how do I") to doc retrieval.
  // =========================================================================
  if (semanticLaneDetected) {
    void debugLog({
      component: 'ChatNavigation',
      action: 'semantic_lane_skip_docs',
      metadata: { input: ctx.trimmedInput },
    })
  }
  const docRetrievalResult = !semanticLaneDetected ? await handleDocRetrieval({
    trimmedInput: ctx.trimmedInput,
    uiContext: ctx.uiContext,
    docRetrievalState: ctx.docRetrievalState,
    lastClarification: ctx.lastClarification,
    clarificationCleared,
    knownTermsFetchStatus: ctx.knownTermsFetchStatus,
    usedCoreAppTermsFallback: ctx.usedCoreAppTermsFallback,
    classifierCalled,
    classifierResult,
    classifierTimeout,
    classifierLatencyMs,
    classifierError,
    isNewQuestionOrCommandDetected,
    isFollowUp,
    addMessage: ctx.addMessage,
    updateDocRetrievalState: ctx.updateDocRetrievalState,
    setIsLoading: ctx.setIsLoading,
    setPendingOptions: ctx.setPendingOptions,
    setPendingOptionsMessageId: ctx.setPendingOptionsMessageId as (messageId: string) => void,
    setLastClarification: ctx.setLastClarification,
  }) : { handled: false, route: undefined }
  if (docRetrievalResult.handled) {
    return {
      ...defaultResult,
      handled: true,
      handledByTier: 5,
      tierLabel: 'doc_retrieval',
      clarificationCleared,
      isNewQuestionOrCommandDetected,
      classifierCalled,
      classifierResult,
      classifierTimeout,
      classifierLatencyMs,
      classifierError,
      isFollowUp,
    }
  }

  // =========================================================================
  // No tier handled — return to caller for LLM API fallback
  // =========================================================================
  return {
    ...defaultResult,
    clarificationCleared,
    isNewQuestionOrCommandDetected,
    classifierCalled,
    classifierResult,
    classifierTimeout,
    classifierLatencyMs,
    classifierError,
    isFollowUp,
  }

  } finally {
    // Per selection-intent-arbitration-incubation-plan Phase 2c:
    // Increment focus latch turn counter at end of EVERY turn, regardless of which
    // tier handled the input. This prevents TTL drift across different return paths.
    if (isLatchEnabled) {
      ctx.incrementFocusLatchTurn()
    }
  }
}
