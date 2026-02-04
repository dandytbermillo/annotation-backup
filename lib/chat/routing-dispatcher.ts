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
import { levenshteinDistance } from '@/lib/chat/typo-suggestions'
import type { ChatMessage, SelectionOption, ViewPanelContent } from '@/lib/chat'
import type { UIContext } from '@/lib/chat/intent-prompt'
import type { LastClarificationState } from '@/lib/chat/chat-navigation-context'
import type { DocRetrievalState } from '@/lib/docs/doc-retrieval-state'
import type { VisibleWidget } from '@/lib/chat/panel-command-matcher'
import type { RepairMemoryState, ClarificationSnapshot, ClarificationOption, LastSuggestionState, SuggestionCandidate, ChatSuggestions } from '@/lib/chat/chat-navigation-context'
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
import { isAffirmationPhrase, isRejectionPhrase, matchesReshowPhrases, matchesShowAllHeuristic, hasGraceSkipActionVerb, hasQuestionIntent } from '@/lib/chat/query-patterns'
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
  openPanelDrawer: (panelId: string, panelTitle?: string) => void
  openPanelWithTracking: (content: ViewPanelContent, panelId?: string) => void

  // --- Grounding-Set Fallback (Tier 4.5, per grounding-set-fallback-plan.md) ---
  sessionState: import('@/lib/chat/intent-prompt').SessionState
  lastOptionsShown: import('@/lib/chat/chat-navigation-context').LastOptionsShown | null
  incrementLastOptionsShownTurn?: () => void
  /** Save last options shown for soft-active window (called wherever dispatcher creates options) */
  saveLastOptionsShown: (options: import('@/lib/chat/chat-navigation-context').ClarificationOption[], messageId: string) => void

  // --- Widget Registry (Tier 4.5, per widget-registry-implementation-plan.md) ---
  getVisibleSnapshots: () => import('@/lib/widgets/ui-snapshot-registry').WidgetSnapshot[]
  getActiveWidgetId: () => string | null
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
}

// =============================================================================
// Explicit Command Detection (moved from chat-navigation-panel.tsx)
// =============================================================================

/**
 * Check if input is an explicit command (has action verb).
 * Used by Tier 2 to clear pending options before executing new commands.
 */
export function isExplicitCommand(input: string): boolean {
  const normalized = input.toLowerCase()

  // Phase 2b: Ordinal/number language bypass
  const hasOrdinal = /\b(first|second|third|fourth|fifth|last|[1-9])\b/i.test(normalized)
  if (hasOrdinal) {
    return false
  }

  // Action verbs that indicate a new command
  const actionVerbs = [
    'open', 'show', 'list', 'view', 'go', 'back', 'home',
    'create', 'rename', 'delete', 'remove',
  ]

  return actionVerbs.some(verb => normalized.includes(verb))
}

// =============================================================================
// Selection Helpers (moved from chat-navigation-panel.tsx)
// =============================================================================

/**
 * Normalize ordinal typos before selection matching.
 * Handles repeated letters, common misspellings, and concatenated ordinals.
 *
 * Examples:
 * - "ffirst" → "first" (repeated letters)
 * - "sedond" → "second" (common misspelling)
 * - "secondoption" → "second option" (concatenation)
 * - "firstoption" → "first option" (concatenation)
 */
/** Canonical ordinals for per-token fuzzy matching. */
const ORDINAL_TARGETS = ['first', 'second', 'third', 'fourth', 'fifth', 'last']

function normalizeOrdinalTypos(input: string): string {
  let n = input.toLowerCase().trim()

  // Strip polite suffixes
  n = n.replace(/\s*(pls|plz|please|thx|thanks|ty)\.?$/i, '').trim()

  // Deduplicate repeated letters: "ffirst" → "first", "seecond" → "second"
  n = n.replace(/(.)\1+/g, '$1')

  // Split concatenated ordinal+option: "secondoption" → "second option"
  n = n.replace(/^(first|second|third|fourth|fifth|last)(option|one)$/i, '$1 $2')

  // Per-token fuzzy match against canonical ordinals (distance ≤ 2, token length ≥ 4).
  // Catches typos like "sesecond" → "second", "scond" → "second", "thrid" → "third".
  const tokens = n.split(/\s+/)
  const normalized = tokens.map(token => {
    if (token.length < 4) return token // Guard: skip short tokens to avoid "for"→"fourth"
    // Skip tokens that are already canonical ordinals
    if (ORDINAL_TARGETS.includes(token)) return token

    let bestOrdinal: string | null = null
    let bestDist = Infinity
    for (const ordinal of ORDINAL_TARGETS) {
      const dist = levenshteinDistance(token, ordinal)
      if (dist > 0 && dist <= 2 && dist < bestDist) {
        bestDist = dist
        bestOrdinal = ordinal
      }
    }
    return bestOrdinal ?? token
  }).join(' ')

  return normalized
}

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
 * Check if input is a selection-only pattern (ordinal or single letter).
 * Per llm-chat-context-first-plan.md: Only intercept pure selection patterns.
 *
 * Returns: { isSelection: true, index: number } if input is a selection
 *          { isSelection: false } if input should go to LLM
 *
 * Selection patterns (fully match, no extra words):
 * - Ordinals: "first", "second", "third", "last", "1", "2", "3"
 * - Option phrases: "option 2", "the first one", "the second one"
 * - Single letters: "a", "b", "c", "d", "e" (when options use letter badges)
 * - Common typos: "ffirst", "sedond", "secondoption" (normalized before matching)
 */
function isSelectionOnly(
  input: string,
  optionCount: number,
  optionLabels?: string[]
): { isSelection: boolean; index?: number } {
  const normalized = normalizeOrdinalTypos(input)

  const selectionPattern = /^(first|second|third|fourth|fifth|last|[1-9]|option\s*[1-9]|the\s+(first|second|third|fourth|fifth|last)\s+(one|option)|first\s+option|second\s+option|third\s+option|fourth\s+option|fifth\s+option|[a-e])$/i

  if (!selectionPattern.test(normalized)) {
    return { isSelection: false }
  }

  // Map to 0-based index
  const ordinalMap: Record<string, number> = {
    'first': 0, '1': 0, 'option 1': 0, 'the first one': 0, 'the first option': 0, 'first option': 0, 'a': 0,
    'second': 1, '2': 1, 'option 2': 1, 'the second one': 1, 'the second option': 1, 'second option': 1, 'b': 1,
    'third': 2, '3': 2, 'option 3': 2, 'the third one': 2, 'the third option': 2, 'third option': 2, 'c': 2,
    'fourth': 3, '4': 3, 'option 4': 3, 'the fourth one': 3, 'the fourth option': 3, 'fourth option': 3, 'd': 3,
    'fifth': 4, '5': 4, 'option 5': 4, 'the fifth one': 4, 'the fifth option': 4, 'fifth option': 4, 'e': 4,
  }

  // Handle "last"
  if (normalized === 'last' || normalized === 'the last one' || normalized === 'the last option') {
    const index = optionCount - 1
    if (index >= 0) {
      return { isSelection: true, index }
    }
    return { isSelection: false }
  }

  // For single letters, check if option labels contain that letter badge
  if (/^[a-e]$/.test(normalized) && optionLabels) {
    const letterUpper = normalized.toUpperCase()
    const matchIndex = optionLabels.findIndex(label =>
      label.toUpperCase().includes(letterUpper) ||
      label.toUpperCase().endsWith(` ${letterUpper}`)
    )
    if (matchIndex >= 0) {
      return { isSelection: true, index: matchIndex }
    }
    // Letter doesn't match any option - not a selection
    return { isSelection: false }
  }

  // Check ordinal map
  const index = ordinalMap[normalized]
  if (index !== undefined && index < optionCount) {
    return { isSelection: true, index }
  }

  return { isSelection: false }
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
 */
function bindGroundingClarifierOptions(
  ctx: RoutingDispatcherContext,
  candidates: GroundingCandidate[],
  messageId: string
): PendingOptionState[] {
  const optionCandidates = candidates.filter(c => c.type === 'option' || c.type === 'widget_option')
  if (optionCandidates.length === 0) return []

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
  })

  if (pendingOptions.length === 0) return []

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

  // NOTE: lastOptionsShown turn increment is deferred to AFTER Tier 4.5
  // so the soft-active check can read the state before it expires on the same turn.
  // See increment call after the Tier 4.5 block below.

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

  // Tier 2c: Panel Disambiguation (deterministic, pre-LLM)
  // Question intent override: "what is links panel?" should route to docs (Tier 5),
  // not get caught by token-subset matching in panel disambiguation.
  if (hasQuestionIntent(ctx.trimmedInput)) {
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
      setPendingOptionsMessageId: ctx.setPendingOptionsMessageId as (messageId: string) => void,
      setLastClarification: ctx.setLastClarification,
      saveLastOptionsShown: ctx.saveLastOptionsShown,
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
  const metaExplainResult = await handleMetaExplain({
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
  })
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
      ctx.openPanelDrawer(ctx.lastPreview.drawerPanelId, ctx.lastPreview.drawerPanelTitle)
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
            ctx.openPanelDrawer(ctx.lastPreview.drawerPanelId, ctx.lastPreview.drawerPanelTitle)
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
  if (ctx.pendingOptions.length > 0 && ctx.activeOptionSetId !== null && !hasQuestionIntent(ctx.trimmedInput)) {
    const optionLabels = ctx.pendingOptions.map(opt => opt.label)
    const selectionResult = isSelectionOnly(ctx.trimmedInput, ctx.pendingOptions.length, optionLabels)

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
  if (ctx.pendingOptions.length === 0 && ctx.activeOptionSetId !== null && !hasQuestionIntent(ctx.trimmedInput)) {
    const now = Date.now()
    const lastOptionsMessage = ctx.findLastOptionsMessage(ctx.messages)
    const messageAge = lastOptionsMessage ? now - lastOptionsMessage.timestamp.getTime() : null
    const isWithinGraceWindow = lastOptionsMessage && messageAge !== null && messageAge <= ctx.reshowWindowMs

    if (isWithinGraceWindow && lastOptionsMessage) {
      // Use selection-only guard for message-derived options too
      const optionLabels = lastOptionsMessage.options.map(opt => opt.label)
      const selectionResult = isSelectionOnly(ctx.trimmedInput, lastOptionsMessage.options.length, optionLabels)

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

  // Build widget registry snapshot early so Tier 4 can check for visible widget lists.
  // This allows "open summary144" to bypass Tier 4's unknown-noun fallback when a
  // widget list is visible (let Tier 4.5 handle it instead).
  const turnSnapshot = buildTurnSnapshot({})

  // DIAGNOSTIC: Log openWidgets state to debug single-widget-list matching
  void debugLog({
    component: 'ChatNavigation',
    action: 'turn_snapshot_built',
    metadata: {
      openWidgetsCount: turnSnapshot.openWidgets.length,
      widgetLabels: turnSnapshot.openWidgets.map(w => w.label),
      widgetIds: turnSnapshot.openWidgets.map(w => w.id),
      widgetOptionCounts: turnSnapshot.openWidgets.map(w => w.options.length),
      hasBadgeLetters: turnSnapshot.hasBadgeLetters,
      input: ctx.trimmedInput,
    },
  })

  const hasSoftActiveSelectionLike = ctx.activeOptionSetId === null
    && !!ctx.lastOptionsShown
    && ctx.lastOptionsShown.options.length > 0
    && isSelectionLike(ctx.trimmedInput, { hasBadgeLetters: turnSnapshot.hasBadgeLetters })

  // Check if there's a visible widget list that could match the input
  const hasVisibleWidgetList = turnSnapshot.openWidgets.length > 0

  const knownNounResult = handleKnownNounRouting({
    trimmedInput: ctx.trimmedInput,
    visibleWidgets: ctx.uiContext?.dashboard?.visibleWidgets,
    addMessage: ctx.addMessage,
    setIsLoading: ctx.setIsLoading,
    openPanelDrawer: ctx.openPanelDrawer,
    setPendingOptions: ctx.setPendingOptions,
    setPendingOptionsMessageId: ctx.setPendingOptionsMessageId,
    setLastClarification: ctx.setLastClarification,
    handleSelectOption: ctx.handleSelectOption,
    hasActiveOptionSet: ctx.pendingOptions.length > 0 && ctx.activeOptionSetId !== null,
    hasSoftActiveSelectionLike,
    hasVisibleWidgetList,
    saveLastOptionsShown: ctx.saveLastOptionsShown,
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
  {
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

    // Run grounding-set fallback
    const groundingResult = handleGroundingSetFallback(ctx.trimmedInput, groundingCtx, {
      hasBadgeLetters: turnSnapshot.hasBadgeLetters,
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

        if (matchingOption && 'type' in matchingOption && 'data' in matchingOption) {
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

        if (messageOption) {
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
      if (isGroundingLLMEnabled()) {
        try {
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

                if (matchingOption && 'type' in matchingOption && 'data' in matchingOption) {
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

                if (messageOption) {
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
  const docRetrievalResult = await handleDocRetrieval({
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
  })
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
}
