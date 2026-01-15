/**
 * Chat Navigation Panel
 *
 * A natural language interface for navigating workspaces and notes.
 * Uses LLM to parse user commands and executes navigation actions.
 *
 * Phase 4: Chat UI Integration
 */

'use client'

import { useState, useCallback, useRef, useEffect } from 'react'
import { MessageSquare, Send, X, Loader2, ChevronRight, PanelLeftClose, Clock } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Badge } from '@/components/ui/badge'
import { ScrollArea } from '@/components/ui/scroll-area'
import { cn } from '@/lib/utils'
import { debugLog } from '@/lib/utils/debug-logger'
import {
  useChatNavigation,
  useChatNavigationContext,
  ViewPanelProvider,
  useViewPanel,
  type IntentResolutionResult,
  type ChatMessage,
  type SelectionOption,
  type WorkspaceMatch,
  type ViewPanelContent,
  type ViewListItem,
  type ChatSuggestions,
} from '@/lib/chat'
import { ViewPanel } from './view-panel'
import { MessageResultPreview } from './message-result-preview'
import { getActiveEntryContext } from '@/lib/entry/entry-context'
import { getActiveWorkspaceContext } from '@/lib/note-workspaces/state'
import type { UIContext } from '@/lib/chat/intent-prompt'
import {
  showWorkspaceOpenedToast,
  showWorkspaceCreatedToast,
  showWorkspaceRenamedToast,
  showWorkspaceDeletedToast,
  showDashboardToast,
  showHomeToast,
  showEntryOpenedToast,
} from '@/lib/chat/navigation-toast'
import { getKnownTermsSync, fetchKnownTerms, isKnownTermsCacheValid } from '@/lib/docs/known-terms-client'

export interface ChatNavigationPanelProps {
  /** Current entry ID for context */
  currentEntryId?: string
  /** Current workspace ID for context */
  currentWorkspaceId?: string
  /** Callback when navigation completes */
  onNavigationComplete?: () => void
  /** Custom trigger element */
  trigger?: React.ReactNode
  /** Additional class name for the panel */
  className?: string
  /** Hide the trigger button when panel is mounted globally */
  showTrigger?: boolean
  /** Optional override for the hidden anchor position */
  anchorClassName?: string
  // Note: visiblePanels and focusedPanelId are now read from ChatNavigationContext (Gap 2)
}

// =============================================================================
// Normalization Helper
// =============================================================================

/**
 * Normalize user input before sending to LLM.
 * - Strip filler phrases ("how about", "please", "can you", etc.)
 * - Collapse duplicate tokens ("workspace workspace 5" → "workspace 5")
 * - Trim whitespace
 *
 * Note: Preserves "create" and "new" keywords to distinguish open vs create intent.
 * Note: Uses case-insensitive matching but preserves original casing in output.
 */
function normalizeUserMessage(input: string): string {
  let normalized = input.trim()

  // Strip common filler phrases (but preserve "create" and "new")
  const fillerPatterns = [
    /^(hey|hi|hello|please|can you|could you|would you|i want to|i'd like to|let's|let me|how about|what about)\s+/i,
    /\s+(please|thanks|thank you)$/i,
  ]
  for (const pattern of fillerPatterns) {
    normalized = normalized.replace(pattern, '')
  }

  // Collapse duplicate consecutive words ("workspace workspace 5" → "workspace 5")
  normalized = normalized.replace(/\b(\w+)\s+\1\b/gi, '$1')

  // Collapse multiple spaces
  normalized = normalized.replace(/\s+/g, ' ').trim()

  return normalized
}

// Context assembly limits
const MAX_RECENT_USER_MESSAGES = 6
const SUMMARY_MAX_CHARS = 400

// =============================================================================
// Ordinal Parser
// =============================================================================

/**
 * Parse ordinal phrases to 1-based index.
 * Returns the index if recognized, -1 for "last", or null if not an ordinal.
 */
function parseOrdinal(input: string): number | null {
  const normalized = input.toLowerCase().trim()

  // Simple ordinals
  const ordinalMap: Record<string, number> = {
    'first': 1, '1': 1, 'one': 1, 'the first': 1, 'first one': 1, 'the first one': 1,
    'second': 2, '2': 2, 'two': 2, 'the second': 2, 'second one': 2, 'the second one': 2,
    'third': 3, '3': 3, 'three': 3, 'the third': 3, 'third one': 3, 'the third one': 3,
    'fourth': 4, '4': 4, 'four': 4, 'the fourth': 4, 'fourth one': 4, 'the fourth one': 4,
    'fifth': 5, '5': 5, 'five': 5, 'the fifth': 5, 'fifth one': 5, 'the fifth one': 5,
    'last': -1, 'the last': -1, 'last one': -1, 'the last one': -1,
  }

  // Check for exact match
  if (ordinalMap[normalized] !== undefined) {
    return ordinalMap[normalized]
  }

  // Check for patterns like "option 1", "option 2", etc.
  const optionMatch = normalized.match(/^(?:option|number|#)\s*(\d+)$/i)
  if (optionMatch) {
    return parseInt(optionMatch[1], 10)
  }

  return null
}

function extractQuickLinksBadge(title?: string): string | null {
  if (!title) return null
  const match = title.match(/quick\s*links?\s*([a-z])/i)
  return match ? match[1].toLowerCase() : null
}

/**
 * Pending option stored in chat state
 */
interface PendingOptionState {
  index: number
  label: string
  sublabel?: string
  type: string
  id: string
  // Phase 2a: Flag to trigger auto-answer with open notes after workspace selection
  notesScopeFollowUp?: boolean
  data: unknown
}

/** Grace window for re-showing last options (60 seconds) */
const RESHOW_WINDOW_MS = 60_000

/**
 * Recency decay windows for different context types.
 * Per llm-layered-chat-experience-plan.md:
 * - Options expire faster (shortest window)
 * - Opened panel can persist longer
 * Note: lastAssistantMessage/lastUserMessage are not decayed (always available)
 */
const CONTEXT_DECAY = {
  options: 60_000,       // 60 seconds - options expire fast
  listPreview: 90_000,   // 90 seconds - list previews slightly longer
  openedPanel: 180_000,  // 3 minutes - panels persist longer
} as const

/**
 * Last preview state for "show all" shortcut
 */
interface LastPreviewState {
  source: string
  viewPanelContent: ViewPanelContent
  totalCount: number
  messageId: string
  createdAt: number
  drawerPanelId?: string
  drawerPanelTitle?: string
}

/**
 * Check if input matches "show all" keyword heuristic.
 * Returns true if message appears to be asking to expand a preview list.
 */
function matchesShowAllHeuristic(input: string): boolean {
  const normalized = input.toLowerCase().trim()

  // Pattern 1: "all" + (items|list|results|entries|everything)
  if (/\ball\b/.test(normalized) && /\b(items|list|results|entries)\b/.test(normalized)) {
    return true
  }

  // Pattern 2: "full list" or "complete list"
  if (/\b(full|complete)\s+list\b/.test(normalized)) {
    return true
  }

  // Pattern 3: "all" + number (e.g., "all 14")
  if (/\ball\s+\d+\b/.test(normalized)) {
    return true
  }

  // Pattern 4: "everything" or "the rest"
  if (/\b(everything|the\s+rest)\b/.test(normalized)) {
    return true
  }

  // Pattern 5: "show more" / "see more"
  if (/\b(show|see)\s+more\b/.test(normalized)) {
    return true
  }

  return false
}

/**
 * Check if input is an affirmation phrase.
 * Per Phase 2a.3: Expanded affirmation patterns for clarification responses.
 * Categories:
 * - Explicit: yes, yeah, yep, yup, sure, ok, okay
 * - Polite: please, go ahead, do it, proceed
 * - Confirmations: correct, right, exactly, confirm, confirmed
 * - Casual: k, ya, ye, yea, mhm, uh huh
 * All patterns support optional "please" suffix.
 */
function isAffirmationPhrase(input: string): boolean {
  const normalized = input.toLowerCase().trim()
  // Core affirmations with optional "please" suffix
  const AFFIRMATION_PATTERN = /^(yes|yeah|yep|yup|sure|ok|okay|k|ya|ye|yea|mhm|uh\s*huh|go ahead|do it|proceed|correct|right|exactly|confirm|confirmed)(\s+please)?$/
  return AFFIRMATION_PATTERN.test(normalized)
}

/**
 * Check if input is a rejection phrase.
 * Per Phase 2a.3: Rejection patterns for clarification responses.
 */
function isRejectionPhrase(input: string): boolean {
  const normalized = input.toLowerCase().trim()
  // Rejection patterns: explicit no, cancel intent, soft rejection
  const REJECTION_PATTERN = /^(no|nope|nah|negative|cancel|stop|abort|never\s*mind|forget it|don't|not now|skip|pass|wrong|incorrect|not that)$/
  return REJECTION_PATTERN.test(normalized)
}

/**
 * Check if input is a META phrase (request for explanation).
 * Per clarification-meta-response-plan.md: Handle "what do you mean?" style queries.
 * Only triggers when clarification is already active.
 */
function isMetaPhrase(input: string): boolean {
  const normalized = input.toLowerCase().trim()
  // META patterns: requests for explanation or clarification
  const META_PATTERNS = [
    /^what(\s+do\s+you)?\s+mean\??$/,                    // "what do you mean?" / "what mean?"
    /^explain(\s+that)?(\s+please)?$/,                   // "explain" / "explain that"
    /^help(\s+me)?(\s+understand)?$/,                    // "help" / "help me understand"
    /^what\s+are\s+(my\s+)?options\??$/,                 // "what are my options?"
    /^what('s|s|\s+is)\s+the\s+difference\??$/,          // "what's the difference?"
    /^huh\??$/,                                          // "huh?"
    /^\?+$/,                                             // "?" / "??"
    /^what\??$/,                                         // "what?" / "what"
    /^(i('m|m)?\s+)?not\s+sure$/,                        // "not sure" / "I'm not sure"
    /^i\s+don('t|t)\s+know$/,                            // "I don't know"
    /^(can\s+you\s+)?tell\s+me\s+more\??$/,              // "tell me more" / "can you tell me more?"
    /^what\s+is\s+that\??$/,                             // "what is that?"
    /^i('m|m)?\s+not\s+sure\s+what\s+that\s+(does|means)\??$/,  // "I'm not sure what that does"
    /^clarify(\s+please)?$/,                             // "clarify"
    /^options\??$/,                                      // "options?"
  ]
  return META_PATTERNS.some(pattern => pattern.test(normalized))
}

/**
 * Match ordinal phrases to option index.
 * Returns 0-based index or undefined if no match.
 */
function matchOrdinal(input: string, optionCount: number): number | undefined {
  const normalized = input.toLowerCase().trim()

  const ordinals: Record<string, number> = {
    'first': 0, 'first one': 0, 'the first': 0, 'the first one': 0, '1st': 0,
    'second': 1, 'second one': 1, 'the second': 1, 'the second one': 1, '2nd': 1,
    'third': 2, 'third one': 2, 'the third': 2, 'the third one': 2, '3rd': 2,
    'fourth': 3, 'fourth one': 3, 'the fourth': 3, 'the fourth one': 3, '4th': 3,
    'fifth': 4, 'fifth one': 4, 'the fifth': 4, 'the fifth one': 4, '5th': 4,
    'last': optionCount - 1, 'last one': optionCount - 1, 'the last': optionCount - 1, 'the last one': optionCount - 1,
  }

  for (const [phrase, index] of Object.entries(ordinals)) {
    if (normalized === phrase || normalized.includes(phrase)) {
      if (index >= 0 && index < optionCount) {
        return index
      }
    }
  }

  return undefined
}

/**
 * Check if input matches re-show options phrases.
 * Per pending-options-reshow-grace-window.md triggers.
 * Handles common typos via simple normalization.
 */
function matchesReshowPhrases(input: string): boolean {
  const normalized = input.toLowerCase().trim()
    // Normalize common typos
    .replace(/shwo|shw/g, 'show')
    .replace(/optins|optons|optiosn/g, 'options')
    .replace(/teh/g, 'the')

  const reshowPatterns = [
    /^show\s*(me\s*)?(the\s*)?options$/,
    /^(what\s*were\s*those|what\s*were\s*they)\??$/,
    /^i'?m\s*confused\??$/,
    /^(can\s*you\s*)?show\s*(me\s*)?(again|them)\??$/,
    /^remind\s*me\??$/,
    /^options\??$/,
  ]

  return reshowPatterns.some(pattern => pattern.test(normalized))
}

/**
 * Check if input is a meta-explain phrase OUTSIDE of clarification mode.
 * Per meta-explain-outside-clarification-plan.md (Tiered Plan)
 * Handles: "explain", "what do you mean?", "explain home", etc.
 */
/**
 * Strip conversational prefixes to extract the core question.
 * e.g., "can you tell me what are the workspaces actions?" → "what are the workspaces actions"
 */
function stripConversationalPrefix(input: string): string {
  const normalized = input.trim().toLowerCase().replace(/[?!.]+$/, '')

  // Common conversational prefixes to strip
  // Note: "pls" is common shorthand for "please"
  const prefixes = [
    /^(can|could|would|will) you (please |pls )?(tell me|explain|help me understand) /i,
    /^(please |pls )?(tell me|explain) /i,
    /^i('d| would) (like to|want to) (know|understand) /i,
    /^(do you know|can you help me understand) /i,
  ]

  let result = normalized
  for (const prefix of prefixes) {
    result = result.replace(prefix, '')
  }

  return result
}

function isMetaExplainOutsideClarification(input: string): boolean {
  // Strip trailing punctuation for matching
  const normalized = input.trim().toLowerCase().replace(/[?!.]+$/, '')

  // Direct meta phrases
  if (
    normalized === 'explain' ||
    normalized === 'what do you mean' ||
    normalized === 'explain that' ||
    normalized === 'help me understand' ||
    normalized === 'what is that' ||
    normalized === 'tell me more'
  ) {
    return true
  }

  // "explain <concept>" pattern
  if (normalized.startsWith('explain ')) {
    return true
  }

  // "what is <concept>" pattern
  if (normalized.startsWith('what is ') || normalized.startsWith('what are ')) {
    return true
  }

  // Check after stripping conversational prefixes
  // e.g., "can you tell me what are the workspaces actions?" → "what are the workspaces actions"
  const stripped = stripConversationalPrefix(normalized)
  if (stripped !== normalized) {
    if (stripped.startsWith('what is ') || stripped.startsWith('what are ')) {
      return true
    }
  }

  return false
}

/**
 * Extract the concept from a meta-explain phrase.
 * Returns null if no specific concept is mentioned.
 * Handles conversational prefixes like "can you tell me what are X"
 */
function extractMetaExplainConcept(input: string): string | null {
  const normalized = input.trim().toLowerCase().replace(/[?!.]+$/, '')

  // Try direct patterns first, then try after stripping conversational prefix
  const variants = [normalized, stripConversationalPrefix(normalized)]

  for (const text of variants) {
    // "explain <concept>"
    if (text.startsWith('explain ') && text !== 'explain that') {
      const concept = text.replace(/^explain\s+/, '').trim()
      if (concept && concept !== 'that') return concept
    }

    // "what is <concept>"
    if (text.startsWith('what is ')) {
      const concept = text.replace(/^what is\s+(a\s+|an\s+|the\s+)?/, '').trim()
      if (concept) return concept
    }

    // "what are <concepts>"
    if (text.startsWith('what are ')) {
      const concept = text.replace(/^what are\s+(the\s+)?/, '').trim()
      if (concept) return concept
    }
  }

  return null
}

// =============================================================================
// V4 Doc Retrieval Routing Helpers
// Per general-doc-retrieval-routing-plan.md (v4)
// =============================================================================

/**
 * Route types for doc retrieval routing decision.
 */
type DocRoute = 'doc' | 'action' | 'bare_noun' | 'llm'

/**
 * Action nouns that should bypass doc retrieval and use normal routing.
 * Per v4 plan: minimal set of navigation shortcuts.
 * Note: singular "workspace" is doc-routable, only plural "workspaces" is action.
 */
const ACTION_NOUNS = new Set<string>([
  'recent',
  'recents',
  'quick links',
  'quicklinks',
  'workspaces', // plural only; keep singular "workspace" doc-routable
])

/**
 * Polite command prefixes that indicate an action request, not a doc question.
 * Per v4 plan: "can you open..." is a command, but "can I rename?" is a question.
 */
const POLITE_COMMAND_PREFIXES = [
  'can you',
  'could you',
  'would you',
  'please',
  'show me',
]

/**
 * Doc-verb cues: low-churn list of verbs that indicate doc-style queries.
 * Per v4 plan: these extend beyond question-word detection.
 */
const DOC_VERBS = new Set<string>([
  'describe',
  'clarify',
  'define',
  'overview',
  'meaning',
])

/**
 * Check if string starts with any of the given prefixes.
 */
function startsWithAnyPrefix(normalized: string, prefixes: string[]): boolean {
  return prefixes.some(p => normalized === p || normalized.startsWith(p + ' '))
}

/**
 * Normalize user input for routing decisions.
 * Per v4 plan: consistent normalization for both routing and retrieval.
 */
function normalizeInputForRouting(input: string): { normalized: string; tokens: string[] } {
  const normalized = input
    .toLowerCase()
    .trim()
    .replace(/[-_/,:;]+/g, ' ')
    .replace(/[?!.]+$/, '')
    .replace(/\s+/g, ' ')

  // NOTE: In real impl apply synonyms + conservative stemming + typo fix BEFORE tokenization.
  const tokens = normalized.split(/\s+/).filter(Boolean)
  return { normalized, tokens }
}

/**
 * Normalize a widget/doc title for comparison.
 */
function normalizeTitle(title: string): string {
  return title
    .toLowerCase()
    .trim()
    .replace(/[-_/,:;]+/g, ' ')
    .replace(/[?!.]+$/, '')
    .replace(/\s+/g, ' ')
}

/**
 * Check if input has question intent (starts with question word or ends with ?).
 * Per v4 plan: broad detection of question-like inputs.
 */
function hasQuestionIntent(normalized: string): boolean {
  return (
    /^(what|how|where|when|why|who|which|can|could|would|should|tell|explain|help|is|are|do|does)\b/i.test(
      normalized
    ) ||
    normalized.endsWith('?')
  )
}

/**
 * Check if input contains action verbs.
 * Per v4 plan: used for command detection.
 */
function hasActionVerb(normalized: string): boolean {
  return /\b(open|close|show|list|go|create|rename|delete|remove|add|navigate|edit|modify|change|update)\b/i.test(
    normalized
  )
}

/**
 * Check if input matches a visible widget title.
 * Per v4 plan: visible widget bypass routes to action.
 */
function matchesVisibleWidgetTitle(normalized: string, uiContext?: UIContext | null): boolean {
  const widgets = uiContext?.dashboard?.visibleWidgets
  if (!widgets?.length) return false

  return widgets.some(w => normalizeTitle(w.title) === normalized)
}

/**
 * Check if input contains doc instruction cues.
 * Per v4 plan: "how to", "show me how" are doc-style even with "show me" prefix.
 */
function containsDocInstructionCue(normalized: string): boolean {
  return /\b(how to|how do i|tell me how|show me how|walk me through)\b/i.test(normalized)
}

/**
 * Check if input looks like an index-like reference (e.g., "workspace 6", "note 2").
 * Per v4 plan: these should route to action, not doc retrieval.
 */
function looksIndexLikeReference(normalized: string): boolean {
  return /\b(workspace|note|page|entry)\s+\d+\b/i.test(normalized)
}

/**
 * Check if input is command-like (should route to action).
 * Per v4 plan: imperative commands + polite commands - doc instruction cues.
 */
function isCommandLike(normalized: string): boolean {
  // Index-like selection should be action even without a verb: "note 2"
  if (looksIndexLikeReference(normalized)) return true

  // Imperative: action verb without question intent
  if (hasActionVerb(normalized) && !hasQuestionIntent(normalized)) return true

  // Polite command: prefix + action verb, unless it's clearly an instruction question
  if (
    startsWithAnyPrefix(normalized, POLITE_COMMAND_PREFIXES) &&
    hasActionVerb(normalized) &&
    !containsDocInstructionCue(normalized)
  ) {
    return true
  }

  return false
}

/**
 * Check if input is a doc-style query.
 * Per v4 plan: question intent OR doc-verb cues, AND not command-like.
 */
function isDocStyleQuery(input: string, uiContext?: UIContext | null): boolean {
  const { normalized, tokens } = normalizeInputForRouting(input)

  // Skip bare meta-explain phrases (handled by existing meta-explain handler)
  const bareMetaPhrases = ['explain', 'what do you mean', 'explain that', 'help me understand', 'what is that', 'tell me more']
  if (bareMetaPhrases.includes(normalized)) {
    return false
  }

  // Action noun bypass
  if (ACTION_NOUNS.has(normalized)) return false

  // Visible widget bypass
  if (matchesVisibleWidgetTitle(normalized, uiContext)) return false

  // Command-like bypass
  if (isCommandLike(normalized)) return false

  // Broad doc-style trigger: instruction cue OR question intent OR doc-verb cue
  if (containsDocInstructionCue(normalized)) return true
  if (hasQuestionIntent(normalized)) return true
  return tokens.some(t => DOC_VERBS.has(t))
}

/**
 * Extract the query term from a doc-style query.
 * E.g., "how do I add a widget" → "add widget"
 */
function extractDocQueryTerm(input: string): string {
  const { normalized } = normalizeInputForRouting(input)

  // Remove common prefixes
  let term = normalized
    .replace(/^what (is|are)\s+(a\s+|an\s+|the\s+)?/i, '')
    .replace(/^how (do i|to|can i)\s+/i, '')
    .replace(/^tell me (about\s+)?(a\s+|an\s+|the\s+)?/i, '')
    .replace(/^tell me how (to\s+)?/i, '')
    .replace(/^explain\s+(a\s+|an\s+|the\s+)?/i, '')
    .replace(/^what does\s+(a\s+|an\s+|the\s+)?/i, '')
    .replace(/^where can i\s+(find\s+|see\s+)?/i, '')
    .replace(/^how can i\s+/i, '')
    .replace(/^show me how (to\s+)?/i, '')
    .replace(/^walk me through\s+(how to\s+)?/i, '')
    .replace(/^describe\s+(the\s+|a\s+|an\s+)?/i, '')
    .replace(/^clarify\s+(the\s+|a\s+|an\s+)?/i, '')
    .replace(/^define\s+(the\s+|a\s+|an\s+)?/i, '')
    .trim()

  return term || normalized
}

/**
 * Check if input passes the bare-noun guard for doc retrieval.
 * Per v4 plan: 1-3 tokens, no action verbs, no digits, matches known terms,
 * not action noun, not visible widget.
 *
 * Note: knownTerms parameter is optional for now; can be integrated later
 * when the knownTerms builder is available.
 */
function isBareNounQuery(
  input: string,
  uiContext?: UIContext | null,
  knownTerms?: Set<string>
): boolean {
  const { normalized, tokens } = normalizeInputForRouting(input)

  // Guard: 1-3 tokens
  if (tokens.length === 0 || tokens.length > 3) return false

  // Guard: no action verbs
  if (hasActionVerb(normalized)) return false

  // Guard: no digits (e.g., "workspace 6", "note 2")
  if (/\d/.test(normalized)) return false

  // If knownTerms provided, check for match
  if (knownTerms) {
    const matchesKnown =
      tokens.some(t => knownTerms.has(t)) || knownTerms.has(normalized)
    if (!matchesKnown) return false
  }

  // Bypass: action noun
  if (ACTION_NOUNS.has(normalized)) return false

  // Bypass: visible widget
  if (matchesVisibleWidgetTitle(normalized, uiContext)) return false

  // Passes all guards - this is a bare noun that should try retrieval
  return true
}

/**
 * Main routing function for doc retrieval.
 * Per v4 plan: determines if input should go to doc, action, bare_noun, or llm route.
 *
 * Now with full knownTerms integration for app relevance gate.
 */
// Core app terms that are always checked, even if knownTerms cache is not loaded.
// This ensures queries with these terms route to doc retrieval regardless of cache state.
const CORE_APP_TERMS = new Set([
  'workspace', 'workspaces',
  'note', 'notes',
  'action', 'actions',
  'widget', 'widgets',
  'entry', 'entries',
  'folder', 'folders',
  'panel', 'panels',
  'annotation', 'annotations',
  'canvas',
  'navigation', 'navigate',
  'dashboard',
  'home',
])

function routeDocInput(
  input: string,
  uiContext?: UIContext | null,
  knownTerms?: Set<string>
): DocRoute {
  const { normalized, tokens } = normalizeInputForRouting(input)

  // Step 1: app relevance gate (v4 plan)
  // Check against both knownTerms (if available) AND core app terms
  let isAppRelevant = false

  // Always check core app terms (cache-independent)
  const hasCoreAppTerm = tokens.some(t => CORE_APP_TERMS.has(t))
  if (hasCoreAppTerm) {
    isAppRelevant = true
  }

  // Also check knownTerms if available
  if (knownTerms && knownTerms.size > 0) {
    const hasKnownTerm =
      tokens.some(t => knownTerms.has(t)) ||
      knownTerms.has(normalized) ||
      ACTION_NOUNS.has(normalized) ||
      matchesVisibleWidgetTitle(normalized, uiContext)

    if (hasKnownTerm) {
      isAppRelevant = true
    } else if (!hasCoreAppTerm) {
      // Not app-relevant (no core terms, no known terms) - skip retrieval, go to LLM
      return 'llm'
    }
  }

  // Step 2: visible widget bypass
  if (matchesVisibleWidgetTitle(normalized, uiContext)) return 'action'

  // Step 3: action-noun bypass
  if (ACTION_NOUNS.has(normalized)) return 'action'

  // Step 4: command-like (includes index-like digits)
  if (isCommandLike(normalized)) return 'action'

  // Step 5: doc-style routing
  if (isDocStyleQuery(input, uiContext)) return 'doc'

  // Step 6: bare noun routing (stricter)
  if (isBareNounQuery(input, uiContext, knownTerms)) return 'bare_noun'

  // Step 7: App-relevant fallback - if query contains known/core terms but doesn't match
  // specific patterns (e.g., typos like "an you pls tell me what are workspaces action?"),
  // route to doc retrieval anyway. Let keyword matching handle intent extraction.
  // This is more robust than adding endless regex patterns.
  if (isAppRelevant) {
    return 'doc'
  }

  return 'llm'
}

// =============================================================================
// V4 Response Policy Helpers
// Per general-doc-retrieval-routing-plan.md (v4)
// =============================================================================

/**
 * Detect correction/rejection phrases.
 * Per v4 plan: "no / not that / that's wrong" triggers re-retrieval.
 */
function isCorrectionPhrase(input: string): boolean {
  const normalized = input.trim().toLowerCase()
  const correctionPhrases = [
    'no',
    'nope',
    'not that',
    'not what i meant',
    'not what i asked',
    "that's wrong",
    'thats wrong',
    'wrong',
    'incorrect',
    'different',
    'something else',
    'try again',
  ]
  return correctionPhrases.some(p => normalized === p || normalized.startsWith(p + ' '))
}

/**
 * Detect pronoun follow-up phrases.
 * Per v4 plan: "tell me more", "how does it work" uses lastDocSlug.
 */
function isPronounFollowUp(input: string): boolean {
  const normalized = input.trim().toLowerCase()
  const followUpPhrases = [
    'tell me more',
    'more details',
    'explain more',
    'more',           // V5: Single-word follow-up
    'how does it work',
    'how does that work',
    'what else',
    'continue',
    'go on',
    'expand',         // V5: Added per plan
    'elaborate',
  ]
  // Exact match for single words, startsWith for phrases
  return followUpPhrases.some(p => normalized === p || normalized.startsWith(p + ' ') || normalized.startsWith(p))
}

/**
 * Format response based on user input style.
 * Per v4 plan: Match User Effort - short question → 1-2 sentences, etc.
 */
function getResponseStyle(input: string): 'short' | 'medium' | 'detailed' {
  const normalized = input.trim().toLowerCase()

  // Detailed: "walk me through", "step by step", "how do i"
  if (/\b(walk me through|step by step|steps to|how do i|how to)\b/.test(normalized)) {
    return 'detailed'
  }

  // Medium: "explain", "describe", "tell me about"
  if (/\b(explain|describe|tell me about|clarify)\b/.test(normalized)) {
    return 'medium'
  }

  // Short: "what is", short queries
  return 'short'
}

/**
 * Format snippet based on response style.
 * Per v4 plan: Match User Effort.
 */
function formatSnippet(snippet: string, style: 'short' | 'medium' | 'detailed'): string {
  if (!snippet) return snippet

  // Split into sentences
  const sentences = snippet.split(/(?<=[.!?])\s+/).filter(s => s.trim())

  switch (style) {
    case 'short':
      // 1-2 sentences
      return sentences.slice(0, 2).join(' ')
    case 'medium':
      // 2-3 sentences
      return sentences.slice(0, 3).join(' ')
    case 'detailed':
      // Full snippet
      return snippet
    default:
      return snippet
  }
}

/**
 * Add next step offer based on context.
 * Per v4 plan: Offer Next Steps (only when natural).
 */
function getNextStepOffer(style: 'short' | 'medium' | 'detailed', hasMoreContent: boolean): string {
  if (style === 'short' && hasMoreContent) {
    return '\n\nWant more detail?'
  }
  if (style === 'medium' && hasMoreContent) {
    return '\n\nWant the step-by-step?'
  }
  return ''
}

// =============================================================================
// V5 Hybrid Response Selection Helpers (HS1)
// Per general-doc-retrieval-routing-plan.md (v5)
// =============================================================================

/** V5 configurable thresholds */
const V5_MIN_BODY_CHARS = 80
const V5_HEADING_ONLY_MAX_CHARS = 50

/**
 * Strip markdown headers from text for body char count.
 * Removes lines starting with # to get actual body content.
 */
function stripMarkdownHeadersForUI(text: string): string {
  return text
    .split('\n')
    .filter(line => !line.trim().startsWith('#'))
    .join('\n')
    .trim()
}

/**
 * Check if snippet is low quality (heading-only or too short).
 * Per v5 plan: HS1 snippet quality guard.
 */
function isLowQualitySnippet(snippet: string, isHeadingOnly?: boolean, bodyCharCount?: number): boolean {
  // Use server-provided values if available
  if (isHeadingOnly === true) return true
  if (bodyCharCount !== undefined && bodyCharCount < V5_MIN_BODY_CHARS) return true

  // Fallback: compute locally if server didn't provide
  const strippedBody = stripMarkdownHeadersForUI(snippet)

  // Check if it's just a header
  if (snippet.trim().startsWith('#') && strippedBody.length < V5_HEADING_ONLY_MAX_CHARS) {
    return true
  }

  // Check if too short overall
  if (strippedBody.length < V5_MIN_BODY_CHARS) {
    return true
  }

  return false
}

/**
 * Attempt to upgrade a low-quality snippet via follow-up retrieval.
 * Per v5 plan: HS1 same-doc fallback search.
 * Returns upgraded snippet or null if upgrade failed.
 */
async function attemptSnippetUpgrade(
  docSlug: string,
  excludeChunkIds: string[]
): Promise<{ snippet: string; chunkIds: string[] } | null> {
  try {
    const response = await fetch('/api/docs/retrieve', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        mode: 'chunks',
        query: docSlug, // Use docSlug as query to get related content
        scopeDocSlug: docSlug,
        excludeChunkIds,
      }),
    })

    if (!response.ok) return null

    const result = await response.json()
    if (result.status === 'found' && result.results?.length > 0) {
      // Find first non-heading-only chunk
      for (const chunk of result.results) {
        if (!isLowQualitySnippet(chunk.snippet, chunk.isHeadingOnly, chunk.bodyCharCount)) {
          return {
            snippet: chunk.snippet,
            chunkIds: [chunk.chunkId],
          }
        }
      }
    }
    return null
  } catch {
    return null
  }
}

/**
 * Find the most recent assistant message that contains options (pills).
 * Per pending-options-message-source-plan.md: use chat as source of truth.
 * Returns the options and timestamp, or null if no options message exists.
 */
function findLastOptionsMessage(messages: ChatMessage[]): {
  options: PendingOptionState[]
  timestamp: Date
} | null {
  // Scan from newest to oldest
  for (let i = messages.length - 1; i >= 0; i--) {
    const msg = messages[i]
    if (msg.role === 'assistant' && msg.options && msg.options.length > 0) {
      return {
        options: msg.options.map((opt, idx) => ({
          index: idx + 1,
          label: opt.label,
          sublabel: opt.sublabel,
          type: opt.type,
          id: opt.id,
          data: opt.data,
        })),
        timestamp: msg.timestamp,
      }
    }
  }
  return null
}

/**
 * ChatContext for LLM clarification answers.
 * Per llm-chat-context-first-plan.md
 * Extended with recency info per llm-layered-chat-experience-plan.md
 */
interface ChatContext {
  lastAssistantMessage?: string
  lastOptions?: Array<{ label: string; sublabel?: string }>
  lastListPreview?: { title: string; count: number; items: string[] }
  lastOpenedPanel?: { title: string }
  lastShownContent?: { type: 'preview' | 'panel' | 'list'; title: string; count?: number }
  lastErrorMessage?: string
  lastUserMessage?: string
  // Recency indicators (for stale context detection)
  optionsAge?: number      // ms since options were shown
  openedPanelAge?: number  // ms since panel was opened
  isStale?: boolean        // true if all relevant context is stale
}

/**
 * Build ChatContext from chat messages.
 * Per llm-chat-context-first-plan.md - derive from chat messages (source of truth).
 * Extended with recency decay per llm-layered-chat-experience-plan.md.
 */
function buildChatContext(messages: ChatMessage[], uiContext?: UIContext | null): ChatContext {
  const context: ChatContext = {}
  const now = Date.now()

  // Track timestamps for recency checks
  let optionsTimestamp: number | null = null
  let openedPanelTimestamp: number | null = null

  // Scan from newest to oldest
  for (let i = messages.length - 1; i >= 0; i--) {
    const msg = messages[i]
    const msgAge = now - msg.timestamp.getTime()

    // Last user message
    if (!context.lastUserMessage && msg.role === 'user' && msg.content) {
      context.lastUserMessage = msg.content
    }

    // Last assistant message
    if (!context.lastAssistantMessage && msg.role === 'assistant' && msg.content) {
      context.lastAssistantMessage = msg.content

      // Check for error message
      if (!context.lastErrorMessage && msg.isError) {
        context.lastErrorMessage = msg.content
      }
    }

    // Check for options in ANY assistant message (not just the newest)
    // Apply recency decay - only include if within options window
    if (!context.lastOptions && msg.role === 'assistant' && msg.options && msg.options.length > 0) {
      if (msgAge <= CONTEXT_DECAY.options) {
        context.lastOptions = msg.options.map(opt => ({
          label: opt.label,
          sublabel: opt.sublabel,
        }))
        optionsTimestamp = msg.timestamp.getTime()
      }
    }

    // Check for list preview in ANY assistant message
    // Apply recency decay
    if (!context.lastListPreview && msg.role === 'assistant') {
      if (msgAge <= CONTEXT_DECAY.listPreview) {
        if (msg.previewItems && msg.previewItems.length > 0) {
          context.lastListPreview = {
            title: msg.viewPanelContent?.title || 'List',
            count: msg.totalCount || msg.previewItems.length,
            items: msg.previewItems.map((item: ViewListItem) => item.name),
          }
          if (!context.lastShownContent) {
            context.lastShownContent = {
              type: 'preview',
              title: msg.viewPanelContent?.title || 'items',
              count: msg.totalCount || msg.previewItems.length,
            }
          }
        } else if (msg.viewPanelContent?.items && msg.viewPanelContent.items.length > 0) {
          context.lastListPreview = {
            title: msg.viewPanelContent.title,
            count: msg.viewPanelContent.items.length,
            items: msg.viewPanelContent.items.map((item: ViewListItem) => item.name),
          }
          if (!context.lastShownContent) {
            context.lastShownContent = {
              type: 'list',
              title: msg.viewPanelContent.title,
              count: msg.viewPanelContent.items.length,
            }
          }
        }
      }
    }

    // Check for "Found X items" pattern in ANY assistant message
    if (!context.lastShownContent && msg.role === 'assistant' && msg.content) {
      if (msgAge <= CONTEXT_DECAY.listPreview) {
        const foundMatch = msg.content.match(/Found\s+(\d+)\s+(.+?)(?:\s+items?)?\.?$/i)
        if (foundMatch) {
          context.lastShownContent = {
            type: 'preview',
            title: foundMatch[2].trim(),
            count: parseInt(foundMatch[1], 10),
          }
        }
      }
    }

    // Check for opened panel in ANY assistant message
    // Opened panels persist longer
    if (!context.lastOpenedPanel && msg.role === 'assistant' && msg.content) {
      if (msgAge <= CONTEXT_DECAY.openedPanel) {
        const openingMatch = msg.content.match(/Opening\s+(?:panel\s+)?(.+?)\.?$/i)
        if (openingMatch) {
          context.lastOpenedPanel = { title: openingMatch[1] }
          openedPanelTimestamp = msg.timestamp.getTime()
          if (!context.lastShownContent) {
            context.lastShownContent = {
              type: 'panel',
              title: openingMatch[1],
            }
          }
        }
      }
    }

    // Stop once we have all context (limit scan depth)
    if (
      context.lastAssistantMessage &&
      context.lastUserMessage &&
      (context.lastOptions || context.lastListPreview || context.lastShownContent)
    ) {
      break
    }

    // Limit scan to last 10 messages for performance
    if (messages.length - 1 - i >= 10) {
      break
    }
  }

  // Prefer live UI drawer context over chat-derived panel open
  if (uiContext?.mode === 'dashboard' && uiContext.dashboard?.openDrawer?.title) {
    context.lastOpenedPanel = { title: uiContext.dashboard.openDrawer.title }
    context.lastShownContent = {
      type: 'panel',
      title: uiContext.dashboard.openDrawer.title,
    }
    openedPanelTimestamp = now
    // DEBUG: Log UIContext override
    void debugLog({
      component: 'ChatNavigation',
      action: 'buildChatContext_uiOverride',
      metadata: {
        overrideTitle: uiContext.dashboard.openDrawer.title,
        uiMode: uiContext.mode,
      },
    })
  }

  // Add recency age indicators
  if (optionsTimestamp) {
    context.optionsAge = now - optionsTimestamp
  }
  if (openedPanelTimestamp) {
    context.openedPanelAge = now - openedPanelTimestamp
  }

  // Mark as stale if no relevant context was found within decay windows
  const hasRelevantContext = context.lastOptions || context.lastListPreview || context.lastOpenedPanel
  context.isStale = !hasRelevantContext && messages.length > 0

  // DEBUG: Log final chatContext
  void debugLog({
    component: 'ChatNavigation',
    action: 'buildChatContext_result',
    metadata: {
      lastOpenedPanel: context.lastOpenedPanel?.title ?? null,
      lastShownContentTitle: context.lastShownContent?.title ?? null,
      hasUiContext: !!uiContext,
      uiOpenDrawer: uiContext?.dashboard?.openDrawer?.title ?? null,
    },
  })

  return context
}

/**
 * Clarification question types that can be answered from chat context.
 * Per answer-from-chat-context-plan.md
 */
type ClarificationType =
  | 'what_opened'      // "what did you just open?"
  | 'what_shown'       // "what did you just show?"
  | 'what_said'        // "what did you say?"
  | 'option_count'     // "is there a third option?", "how many options?"
  | 'item_count'       // "how many items were there?"
  | 'list_items'       // "what were the items?"
  | 'repeat_options'   // "what were the options?" (similar to reshow)
  | null

/**
 * Detect if input is a clarification question that can be answered from context.
 * Returns the type of clarification or null if not a clarification question.
 */
function detectClarification(input: string): ClarificationType {
  const normalized = input.toLowerCase().trim()

  // What did you just open?
  if (/what\s+(did\s+you\s+)?(just\s+)?open(ed)?\??$/.test(normalized)) {
    return 'what_opened'
  }

  // What did you just show?
  if (/what\s+(did\s+you\s+)?(just\s+)?show(n|ed)?\??$/.test(normalized)) {
    return 'what_shown'
  }

  // What did you say?
  if (/what\s+(did\s+you\s+)?say(\s+again)?\??$/.test(normalized)) {
    return 'what_said'
  }

  // Is there a third/fourth/etc option?
  if (/is\s+there\s+(a\s+)?(third|fourth|fifth|sixth|3rd|4th|5th|6th|\d+)\s+option\??$/.test(normalized)) {
    return 'option_count'
  }

  // How many options?
  if (/how\s+many\s+options(\s+are\s+there)?\??$/.test(normalized)) {
    return 'option_count'
  }

  // How many items?
  if (/how\s+many\s+items(\s+(are|were)\s+there)?\??$/.test(normalized)) {
    return 'item_count'
  }

  // What were the items?
  if (/what\s+(were|are)\s+the\s+items\??$/.test(normalized)) {
    return 'list_items'
  }

  // What were the options? (can overlap with reshow, but we'll answer with count/list)
  if (/what\s+(were|are)\s+the\s+options\??$/.test(normalized)) {
    return 'repeat_options'
  }

  return null
}

/**
 * Get the last assistant message content from chat history.
 */
function getLastAssistantMessage(messages: ChatMessage[]): string | null {
  for (let i = messages.length - 1; i >= 0; i--) {
    if (messages[i].role === 'assistant' && messages[i].content) {
      return messages[i].content
    }
  }
  return null
}

/**
 * Parse ordinal number from clarification question (e.g., "third" → 3).
 */
function parseOrdinalFromQuestion(input: string): number | null {
  const normalized = input.toLowerCase()
  const ordinalMap: Record<string, number> = {
    'third': 3, '3rd': 3,
    'fourth': 4, '4th': 4,
    'fifth': 5, '5th': 5,
    'sixth': 6, '6th': 6,
    'seventh': 7, '7th': 7,
    'eighth': 8, '8th': 8,
    'ninth': 9, '9th': 9,
    'tenth': 10, '10th': 10,
  }

  for (const [word, num] of Object.entries(ordinalMap)) {
    if (normalized.includes(word)) {
      return num
    }
  }

  // Check for numeric (e.g., "is there a 5 option")
  const numMatch = normalized.match(/(\d+)\s*option/)
  if (numMatch) {
    return parseInt(numMatch[1], 10)
  }

  return null
}

/**
 * Check if input contains action verbs that should skip grace window.
 * These are deliberate commands that shouldn't be intercepted.
 * Note: This is separate from hasActionVerb() in v4 routing helpers.
 */
function hasGraceSkipActionVerb(input: string): boolean {
  const actionVerbs = [
    // Destructive actions
    'create', 'new', 'make', 'rename', 'delete', 'remove',
    // Navigation actions
    'go to', 'back', 'home', 'dashboard', 'list',
    // Explicit workspace commands
    'open workspace', 'show workspace', 'view workspace',
  ]
  const normalized = input.toLowerCase()
  return actionVerbs.some(verb => normalized.includes(verb))
}

/**
 * Check if input is an explicit command that should bypass the pending options guard.
 * Per pending-options-explicit-command-bypass.md
 *
 * This is broader than hasActionVerb - it catches commands like "open demo widget"
 * that should not be blocked by the options guard.
 *
 * Phase 2b: verb+ordinal patterns ("open the second") are NOT explicit commands.
 * They're selection attempts that should go to LLM with pendingOptions context.
 */
function isExplicitCommand(input: string): boolean {
  const normalized = input.toLowerCase()

  // Phase 2b: If input contains ordinal/number language, treat as selection attempt
  // "open the first one", "please open the second", "can you please open the first one for me"
  // All should preserve pendingOptions even though they contain action verbs
  // This simple check replaces complex prefix pattern matching
  const hasOrdinal = /\b(first|second|third|fourth|fifth|last|[1-9])\b/i.test(normalized)
  if (hasOrdinal) {
    return false
  }

  // Action verbs that indicate a new command
  const actionVerbs = [
    'open', 'show', 'list', 'view', 'go', 'back', 'home',
    'create', 'rename', 'delete', 'remove',
  ]

  // Must have an action verb to be considered an explicit command
  return actionVerbs.some(verb => normalized.includes(verb))
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
 */
function isSelectionOnly(
  input: string,
  optionCount: number,
  optionLabels?: string[]
): { isSelection: boolean; index?: number } {
  const normalized = input.toLowerCase().trim()

  // Selection-only regex pattern - must fully match (no extra words)
  // Ordinals: first, second, third, fourth, fifth, last
  // Numbers: 1, 2, 3, 4, 5
  // Option phrases: option 1, option 2, the first one, the second one
  // Single letters: a, b, c, d, e (only when options exist)
  const selectionPattern = /^(first|second|third|fourth|fifth|last|[1-9]|option\s*[1-9]|the\s+(first|second|third|fourth|fifth|last)\s+one|[a-e])$/i

  if (!selectionPattern.test(normalized)) {
    return { isSelection: false }
  }

  // Map to 0-based index
  const ordinalMap: Record<string, number> = {
    'first': 0, '1': 0, 'option 1': 0, 'the first one': 0, 'a': 0,
    'second': 1, '2': 1, 'option 2': 1, 'the second one': 1, 'b': 1,
    'third': 2, '3': 2, 'option 3': 2, 'the third one': 2, 'c': 2,
    'fourth': 3, '4': 3, 'option 4': 3, 'the fourth one': 3, 'd': 3,
    'fifth': 4, '5': 4, 'option 5': 4, 'the fifth one': 4, 'e': 4,
  }

  // Handle "last"
  if (normalized === 'last' || normalized === 'the last one') {
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
  // e.g., "pls show the Quick Links D" contains "Quick Links D"
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

/**
 * Create a compact summary from older user messages.
 */
function summarizeUserMessages(messages: string[]): string | undefined {
  const trimmed = messages.map((m) => m.trim()).filter(Boolean)
  if (trimmed.length === 0) return undefined

  let summary = `Earlier user requests: ${trimmed.join(' | ')}`
  if (summary.length > SUMMARY_MAX_CHARS) {
    summary = `${summary.slice(0, SUMMARY_MAX_CHARS - 3)}...`
  }

  return summary
}

/**
 * Build context payload from message history.
 * Returns recent user messages and last assistant question (if any).
 * Uses DB summary if available, otherwise falls back to in-memory summary.
 */
function buildContextPayload(
  messages: ChatMessage[],
  dbSummary?: string | null
): {
  summary?: string
  recentUserMessages: string[]
  lastAssistantQuestion?: string
} {
  const allUserMessages = messages
    .filter((m) => m.role === 'user')
    .map((m) => m.content)

  // Get last N user messages
  const recentUserMessages = allUserMessages.slice(-MAX_RECENT_USER_MESSAGES)

  // Use DB summary if available, otherwise build from older in-memory messages
  let summary: string | undefined
  if (dbSummary) {
    summary = dbSummary
  } else {
    const olderUserMessages = allUserMessages.slice(0, -MAX_RECENT_USER_MESSAGES)
    summary = summarizeUserMessages(olderUserMessages)
  }

  // Check if last assistant message was a question (has options or ends with ?)
  const lastAssistant = messages.filter((m) => m.role === 'assistant').slice(-1)[0]
  const lastAssistantQuestion =
    lastAssistant && !lastAssistant.isError
      ? lastAssistant.content.trim().endsWith('?') ||
        (lastAssistant.options && lastAssistant.options.length > 0)
        ? lastAssistant.content
        : undefined
      : undefined

  return { summary, recentUserMessages, lastAssistantQuestion }
}

// =============================================================================
// Session Divider Components
// =============================================================================

function SessionDivider() {
  return (
    <div className="flex items-center gap-3 py-4 my-2">
      <div className="flex-1 h-px bg-gradient-to-r from-transparent via-zinc-400 to-transparent" />
      <div className="flex items-center gap-1.5 text-[11px] uppercase tracking-wider text-zinc-500 font-semibold bg-zinc-100 px-3 py-1 rounded-full border border-zinc-200 shadow-sm">
        <Clock className="h-3.5 w-3.5" />
        <span>Previous session</span>
      </div>
      <div className="flex-1 h-px bg-gradient-to-l from-transparent via-zinc-400 to-transparent" />
    </div>
  )
}

function DateHeader({ date, isToday }: { date: Date; isToday: boolean }) {
  const formatDate = (d: Date): string => {
    const now = new Date()
    const yesterday = new Date(now)
    yesterday.setDate(yesterday.getDate() - 1)

    if (isToday) return 'Today'
    if (d.toDateString() === yesterday.toDateString()) return 'Yesterday'

    return d.toLocaleDateString('en-US', {
      weekday: 'short',
      month: 'short',
      day: 'numeric',
      year: d.getFullYear() !== now.getFullYear() ? 'numeric' : undefined
    })
  }

  return (
    <div className="flex items-center gap-3 py-3 my-1">
      <div className="flex-1 h-px bg-zinc-200" />
      <div className={cn(
        "text-[11px] font-medium px-3 py-1 rounded-full border shadow-sm",
        isToday
          ? "text-indigo-600 bg-indigo-50 border-indigo-200"
          : "text-zinc-500 bg-zinc-50 border-zinc-200"
      )}>
        {formatDate(date)}
      </div>
      <div className="flex-1 h-px bg-zinc-200" />
    </div>
  )
}

/**
 * Check if two dates are on different days
 */
function isDifferentDay(date1: Date, date2: Date): boolean {
  return date1.toDateString() !== date2.toDateString()
}

/**
 * Check if a date is today
 */
function isToday(date: Date): boolean {
  return date.toDateString() === new Date().toDateString()
}

// =============================================================================
// Component
// =============================================================================

export function ChatNavigationPanel(props: ChatNavigationPanelProps) {
  // Wrap with ViewPanelProvider so inner component can use useViewPanel
  return (
    <ViewPanelProvider>
      <ChatNavigationPanelContent {...props} />
    </ViewPanelProvider>
  )
}

function ChatNavigationPanelContent({
  currentEntryId,
  currentWorkspaceId,
  onNavigationComplete,
  trigger,
  className,
  showTrigger = true,
  // anchorClassName is no longer used (was for Popover positioning)
  // visiblePanels and focusedPanelId are now read from context (Gap 2)
}: ChatNavigationPanelProps) {
  const [isLoading, setIsLoading] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)
  const scrollRef = useRef<HTMLDivElement>(null)
  const scrollAnchorRef = useRef<HTMLDivElement>(null)

  // Pending options for hybrid selection follow-up
  const [pendingOptions, setPendingOptions] = useState<PendingOptionState[]>([])
  const [pendingOptionsMessageId, setPendingOptionsMessageId] = useState<string | null>(null)
  // Grace window: allow one extra turn after selection to reuse options
  const [pendingOptionsGraceCount, setPendingOptionsGraceCount] = useState(0)
  // Phase 2a: Track when workspace picker is for notes-scope auto-answer
  const [notesScopeFollowUpActive, setNotesScopeFollowUpActive] = useState(false)

  // Last preview state for "show all" shortcut
  const [lastPreview, setLastPreview] = useState<LastPreviewState | null>(null)
  // Note: lastOptions state removed - now using findLastOptionsMessage(messages) as source of truth

  // View panel hook (for opening view panel with content)
  const { openPanel } = useViewPanel()

  // Use shared context for messages, input, and open state (persists across mode switches)
  const {
    messages,
    addMessage,
    clearMessages,
    input,
    setInput,
    isOpen,
    setOpen,
    sessionState,
    setLastAction,
    incrementOpenCount,
    setLastQuickLinksBadge,
    appendRequestHistory,
    // Persistence
    isLoadingHistory,
    hasMoreMessages,
    loadOlderMessages,
    conversationSummary,
    // Session divider
    initialMessageCount,
    // Panel visibility (Gap 2) - read from context instead of props
    visiblePanels,
    focusedPanelId,
    uiContext,
    // Suggestion rejection handling
    lastSuggestion,
    setLastSuggestion,
    addRejectedSuggestions,
    clearRejectedSuggestions,
    isRejectedSuggestion,
    // Clarification follow-up handling (Phase 2a)
    lastClarification,
    setLastClarification,
    // Doc retrieval conversation state (v4 plan)
    docRetrievalState,
    updateDocRetrievalState,
  } = useChatNavigationContext()

  const { executeAction, selectOption, openPanelDrawer: openPanelDrawerBase } = useChatNavigation({
    onNavigationComplete: () => {
      onNavigationComplete?.()
      setOpen(false)
    },
    // Phase 1b.1: Track panel opens from executeAction (e.g., disambiguation selection)
    onPanelDrawerOpen: (panelId, panelTitle) => {
      setLastAction({
        type: 'open_panel',
        panelId,
        panelTitle: panelTitle || panelId,
        timestamp: Date.now(),
      })
    },
  })

  // Wrapper for openPanel that also tracks the action
  const openPanelWithTracking = useCallback((content: ViewPanelContent, panelId?: string) => {
    openPanel(content)
    setLastAction({
      type: 'open_panel',
      panelTitle: content.title || 'Panel',
      panelId: panelId,
      timestamp: Date.now(),
    })
  }, [openPanel, setLastAction])

  // Wrapper for openPanelDrawer that also tracks the action
  const openPanelDrawer = useCallback((panelId: string, panelTitle?: string) => {
    openPanelDrawerBase(panelId)
    setLastAction({
      type: 'open_panel',
      panelTitle: panelTitle || panelId,
      panelId: panelId,
      timestamp: Date.now(),
    })
  }, [openPanelDrawerBase, setLastAction])

  // Auto-focus input when panel opens
  // Note: Scroll position is naturally preserved because we use CSS hiding instead of unmounting
  useEffect(() => {
    if (isOpen) {
      setTimeout(() => inputRef.current?.focus(), 100)
    }
  }, [isOpen])

  // Fetch knownTerms when panel opens (for app relevance gate)
  // Per general-doc-retrieval-routing-plan.md (v4)
  useEffect(() => {
    if (isOpen && !isKnownTermsCacheValid()) {
      void fetchKnownTerms().then(terms => {
        console.log(`[KnownTerms] Cached ${terms.size} terms for routing`)
      })
    }
  }, [isOpen])

  // Track previous message count and scroll state to detect new vs older messages
  const prevMessageCountRef = useRef(messages.length)
  const scrollHeightBeforeRef = useRef(0)
  const isLoadingOlderRef = useRef(false)

  // Capture scroll height BEFORE loading older messages
  const handleLoadOlder = useCallback(async () => {
    if (scrollRef.current) {
      scrollHeightBeforeRef.current = scrollRef.current.scrollHeight
      isLoadingOlderRef.current = true
    }
    await loadOlderMessages()
  }, [loadOlderMessages])

  // Handle scroll position after messages change
  useEffect(() => {
    const prevCount = prevMessageCountRef.current
    const currentCount = messages.length

    if (currentCount > prevCount) {
      if (isLoadingOlderRef.current) {
        // Older messages were prepended - preserve scroll position
        // Note: This is tricky with ScrollArea, but we try our best
        if (scrollRef.current) {
          const scrollHeightAfter = scrollRef.current.scrollHeight
          const addedHeight = scrollHeightAfter - scrollHeightBeforeRef.current
          scrollRef.current.scrollTop = addedHeight
        }
        isLoadingOlderRef.current = false
      } else {
        // New messages added at the end - scroll to bottom using anchor
        scrollAnchorRef.current?.scrollIntoView({ behavior: 'smooth' })
      }
    }

    prevMessageCountRef.current = currentCount
  }, [messages])

  // Handle Quick Links panel selection (from disambiguation)
  useEffect(() => {
    const handleQuickLinksSelection = async (event: CustomEvent<{ panelId: string; badge: string }>) => {
      const { badge } = event.detail

      setIsLoading(true)
      try {
        setLastQuickLinksBadge(badge)
        const entryId = currentEntryId ?? getActiveEntryContext() ?? undefined
        const workspaceId = currentWorkspaceId ?? getActiveWorkspaceContext() ?? undefined

        const response = await fetch('/api/chat/navigate', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            message: `show quick links ${badge}`,
            currentEntryId: entryId,
            currentWorkspaceId: workspaceId,
            context: { sessionState },
          }),
        })

        if (!response.ok) throw new Error('Failed to load Quick Links')

        const { resolution } = await response.json() as { resolution: IntentResolutionResult }

        // Execute the action (should open view panel)
        const result = await executeAction(resolution)

        const assistantMessage: ChatMessage = {
          id: `assistant-${Date.now()}`,
          role: 'assistant',
          content: result.message,
          timestamp: new Date(),
          isError: !result.success,
          viewPanelContent: resolution.viewPanelContent,
          previewItems: resolution.previewItems,
          totalCount: resolution.totalCount,
          drawerPanelId: resolution.panelId,
          drawerPanelTitle: resolution.panelTitle,
        }
        addMessage(assistantMessage)

        // Store lastPreview for "show all" shortcut
        if (resolution.viewPanelContent && resolution.previewItems && resolution.previewItems.length > 0) {
          setLastPreview({
            source: resolution.viewPanelContent.title || 'quick_links',
            viewPanelContent: resolution.viewPanelContent,
            totalCount: resolution.totalCount || resolution.previewItems.length,
            messageId: assistantMessage.id,
            createdAt: Date.now(),
            drawerPanelId: resolution.panelId,
            drawerPanelTitle: resolution.panelTitle,
          })
        }

        // Open view panel if content available
        if (resolution.showInViewPanel && resolution.viewPanelContent) {
          openPanelWithTracking(resolution.viewPanelContent, resolution.panelId)
        }
      } catch (error) {
        const errorMessage: ChatMessage = {
          id: `error-${Date.now()}`,
          role: 'assistant',
          content: 'Failed to load Quick Links.',
          timestamp: new Date(),
          isError: true,
        }
        addMessage(errorMessage)
      } finally {
        setIsLoading(false)
      }
    }

    window.addEventListener('chat-select-quick-links-panel', handleQuickLinksSelection as unknown as EventListener)
    return () => {
      window.removeEventListener('chat-select-quick-links-panel', handleQuickLinksSelection as unknown as EventListener)
    }
  }, [currentEntryId, currentWorkspaceId, sessionState, executeAction, addMessage, openPanelWithTracking, setLastQuickLinksBadge])

  // Handle panel write confirmation (from confirm_panel_write pill)
  useEffect(() => {
    const handlePanelWriteConfirmation = async (event: CustomEvent<{
      panelId: string
      intentName: string
      params: Record<string, unknown>
    }>) => {
      const { panelId, intentName, params } = event.detail

      setIsLoading(true)
      try {
        const entryId = currentEntryId ?? getActiveEntryContext() ?? undefined
        const workspaceId = currentWorkspaceId ?? getActiveWorkspaceContext() ?? undefined

        // Re-call the API with bypassPanelWriteConfirmation flag
        const response = await fetch('/api/chat/navigate', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            message: `execute panel intent ${intentName} on ${panelId}`,
            currentEntryId: entryId,
            currentWorkspaceId: workspaceId,
            context: {
              sessionState,
              bypassPanelWriteConfirmation: true,
              pendingPanelIntent: { panelId, intentName, params },
            },
          }),
        })

        if (!response.ok) throw new Error('Failed to execute panel action')

        const { resolution } = await response.json() as { resolution: IntentResolutionResult }

        // Execute the action
        const result = await executeAction(resolution)

        const assistantMessage: ChatMessage = {
          id: `assistant-${Date.now()}`,
          role: 'assistant',
          content: result.message,
          timestamp: new Date(),
          isError: !result.success,
        }
        addMessage(assistantMessage)

        // Open view panel if content available
        if (resolution.showInViewPanel && resolution.viewPanelContent) {
          openPanelWithTracking(resolution.viewPanelContent, resolution.panelId)
        }
      } catch (error) {
        const errorMessage: ChatMessage = {
          id: `error-${Date.now()}`,
          role: 'assistant',
          content: 'Failed to execute action.',
          timestamp: new Date(),
          isError: true,
        }
        addMessage(errorMessage)
      } finally {
        setIsLoading(false)
      }
    }

    window.addEventListener('chat-confirm-panel-write', handlePanelWriteConfirmation as unknown as EventListener)
    return () => {
      window.removeEventListener('chat-confirm-panel-write', handlePanelWriteConfirmation as unknown as EventListener)
    }
  }, [currentEntryId, currentWorkspaceId, sessionState, executeAction, addMessage, openPanelWithTracking])

  // Handle doc selection (from doc_disambiguation pill)
  // Per general-doc-retrieval-routing-plan.md: use docSlug to scope retrieval
  useEffect(() => {
    const handleDocSelection = async (event: CustomEvent<{ docSlug: string }>) => {
      const { docSlug } = event.detail

      setIsLoading(true)
      try {
        // Call retrieve API with docSlug to get the doc content
        const response = await fetch('/api/docs/retrieve', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ docSlug }),
        })

        if (!response.ok) throw new Error('Failed to retrieve document')

        const result = await response.json()

        if (result.status === 'found' && result.results?.length > 0) {
          const topResult = result.results[0]
          const headerPath = topResult.header_path || topResult.title
          const snippet = topResult.snippet || ''

          const assistantMessage: ChatMessage = {
            id: `assistant-${Date.now()}`,
            role: 'assistant',
            content: `**${headerPath}**\n\n${snippet}`,
            timestamp: new Date(),
            isError: false,
          }
          addMessage(assistantMessage)

          // Update docRetrievalState so correction/"not that" works after pill selection
          updateDocRetrievalState({
            lastDocSlug: docSlug,
            lastChunkIdsShown: topResult.chunkId ? [topResult.chunkId] : [],
          })
        } else {
          const errorMessage: ChatMessage = {
            id: `assistant-${Date.now()}`,
            role: 'assistant',
            content: 'Document not found.',
            timestamp: new Date(),
            isError: true,
          }
          addMessage(errorMessage)
        }
      } catch (error) {
        const errorMessage: ChatMessage = {
          id: `error-${Date.now()}`,
          role: 'assistant',
          content: 'Failed to load documentation.',
          timestamp: new Date(),
          isError: true,
        }
        addMessage(errorMessage)
      } finally {
        setIsLoading(false)
      }
    }

    window.addEventListener('chat-select-doc', handleDocSelection as unknown as EventListener)
    return () => {
      window.removeEventListener('chat-select-doc', handleDocSelection as unknown as EventListener)
    }
  }, [addMessage])

  // ---------------------------------------------------------------------------
  // Handle Selection (moved before sendMessage for hybrid selection)
  // ---------------------------------------------------------------------------

  const handleSelectOption = useCallback(
    async (option: SelectionOption) => {
      setIsLoading(true)

      // V5 Metrics: Track pill-click resolution before clearing lastClarification
      if (lastClarification?.type === 'doc_disambiguation') {
        void debugLog({
          component: 'ChatNavigation',
          action: 'pill_click_selection',
          metadata: { selectedLabel: option.label, optionType: option.type },
          metrics: {
            event: 'clarification_resolved',
            selectedLabel: option.label,
            timestamp: Date.now(),
          },
        })
      }

      // Per options-visible-clarification-sync-plan.md: clear lastClarification when option is selected
      // The clarification is resolved once user makes a selection
      setLastClarification(null)

      try {
        // Check if this is a pending delete selection (disambiguation for delete)
        const workspaceData = option.data as WorkspaceMatch & { pendingDelete?: boolean }
        const isPendingDelete = option.type === 'workspace' && workspaceData.pendingDelete

        if (option.type === 'quick_links_panel') {
          const panelData = option.data as { badge?: string }
          if (panelData.badge) {
            setLastQuickLinksBadge(panelData.badge)
          }
        }

        const result = await selectOption({
          type: option.type,
          id: option.id,
          data: option.data,
        })

        // Note: Don't clear pending options here - grace window logic handles clearing.
        // This allows users to select another option within the grace window.

        // Track successful actions for session state and show toast
        if (result.success && result.action) {
          const now = Date.now()
          switch (result.action) {
            case 'navigated':
              if (option.type === 'workspace') {
                setLastAction({
                  type: 'open_workspace',
                  workspaceId: workspaceData.id,
                  workspaceName: workspaceData.name,
                  timestamp: now,
                })
                showWorkspaceOpenedToast(workspaceData.name, workspaceData.entryName)
                // Note: incrementOpenCount is NOT called here - DashboardView.handleWorkspaceSelectById
                // is the single source of truth for open counts (avoids double-counting)

                // Phase 2a: Auto-answer with open notes if this was a notes-scope follow-up
                if (notesScopeFollowUpActive) {
                  setNotesScopeFollowUpActive(false)
                  // Fetch workspace details including open notes
                  try {
                    const wsResponse = await fetch(`/api/note-workspaces/${workspaceData.id}`)
                    if (wsResponse.ok) {
                      const wsData = await wsResponse.json()
                      // openNotes is inside payload (NoteWorkspacePayload structure)
                      const openNotes = wsData.workspace?.payload?.openNotes || []

                      let notesAnswer: string
                      if (openNotes.length === 0) {
                        notesAnswer = `${workspaceData.name} has no open notes.`
                      } else if (openNotes.length === 1) {
                        // openNotes items have noteId and noteTitle properties
                        const noteName = openNotes[0].noteTitle || openNotes[0].noteId || 'Untitled'
                        notesAnswer = `${workspaceData.name} has 1 open note: ${noteName}.`
                      } else {
                        const noteNames = openNotes.map((n: { noteTitle?: string; noteId?: string }) => n.noteTitle || n.noteId || 'Untitled').join(', ')
                        notesAnswer = `${workspaceData.name} has ${openNotes.length} open notes: ${noteNames}.`
                      }

                      const autoAnswerMessage: ChatMessage = {
                        id: `assistant-${Date.now()}`,
                        role: 'assistant',
                        content: notesAnswer,
                        timestamp: new Date(),
                        isError: false,
                      }
                      addMessage(autoAnswerMessage)
                      setIsLoading(false)
                      return // Skip the default result message
                    }
                  } catch (fetchError) {
                    console.error('[ChatNavigation] Failed to fetch workspace for notes auto-answer:', fetchError)
                    // Fall through to default message
                  }
                }
              } else if (option.type === 'entry') {
                const entryData = option.data as { id?: string; name?: string }
                if (entryData.id && entryData.name) {
                  setLastAction({
                    type: 'open_entry',
                    entryId: entryData.id,
                    entryName: entryData.name,
                    timestamp: now,
                  })
                  showEntryOpenedToast(entryData.name)
                  // Note: incrementOpenCount for entries is called here since chat is the navigation source
                  // (unlike workspaces which are tracked in DashboardView)
                  incrementOpenCount(entryData.id, entryData.name, 'entry')
                }
              }
              break
            case 'deleted':
              if (option.type === 'confirm_delete') {
                setLastAction({
                  type: 'delete_workspace',
                  workspaceId: workspaceData.id,
                  workspaceName: workspaceData.name,
                  timestamp: now,
                })
                showWorkspaceDeletedToast(workspaceData.name)
              }
              break
            case 'renamed':
              const renameData = option.data as WorkspaceMatch & { pendingNewName?: string }
              if (renameData.pendingNewName) {
                setLastAction({
                  type: 'rename_workspace',
                  workspaceId: renameData.id,
                  fromName: renameData.name,
                  toName: renameData.pendingNewName,
                  timestamp: now,
                })
                showWorkspaceRenamedToast(renameData.name, renameData.pendingNewName)
              }
              break
          }
        }

        // If this was a pending delete, show confirmation pill
        const confirmationOptions: SelectionOption[] | undefined = isPendingDelete
          ? [
              {
                type: 'confirm_delete' as const,
                id: option.id,
                label: '🗑️ Confirm Delete',
                sublabel: workspaceData.name,
                data: workspaceData,
              },
            ]
          : undefined

        const assistantMessage: ChatMessage = {
          id: `assistant-${Date.now()}`,
          role: 'assistant',
          content: result.message,
          timestamp: new Date(),
          isError: !result.success,
          options: confirmationOptions,
        }
        addMessage(assistantMessage)
      } catch {
        const errorMessage: ChatMessage = {
          id: `error-${Date.now()}`,
          role: 'assistant',
          content: 'Failed to navigate. Please try again.',
          timestamp: new Date(),
          isError: true,
        }
        addMessage(errorMessage)
      } finally {
        setIsLoading(false)
      }
    },
    [selectOption, addMessage, setLastAction, setLastQuickLinksBadge, incrementOpenCount, notesScopeFollowUpActive, lastClarification]
  )

  // ---------------------------------------------------------------------------
  // Handle Suggestion Click (typo recovery)
  // ---------------------------------------------------------------------------

  /**
   * Handle suggestion button click.
   * @param suggestionLabel The command label (e.g., "Quick Links")
   * @param actionMode 'open' sends label directly, 'list' triggers preview mode
   */
  const handleSuggestionClick = useCallback(
    (suggestionLabel: string, actionMode: 'open' | 'list' = 'open') => {
      // Build the message based on action mode
      // 'list' mode adds "list ... in chat" to trigger forcePreviewMode in the API
      const message = actionMode === 'list'
        ? `list ${suggestionLabel.toLowerCase()} in chat`
        : suggestionLabel.toLowerCase()

      // Set input to suggestion and trigger send
      setInput(message)
      // Use setTimeout to ensure state is updated before triggering send
      setTimeout(() => {
        const inputEl = document.querySelector('input[placeholder*="Where would you like"]') as HTMLInputElement
        if (inputEl) {
          // Dispatch Enter key event to trigger send
          const event = new KeyboardEvent('keydown', {
            key: 'Enter',
            bubbles: true,
          })
          inputEl.dispatchEvent(event)
        }
      }, 50)
    },
    [setInput]
  )

  // ---------------------------------------------------------------------------
  // Send Message
  // ---------------------------------------------------------------------------

  const sendMessage = useCallback(async () => {
    const trimmedInput = input.trim()
    if (!trimmedInput || isLoading) return

    // Add user message
    const userMessage: ChatMessage = {
      id: `user-${Date.now()}`,
      role: 'user',
      content: trimmedInput,
      timestamp: new Date(),
    }
    addMessage(userMessage)
    setInput('')
    setIsLoading(true)

    try {
      // ---------------------------------------------------------------------------
      // Rejection Detection: Check if user is rejecting a suggestion
      // Per suggestion-rejection-handling-plan.md
      // ---------------------------------------------------------------------------
      if (lastSuggestion && isRejectionPhrase(trimmedInput)) {
        // User rejected the suggestion - clear state and respond
        const rejectedLabels = lastSuggestion.candidates.map(c => c.label)
        addRejectedSuggestions(rejectedLabels)
        setLastSuggestion(null)

        void debugLog({
          component: 'ChatNavigation',
          action: 'suggestion_rejected',
          metadata: { rejectedLabels, userInput: trimmedInput },
        })

        // Build response message - include alternatives if multiple candidates existed
        let responseContent = 'Okay — what would you like instead?'
        if (lastSuggestion.candidates.length > 1) {
          const alternativesList = lastSuggestion.candidates.map(c => c.label.toLowerCase()).join(', ')
          responseContent = `Okay — what would you like instead?\nYou can try: ${alternativesList}.`
        }

        const assistantMessage: ChatMessage = {
          id: `assistant-${Date.now()}`,
          role: 'assistant',
          content: responseContent,
          timestamp: new Date(),
          isError: false,
        }
        addMessage(assistantMessage)
        setIsLoading(false)
        return
      }

      // ---------------------------------------------------------------------------
      // Affirmation With Suggestion: Handle "yes" to confirm active suggestion
      // Per suggestion-confirm-yes-plan.md
      // ---------------------------------------------------------------------------
      if (lastSuggestion && isAffirmationPhrase(trimmedInput)) {
        const candidates = lastSuggestion.candidates

        if (candidates.length === 1) {
          // Single candidate: execute primary action directly
          const candidate = candidates[0]

          void debugLog({
            component: 'ChatNavigation',
            action: 'affirmation_confirm_single',
            metadata: { candidate: candidate.label, primaryAction: candidate.primaryAction },
          })

          // Clear suggestion state before making API call
          setLastSuggestion(null)
          clearRejectedSuggestions()

          // Build message based on primaryAction
          // 'list' needs special handling to trigger preview mode
          const confirmMessage = candidate.primaryAction === 'list'
            ? `list ${candidate.label.toLowerCase()} in chat`
            : candidate.label.toLowerCase()

          // Make API call with confirmed candidate
          const entryId = currentEntryId ?? getActiveEntryContext() ?? undefined
          const workspaceId = currentWorkspaceId ?? getActiveWorkspaceContext() ?? undefined

          try {
            const response = await fetch('/api/chat/navigate', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                message: confirmMessage,
                currentEntryId: entryId,
                currentWorkspaceId: workspaceId,
                context: {
                  sessionState,
                  visiblePanels,
                  focusedPanelId,
                },
              }),
            })

            if (!response.ok) {
              throw new Error('Failed to process confirmation')
            }

            const { resolution } = (await response.json()) as {
              resolution: IntentResolutionResult
            }

            // Execute action based on resolution
            if (resolution.action === 'open_panel_drawer' && resolution.panelId) {
              openPanelDrawer(resolution.panelId, resolution.panelTitle)
            }

            // Handle actions that return selectable options: set pendingOptions so pills render
            // Per suggestion-confirm-yes-plan.md: set pendingOptions when options are shown
            // Phase 2b: Also include 'list_workspaces' which returns workspace pills
            const hasSelectOptions = (
              resolution.action === 'select' ||
              resolution.action === 'list_workspaces'
            ) && resolution.options && resolution.options.length > 0
            if (hasSelectOptions) {
              const newPendingOptions: PendingOptionState[] = resolution.options!.map((opt, idx) => ({
                index: idx + 1,
                label: opt.label,
                sublabel: opt.sublabel,
                type: opt.type,
                id: opt.id,
                data: opt.data,
              }))
              setPendingOptions(newPendingOptions)
              setPendingOptionsMessageId(`assistant-${Date.now()}`)
              setPendingOptionsGraceCount(0)
              // Note: lastOptions state removed - now using findLastOptionsMessage() as source of truth

              // Per options-visible-clarification-sync-plan.md: sync lastClarification with options
              setLastClarification({
                type: 'option_selection',
                originalIntent: resolution.action || 'select',
                messageId: `assistant-${Date.now()}`,
                timestamp: Date.now(),
                clarificationQuestion: resolution.message || 'Which one would you like?',
                options: resolution.options!.map(opt => ({
                  id: opt.id,
                  label: opt.label,
                  sublabel: opt.sublabel,
                  type: opt.type,
                })),
                metaCount: 0,
              })
            }

            // Add assistant message (include options for 'select' action)
            const assistantMessage: ChatMessage = {
              id: `assistant-${Date.now()}`,
              role: 'assistant',
              content: resolution.message,
              timestamp: new Date(),
              isError: !resolution.success,
              options: hasSelectOptions
                ? resolution.options!.map((opt) => ({
                    type: opt.type,
                    id: opt.id,
                    label: opt.label,
                    sublabel: opt.sublabel,
                    data: opt.data,
                  }))
                : undefined,
            }
            addMessage(assistantMessage)
          } catch (error) {
            const assistantMessage: ChatMessage = {
              id: `assistant-${Date.now()}`,
              role: 'assistant',
              content: 'Something went wrong. Please try again.',
              timestamp: new Date(),
              isError: true,
            }
            addMessage(assistantMessage)
          }

          setIsLoading(false)
          return
        } else {
          // Multiple candidates: ask which one
          void debugLog({
            component: 'ChatNavigation',
            action: 'affirmation_multiple_candidates',
            metadata: { candidateCount: candidates.length },
          })

          const assistantMessage: ChatMessage = {
            id: `assistant-${Date.now()}`,
            role: 'assistant',
            content: 'Which one?',
            timestamp: new Date(),
            isError: false,
            // Re-display the candidates as suggestions
            suggestions: {
              type: 'choose_multiple',
              candidates: candidates,
            },
          }
          addMessage(assistantMessage)
          setIsLoading(false)
          return
        }
      }

      // ---------------------------------------------------------------------------
      // Phase 2a.3: CLARIFICATION-MODE INTERCEPT
      // When clarification is active, ALL input goes through this handler first.
      // Clarification handling runs BEFORE new-intent detection to avoid premature exit.
      // ---------------------------------------------------------------------------
      // Pattern definitions for new-intent detection (used in UNCLEAR fallback)
      const QUESTION_START_PATTERN = /^(what|which|where|when|how|why|who|is|are|do|does|did|can|could|should|would)\b/i
      const COMMAND_START_PATTERN = /^(open|show|go|list|create|close|delete|rename|back|home)\b/i
      // Per definitional-query-fix-proposal.md: bare nouns should exit clarification for doc routing
      const bareNounKnownTerms = getKnownTermsSync()
      const isBareNounNewIntent = bareNounKnownTerms
        ? isBareNounQuery(trimmedInput, uiContext, bareNounKnownTerms)
        : false
      const isNewQuestionOrCommand =
        QUESTION_START_PATTERN.test(trimmedInput) ||
        COMMAND_START_PATTERN.test(trimmedInput) ||
        trimmedInput.endsWith('?') ||
        isBareNounNewIntent  // Bare nouns should exit clarification for doc routing

      // WORKAROUND: Track if clarification was cleared within this execution cycle.
      // React's setLastClarification(null) is async - subsequent checks in the same render
      // would still see the old value. This local flag provides synchronous tracking.
      // Scoped to this sendMessage call only - doesn't persist across renders.
      // See: definitional-query-fix-proposal.md for context on this pattern.
      let clarificationCleared = false

      // Run clarification handler FIRST when clarification is active
      // Only fall back to normal routing if interpreter returns UNCLEAR AND input looks like new intent
      // Per options-visible-clarification-sync-plan.md: also enter if options exist (option_selection type)
      const hasClarificationContext = lastClarification?.nextAction || (lastClarification?.options && lastClarification.options.length > 0)
      if (!lastSuggestion && hasClarificationContext) {
        void debugLog({
          component: 'ChatNavigation',
          action: 'clarification_mode_intercept',
          metadata: {
            userInput: trimmedInput,
            nextAction: lastClarification?.nextAction,
            hasOptions: !!(lastClarification?.options?.length),
            clarificationType: lastClarification?.type,
          },
        })

        // Helper: Execute nextAction (show workspace picker for notes_scope)
        const executeNextAction = async () => {
          // Clear clarification state
          setLastClarification(null)

          // Fetch workspaces for current entry (priority: entry workspaces → recent → all)
          try {
            const workspacesUrl = currentEntryId
              ? `/api/dashboard/workspaces/search?entryId=${currentEntryId}&limit=10`
              : `/api/dashboard/workspaces/search?limit=10`
            const workspacesResponse = await fetch(workspacesUrl)
            if (!workspacesResponse.ok) {
              throw new Error('Failed to fetch workspaces')
            }
            const workspacesData = await workspacesResponse.json()
            const workspaces = workspacesData.workspaces || []

            if (workspaces.length === 0) {
              const noWorkspacesMessage: ChatMessage = {
                id: `assistant-${Date.now()}`,
                role: 'assistant',
                content: 'No workspaces found. Create a workspace first to view open notes.',
                timestamp: new Date(),
                isError: false,
              }
              addMessage(noWorkspacesMessage)
              return
            }

            // Present workspace options as pills
            const messageId = `assistant-${Date.now()}`
            const workspaceOptions: SelectionOption[] = workspaces.map((ws: { id: string; name: string; isDefault?: boolean; noteCount?: number; entryName?: string }) => ({
              type: 'workspace' as const,
              id: ws.id,
              label: ws.isDefault ? `${ws.name} (Default)` : ws.name,
              sublabel: ws.entryName || `${ws.noteCount || 0} notes`,
              data: ws,
            }))

            const workspacePickerMessage: ChatMessage = {
              id: messageId,
              role: 'assistant',
              content: 'Sure — which workspace?',
              timestamp: new Date(),
              isError: false,
              options: workspaceOptions,
            }
            addMessage(workspacePickerMessage)

            // Set pending options for selection handling
            setPendingOptions(workspaceOptions.map((opt, idx) => ({
              index: idx + 1,
              ...opt,
            })) as PendingOptionState[])
            setPendingOptionsMessageId(messageId)
            setPendingOptionsGraceCount(0)
            setNotesScopeFollowUpActive(true)

            // Per options-visible-clarification-sync-plan.md: sync lastClarification with options
            // This enables META responses like "what is that?" to explain the options
            setLastClarification({
              type: 'option_selection',
              originalIntent: 'list_open_notes',
              messageId,
              timestamp: Date.now(),
              clarificationQuestion: 'Sure — which workspace?',
              options: workspaceOptions.map(opt => ({
                id: opt.id,
                label: opt.label,
                sublabel: opt.sublabel,
                type: opt.type,
              })),
              metaCount: 0,
            })
          } catch (error) {
            console.error('[ChatNavigation] Failed to fetch workspaces for clarification:', error)
            const errorMessage: ChatMessage = {
              id: `assistant-${Date.now()}`,
              role: 'assistant',
              content: 'Sorry, I couldn\'t load workspaces. Please try again.',
              timestamp: new Date(),
              isError: true,
            }
            addMessage(errorMessage)
          }
        }

        // Helper: Handle rejection/cancel (clear clarification and pending options)
        // Per clarification-exit-and-cancel-fix-plan.md
        const handleRejection = () => {
          setLastClarification(null)
          // Also clear pending options since user is canceling the selection
          setPendingOptions([])
          setPendingOptionsMessageId(null)
          setPendingOptionsGraceCount(0)
          const cancelMessage: ChatMessage = {
            id: `assistant-${Date.now()}`,
            role: 'assistant',
            content: 'Okay — let me know what you want to do.',
            timestamp: new Date(),
            isError: false,
          }
          addMessage(cancelMessage)
        }

        // Helper: Handle unclear response
        // Returns true if we should fall through to normal routing, false if handled here
        const handleUnclear = (): boolean => {
          // If input looks like a new question/command, exit clarification and route normally
          if (isNewQuestionOrCommand) {
            void debugLog({
              component: 'ChatNavigation',
              action: 'clarification_exit_unclear_new_intent',
              metadata: { userInput: trimmedInput },
            })
            setLastClarification(null)
            return true  // Fall through to normal routing
          }
          // Otherwise re-ask clarification
          const reaskMessage: ChatMessage = {
            id: `assistant-${Date.now()}`,
            role: 'assistant',
            content: 'I didn\'t quite catch that. Would you like to open a workspace to see your notes? (yes/no)',
            timestamp: new Date(),
            isError: false,
          }
          addMessage(reaskMessage)
          return false  // Handled here, don't fall through
        }

        // Helper: Handle META response (explanation request)
        // Per clarification-meta-response-plan.md
        const handleMeta = () => {
          const currentMetaCount = lastClarification.metaCount ?? 0
          const META_LOOP_LIMIT = 2

          void debugLog({
            component: 'ChatNavigation',
            action: 'clarification_meta_response',
            metadata: { userInput: trimmedInput, metaCount: currentMetaCount },
          })

          // Check if we've hit the META loop limit
          if (currentMetaCount >= META_LOOP_LIMIT) {
            // Escape hatch: offer to skip or show options
            const escapeMessage: ChatMessage = {
              id: `assistant-${Date.now()}`,
              role: 'assistant',
              content: 'I can show both options, or we can skip this for now. What would you like?',
              timestamp: new Date(),
              isError: false,
            }
            addMessage(escapeMessage)
            // DON'T clear clarification - keep it active so "skip"/"no" can be handled by rejection check
            // Reset metaCount to prevent immediate re-escape on next META phrase
            setLastClarification({
              ...lastClarification,
              metaCount: 0,
            })
            return
          }

          // Generate explanation based on clarification type
          // Per options-visible-clarification-sync-plan.md: handle option_selection with options list
          let explanation: string
          let messageOptions: typeof lastClarification.options | undefined

          if (lastClarification.options && lastClarification.options.length > 0) {
            // Multi-choice clarification: list the options
            const optionsList = lastClarification.options
              .map((opt, i) => `${i + 1}. ${opt.label}${opt.sublabel ? ` (${opt.sublabel})` : ''}`)
              .join('\n')
            explanation = `Here are your options:\n${optionsList}\n\nJust say a number or name to select one.`
            // Re-show the option pills
            messageOptions = lastClarification.options
          } else if (lastClarification.type === 'notes_scope') {
            explanation = 'I\'m asking because notes are organized within workspaces. To show which notes are open, I need to know which workspace to check. Would you like to pick a workspace? (yes/no)'
          } else {
            // Generic fallback
            explanation = `I'm asking: ${lastClarification.clarificationQuestion ?? 'Would you like to proceed?'} (yes/no)`
          }

          const metaMessage: ChatMessage = {
            id: `assistant-${Date.now()}`,
            role: 'assistant',
            content: explanation,
            timestamp: new Date(),
            isError: false,
            // Re-show options as pills if this is a multi-choice clarification
            options: messageOptions ? messageOptions.map(opt => ({
              type: opt.type as SelectionOption['type'],
              id: opt.id,
              label: opt.label,
              sublabel: opt.sublabel,
              data: {} as SelectionOption['data'],  // Minimal data - selection will use pendingOptions
            })) : undefined,
          }
          addMessage(metaMessage)

          // Update META count in clarification state
          setLastClarification({
            ...lastClarification,
            metaCount: currentMetaCount + 1,
          })
        }

        // Tier 1: Local affirmation check
        // Per options-visible-clarification-sync-plan.md: skip affirmation if multi-choice (options exist)
        // User must select an option, not just say "yes"
        const hasMultipleOptions = lastClarification.options && lastClarification.options.length > 0
        if (isAffirmationPhrase(trimmedInput) && !hasMultipleOptions) {
          void debugLog({
            component: 'ChatNavigation',
            action: 'clarification_tier1_affirmation',
            metadata: { userInput: trimmedInput },
          })
          await executeNextAction()
          setIsLoading(false)
          return
        }

        // Tier 1b: Local rejection check
        if (isRejectionPhrase(trimmedInput)) {
          void debugLog({
            component: 'ChatNavigation',
            action: 'clarification_tier1_rejection',
            metadata: { userInput: trimmedInput },
          })
          handleRejection()
          setIsLoading(false)
          return
        }

        // Tier 1b.5: New intent escape - exit clarification for new questions/commands
        // Per clarification-exit-and-cancel-fix-plan.md: "where am I?" should route normally
        // Per definitional-query-fix-proposal.md: bare nouns should also exit clarification
        if (isNewQuestionOrCommand) {
          void debugLog({
            component: 'ChatNavigation',
            action: 'clarification_exit_new_intent',
            metadata: { userInput: trimmedInput, isBareNounNewIntent },
          })
          // Clear clarification state and fall through to normal routing
          setLastClarification(null)
          clarificationCleared = true  // Mark as cleared for later checks in same render (React state is async)
          // Don't return - continue to normal routing below
        }

        // Tier 1c: Local META check (explanation request)
        // Per clarification-meta-response-plan.md
        // Only check if we didn't already exit via new intent
        if (lastClarification && !clarificationCleared && isMetaPhrase(trimmedInput)) {
          void debugLog({
            component: 'ChatNavigation',
            action: 'clarification_tier1_meta',
            metadata: { userInput: trimmedInput },
          })
          handleMeta()
          setIsLoading(false)
          return
        }

        // Tier 2: LLM interpretation for unclear responses
        // Call API with clarification-mode flag to get YES/NO/META/UNCLEAR interpretation
        // Skip if we already exited via new intent (clarificationCleared = true)
        if (lastClarification && !clarificationCleared) {
          void debugLog({
            component: 'ChatNavigation',
            action: 'clarification_tier2_llm',
            metadata: { userInput: trimmedInput },
          })

          try {
            const interpretResponse = await fetch('/api/chat/navigate', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                message: trimmedInput,
                clarificationMode: true,  // Special flag for clarification interpretation
                clarificationQuestion: 'Would you like to open a workspace to see your notes?',
              }),
            })

            if (interpretResponse.ok) {
              const interpretResult = await interpretResponse.json()
              const interpretation = interpretResult.clarificationInterpretation

              void debugLog({
                component: 'ChatNavigation',
                action: 'clarification_tier2_result',
                metadata: { interpretation },
              })

              if (interpretation === 'YES') {
                await executeNextAction()
                setIsLoading(false)
                return
              } else if (interpretation === 'NO') {
                handleRejection()
                setIsLoading(false)
                return
              } else if (interpretation === 'META') {
                // META: User wants explanation - handle via handleMeta
                handleMeta()
                setIsLoading(false)
                return
              } else {
                // UNCLEAR or missing - check if we should fall through to normal routing
                if (!handleUnclear()) {
                  setIsLoading(false)
                  return
                }
                // handleUnclear returned true - fall through to normal routing below
              }
            } else {
              // API error - treat as unclear
              if (!handleUnclear()) {
                setIsLoading(false)
                return
              }
              // handleUnclear returned true - fall through to normal routing below
            }
          } catch (error) {
            console.error('[ChatNavigation] Clarification interpretation failed:', error)
            if (!handleUnclear()) {
              setIsLoading(false)
              return
            }
            // handleUnclear returned true - fall through to normal routing below
          }
        }
        // If we reach here, either:
        // - New intent was detected (lastClarification cleared, skip Tier 2)
        // - handleUnclear returned true - continue to normal routing
      }

      // ---------------------------------------------------------------------------
      // Meta-Explain Outside Clarification: Handle "explain", "what do you mean?"
      // Per meta-explain-outside-clarification-plan.md (Tiered Plan)
      // Tier 1: Local cache for common concepts
      // Tier 2: Database retrieval for long tail
      // NOTE: Skip if there's active docRetrievalState AND input is a follow-up cue
      //       (let v4 pronoun follow-up handler take over instead)
      // ---------------------------------------------------------------------------
      const shouldDeferToV4FollowUp = docRetrievalState?.lastDocSlug && isPronounFollowUp(trimmedInput)
      if ((!lastClarification || clarificationCleared) && isMetaExplainOutsideClarification(trimmedInput) && !shouldDeferToV4FollowUp) {
        void debugLog({
          component: 'ChatNavigation',
          action: 'meta_explain_outside_clarification',
          metadata: { userInput: trimmedInput },
        })

        try {
          // Extract specific concept or use last assistant message context
          const concept = extractMetaExplainConcept(trimmedInput)
          let queryTerm = concept

          // If no specific concept, try to infer from last assistant message
          if (!queryTerm) {
            const lastAssistant = [...messages].reverse().find(m => m.role === 'assistant')
            if (lastAssistant?.content) {
              // Extract key terms from last answer (e.g., "dashboard of Home" → "home")
              const contentLower = lastAssistant.content.toLowerCase()
              if (contentLower.includes('dashboard') && contentLower.includes('home')) {
                queryTerm = 'home'
              } else if (contentLower.includes('workspace')) {
                queryTerm = 'workspace'
              } else if (contentLower.includes('recent')) {
                queryTerm = 'recent'
              } else if (contentLower.includes('quick links')) {
                queryTerm = 'quick links'
              } else if (contentLower.includes('navigator')) {
                queryTerm = 'navigator'
              } else if (contentLower.includes('panel') || contentLower.includes('drawer')) {
                queryTerm = 'drawer'
              }
            }
          }

          // Step 3: Detect definitional query for concept preference
          // Per definitional-query-fix-proposal.md: "what is X" should prefer concepts/* over actions/*
          const isDefinitionalPattern = !!concept  // concept is non-null for "what is X", "explain X" patterns
          const hasActionIntent = isDefinitionalPattern
            ? /\b(action|actions|create|delete|rename|list|open)\b/i.test(trimmedInput)
            : false
          const isDefinitionalQuery = isDefinitionalPattern && !hasActionIntent

          // Call retrieval API
          const retrieveResponse = await fetch('/api/docs/retrieve', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              query: queryTerm || trimmedInput,
              mode: 'explain',
              isDefinitionalQuery,  // Step 3: hint for backend to prefer concepts
            }),
          })

          if (retrieveResponse.ok) {
            const result = await retrieveResponse.json()

            // Per definitional-query-fix-proposal.md: Check for ambiguous status (Step 1 cross-doc override)
            // If ambiguous, show pills for doc selection instead of just text clarification
            if (result.status === 'ambiguous' && result.options?.length >= 2) {
              const messageId = `assistant-${Date.now()}`
              const options: SelectionOption[] = result.options.slice(0, 2).map((opt: { docSlug: string; label: string; title: string }, idx: number) => ({
                type: 'doc' as const,
                id: opt.docSlug,
                label: opt.label || opt.title,
                sublabel: opt.title !== opt.label ? opt.title : undefined,
                data: { docSlug: opt.docSlug },
              }))

              const assistantMessage: ChatMessage = {
                id: messageId,
                role: 'assistant',
                content: result.explanation || `Do you mean "${options[0].label}" or "${options[1].label}"?`,
                timestamp: new Date(),
                isError: false,
                options,
              }
              addMessage(assistantMessage)

              // Set clarification state for pill selection handling
              setPendingOptions(options.map((opt, idx) => ({
                index: idx + 1,
                label: opt.label,
                sublabel: opt.sublabel,
                type: opt.type,
                id: opt.id,
                data: opt.data,
              })))
              setPendingOptionsMessageId(messageId)

              setLastClarification({
                type: 'doc_disambiguation',
                originalIntent: 'meta_explain',
                messageId,
                timestamp: Date.now(),
                clarificationQuestion: result.explanation || 'Which one do you mean?',
                options: options.map(opt => ({
                  id: opt.id,
                  label: opt.label,
                  sublabel: opt.sublabel,
                  type: opt.type,
                })),
                metaCount: 0,
              })

              void debugLog({
                component: 'ChatNavigation',
                action: 'meta_explain_ambiguous_pills',
                metadata: { optionCount: options.length, labels: options.map(o => o.label), source: 'meta_explain' },
                metrics: {
                  event: 'clarification_shown',
                  optionCount: options.length,
                  timestamp: Date.now(),
                },
              })

              setIsLoading(false)
              return
            }

            // Non-ambiguous: show explanation text directly
            const explanation = result.explanation || 'Which part would you like me to explain?'

            const assistantMessage: ChatMessage = {
              id: `assistant-${Date.now()}`,
              role: 'assistant',
              content: explanation,
              timestamp: new Date(),
              isError: false,
            }
            addMessage(assistantMessage)

            // Wire meta-explain into v4 state for follow-ups and corrections
            // Per general-doc-retrieval-routing-plan.md (v4)
            // V5: Use actual docSlug from result (not query term) for accurate follow-ups
            const metaQueryTerm = queryTerm || trimmedInput
            const { tokens: metaTokens } = normalizeInputForRouting(metaQueryTerm)
            updateDocRetrievalState({
              lastDocSlug: result.docSlug || metaQueryTerm, // V5: Prefer actual slug, fallback to query
              lastTopicTokens: metaTokens,
              lastMode: 'doc',
              lastChunkIdsShown: result.chunkId ? [result.chunkId] : [], // V5: Track shown chunk
            })

            setIsLoading(false)
            return
          }
        } catch (error) {
          console.error('[ChatNavigation] Meta-explain retrieval error:', error)
        }

        // Fallback if retrieval fails
        const fallbackMessage: ChatMessage = {
          id: `assistant-${Date.now()}`,
          role: 'assistant',
          content: 'Which part would you like me to explain?',
          timestamp: new Date(),
          isError: false,
        }
        addMessage(fallbackMessage)
        setIsLoading(false)
        return
      }

      // ---------------------------------------------------------------------------
      // V4 Correction Handling: "no / not that" after doc retrieval
      // Per general-doc-retrieval-routing-plan.md (v4)
      // ---------------------------------------------------------------------------
      if (docRetrievalState?.lastDocSlug && isCorrectionPhrase(trimmedInput)) {
        void debugLog({
          component: 'ChatNavigation',
          action: 'doc_correction',
          metadata: { userInput: trimmedInput, lastDocSlug: docRetrievalState.lastDocSlug },
          // V5 Metrics: Track correction rate
          metrics: {
            event: 'correction_triggered',
            docSlug: docRetrievalState.lastDocSlug,
            correctionPhrase: trimmedInput,
            timestamp: Date.now(),
          },
        })

        // Acknowledge correction and re-run retrieval with lastTopicTokens
        const correctionMessage: ChatMessage = {
          id: `assistant-${Date.now()}`,
          role: 'assistant',
          content: "Got it — let's try again. Which topic were you asking about?",
          timestamp: new Date(),
          isError: false,
        }
        addMessage(correctionMessage)

        // Clear doc retrieval state to allow fresh query
        updateDocRetrievalState({ lastDocSlug: undefined, lastTopicTokens: undefined })
        setIsLoading(false)
        return
      }

      // ---------------------------------------------------------------------------
      // V5 Pronoun Follow-up: "tell me more" with HS2 expansion
      // Per general-doc-retrieval-routing-plan.md (v5)
      // Uses excludeChunkIds to avoid repeating already-shown content
      // ---------------------------------------------------------------------------

      // Check for deterministic follow-up first
      let isFollowUp = isPronounFollowUp(trimmedInput)

      // V5 Follow-up-miss backup: If lastDocSlug is set but deterministic check missed,
      // call classifier as backup BEFORE falling to LLM routing
      // Per plan (line 315): "If follow-up detection misses but lastDocSlug is set,
      // call the semantic classifier as a backup before falling back to LLM"
      // FIX: Skip classifier for new questions/commands - they are clearly new intents, not follow-ups
      // e.g., "can you tell me what are the workspaces actions?" should NOT be scoped to previous doc
      if (docRetrievalState?.lastDocSlug && !isFollowUp && !isNewQuestionOrCommand) {
        try {
          const classifyResponse = await fetch('/api/chat/classify-followup', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              userMessage: trimmedInput,
              lastDocSlug: docRetrievalState.lastDocSlug,
              lastTopicTokens: docRetrievalState.lastTopicTokens,
            }),
          })
          const classifyResult = await classifyResponse.json()

          if (classifyResult.isFollowUp) {
            isFollowUp = true
            void debugLog({
              component: 'ChatNavigation',
              action: 'followup_classifier_backup',
              metadata: {
                userInput: trimmedInput,
                lastDocSlug: docRetrievalState.lastDocSlug,
                latencyMs: classifyResult.latencyMs,
              },
              metrics: {
                event: 'classifier_followup_detected',
                docSlug: docRetrievalState.lastDocSlug,
                timestamp: Date.now(),
              },
            })
          }
        } catch (error) {
          console.error('[ChatNavigation] Follow-up classifier backup error:', error)
          // Continue without classifier result - fall through to normal routing
        }
      }

      if (docRetrievalState?.lastDocSlug && isFollowUp) {
        const excludeChunkIds = docRetrievalState.lastChunkIdsShown || []

        void debugLog({
          component: 'ChatNavigation',
          action: 'doc_followup_v5',
          metadata: {
            userInput: trimmedInput,
            lastDocSlug: docRetrievalState.lastDocSlug,
            excludeChunkIds,
          },
          // V5 Metrics: Track follow-up expansion
          metrics: {
            event: 'followup_expansion',
            docSlug: docRetrievalState.lastDocSlug,
            excludedChunks: excludeChunkIds.length,
            timestamp: Date.now(),
          },
        })

        try {
          // V5 HS2: Use mode='chunks' with excludeChunkIds for same-doc expansion
          let retrieveResponse = await fetch('/api/docs/retrieve', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              mode: 'chunks',
              query: docRetrievalState.lastDocSlug,
              scopeDocSlug: docRetrievalState.lastDocSlug,
              excludeChunkIds,
            }),
          })

          let result = retrieveResponse.ok ? await retrieveResponse.json() : null

          // If scoped retrieval fails, try query-based without scope but still use chunks mode
          // to ensure v5 fields (isHeadingOnly, bodyCharCount) are present for quality filtering
          if (!result || result.status === 'no_match' || !result.results?.length) {
            retrieveResponse = await fetch('/api/docs/retrieve', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                mode: 'chunks',
                query: docRetrievalState.lastDocSlug,
                excludeChunkIds,
              }),
            })
            result = retrieveResponse.ok ? await retrieveResponse.json() : null
          }

          if (result && (result.status === 'found' || result.status === 'weak') && result.results?.length > 0) {
            // V5 HS2: Find first non-heading-only chunk (quality filter)
            let selectedResult = null
            for (const chunk of result.results) {
              if (!isLowQualitySnippet(chunk.snippet, chunk.isHeadingOnly, chunk.bodyCharCount)) {
                selectedResult = chunk
                break
              }
            }

            // If all results are low quality, use first one anyway
            if (!selectedResult) {
              selectedResult = result.results[0]
              console.log('[DocRetrieval:HS2] All follow-up chunks are low quality, using first')
            }

            const snippet = selectedResult.snippet || selectedResult.content?.slice(0, 500) || ''
            const newChunkId = selectedResult.chunkId

            // Check if we actually have new content
            if (snippet.length > 0) {
              const assistantMessage: ChatMessage = {
                id: `assistant-${Date.now()}`,
                role: 'assistant',
                content: snippet + (snippet.length >= 500 ? '...' : ''),
                timestamp: new Date(),
                isError: false,
              }
              addMessage(assistantMessage)

              // V5: Update lastChunkIdsShown to include newly shown chunk
              if (newChunkId) {
                updateDocRetrievalState({
                  lastChunkIdsShown: [...excludeChunkIds, newChunkId],
                })
              }

              setIsLoading(false)
              return
            }
          }

          // No more content in this doc - inform user
          const exhaustedMessage: ChatMessage = {
            id: `assistant-${Date.now()}`,
            role: 'assistant',
            content: "That's all I have on this topic. What else would you like to know?",
            timestamp: new Date(),
            isError: false,
          }
          addMessage(exhaustedMessage)
          setIsLoading(false)
          return
        } catch (error) {
          console.error('[ChatNavigation] Doc follow-up error:', error)
        }

        // Fallback if follow-up fails
        const fallbackMessage: ChatMessage = {
          id: `assistant-${Date.now()}`,
          role: 'assistant',
          content: "I don't have more details on that. What else would you like to know?",
          timestamp: new Date(),
          isError: false,
        }
        addMessage(fallbackMessage)
        setIsLoading(false)
        return
      }

      // ---------------------------------------------------------------------------
      // General Doc Retrieval Routing: Handle "what is X", "how do I X" queries
      // AND bare nouns like "notes", "widgets" (not action nouns like "recent")
      // Per general-doc-retrieval-routing-plan.md (v4)
      // Routes doc-style questions through retrieval for grounded answers.
      // ---------------------------------------------------------------------------

      // Get knownTerms for app relevance gate (use cached if available)
      const knownTerms = getKnownTermsSync()

      // Use the main routing function
      const docRoute = routeDocInput(trimmedInput, uiContext, knownTerms ?? undefined)
      const isDocStyle = docRoute === 'doc'
      const isBareNoun = docRoute === 'bare_noun'

      // Log routing decision for metrics
      void debugLog({
        component: 'ChatNavigation',
        action: 'doc_routing_decision',
        metadata: {
          userInput: trimmedInput,
          route: docRoute,
          hasKnownTerms: !!knownTerms,
          knownTermsSize: knownTerms?.size ?? 0,
        },
      })

      if ((!lastClarification || clarificationCleared) && (isDocStyle || isBareNoun)) {
        void debugLog({
          component: 'ChatNavigation',
          action: 'general_doc_retrieval',
          metadata: { userInput: trimmedInput, isDocStyle, isBareNoun, route: docRoute },
        })

        try {
          // For doc-style queries, extract the term; for bare nouns, use as-is
          const queryTerm = isDocStyle ? extractDocQueryTerm(trimmedInput) : trimmedInput.trim().toLowerCase()
          const { tokens: queryTokens } = normalizeInputForRouting(queryTerm)

          // Get response style for formatting
          const responseStyle = getResponseStyle(trimmedInput)

          // Call retrieval API
          const retrieveResponse = await fetch('/api/docs/retrieve', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              query: queryTerm,
            }),
          })

          if (retrieveResponse.ok) {
            const result = await retrieveResponse.json()

            // Log retrieval metrics
            console.log(`[DocRetrieval] query="${queryTerm}" status=${result.status} ` +
              `confidence=${result.confidence?.toFixed(2) ?? 'N/A'} ` +
              `resultsCount=${result.results?.length ?? 0}`)

            // Handle different response statuses
            if (result.status === 'found' && result.results?.length > 0) {
              // Strong match - answer from docs
              const topResult = result.results[0]
              let rawSnippet = topResult.snippet || topResult.content?.slice(0, 300) || ''
              let chunkIdsShown: string[] = topResult.chunkId ? [topResult.chunkId] : []

              // V5 HS1: Snippet Quality Guard
              // Check if snippet is low quality (heading-only or too short)
              if (isLowQualitySnippet(rawSnippet, topResult.isHeadingOnly, topResult.bodyCharCount)) {
                console.log(`[DocRetrieval:HS1] Low quality snippet detected for ${topResult.doc_slug}, attempting upgrade`)

                // Attempt to upgrade with next chunk or fallback search
                const upgraded = await attemptSnippetUpgrade(topResult.doc_slug, chunkIdsShown)
                if (upgraded) {
                  rawSnippet = upgraded.snippet
                  chunkIdsShown = [...chunkIdsShown, ...upgraded.chunkIds]
                  console.log(`[DocRetrieval:HS1] Snippet upgraded successfully`)

                  // V5 Metrics: Track successful snippet upgrade
                  void debugLog({
                    component: 'ChatNavigation',
                    action: 'hs1_snippet_upgrade',
                    metadata: { docSlug: topResult.doc_slug, upgradeSuccess: true },
                    metrics: {
                      event: 'snippet_quality_upgrade',
                      docSlug: topResult.doc_slug,
                      upgradeAttempted: true,
                      upgradeSuccess: true,
                      bodyCharCount: topResult.bodyCharCount,
                      timestamp: Date.now(),
                    },
                  })
                } else {
                  // If upgrade failed, try to use next result if available
                  let alternateUsed = false
                  for (let i = 1; i < result.results.length; i++) {
                    const altResult = result.results[i]
                    if (!isLowQualitySnippet(altResult.snippet, altResult.isHeadingOnly, altResult.bodyCharCount)) {
                      rawSnippet = altResult.snippet
                      chunkIdsShown = altResult.chunkId ? [altResult.chunkId] : []
                      console.log(`[DocRetrieval:HS1] Using alternate result ${i}`)
                      alternateUsed = true
                      break
                    }
                  }

                  // V5 Metrics: Track failed snippet upgrade
                  void debugLog({
                    component: 'ChatNavigation',
                    action: 'hs1_snippet_upgrade',
                    metadata: { docSlug: topResult.doc_slug, upgradeSuccess: false, alternateUsed },
                    metrics: {
                      event: 'snippet_quality_upgrade',
                      docSlug: topResult.doc_slug,
                      upgradeAttempted: true,
                      upgradeSuccess: alternateUsed,
                      bodyCharCount: topResult.bodyCharCount,
                      timestamp: Date.now(),
                    },
                  })
                }
              }

              // Apply response policy: format based on user input style
              const formattedSnippet = formatSnippet(rawSnippet, responseStyle)
              const hasMoreContent = rawSnippet.length > formattedSnippet.length
              const nextStepOffer = getNextStepOffer(responseStyle, hasMoreContent)

              const assistantMessage: ChatMessage = {
                id: `assistant-${Date.now()}`,
                role: 'assistant',
                content: formattedSnippet + nextStepOffer,
                timestamp: new Date(),
                isError: false,
              }
              addMessage(assistantMessage)

              // Update conversation state for follow-ups (V5: track shown chunk IDs)
              updateDocRetrievalState({
                lastDocSlug: topResult.doc_slug,
                lastTopicTokens: queryTokens,
                lastMode: isDocStyle ? 'doc' : 'bare_noun',
                lastChunkIdsShown: chunkIdsShown,
              })

              setIsLoading(false)
              return
            }

            if (result.status === 'weak' && result.results?.length > 0) {
              // Weak match - show best guess with confirmation
              const topResult = result.results[0]
              const headerPath = topResult.header_path || topResult.title
              const assistantMessage: ChatMessage = {
                id: `assistant-${Date.now()}`,
                role: 'assistant',
                content: result.clarification || `I think you mean "${headerPath}". Is that right?`,
                timestamp: new Date(),
                isError: false,
              }
              addMessage(assistantMessage)

              // Update state for potential follow-up
              updateDocRetrievalState({
                lastDocSlug: topResult.doc_slug,
                lastTopicTokens: queryTokens,
                lastMode: isDocStyle ? 'doc' : 'bare_noun',
              })

              setIsLoading(false)
              return
            }

            if (result.status === 'ambiguous' && result.results?.length >= 2) {
              // Ambiguous - show options as pills
              const messageId = `assistant-${Date.now()}`
              const options: SelectionOption[] = result.results.slice(0, 2).map((r: { doc_slug: string; header_path?: string; title: string; category: string }, idx: number) => ({
                type: 'doc' as const,
                id: r.doc_slug,
                label: r.header_path || r.title,
                sublabel: r.category,
                data: { docSlug: r.doc_slug },
              }))

              const assistantMessage: ChatMessage = {
                id: messageId,
                role: 'assistant',
                content: result.clarification || `Do you mean "${options[0].label}" or "${options[1].label}"?`,
                timestamp: new Date(),
                isError: false,
                options,
              }
              addMessage(assistantMessage)

              // Set clarification state for selection handling
              setPendingOptions(options.map((opt, idx) => ({
                index: idx + 1,
                label: opt.label,
                sublabel: opt.sublabel,
                type: opt.type,
                id: opt.id,
                data: opt.data,
              })))
              setPendingOptionsMessageId(messageId)

              setLastClarification({
                type: 'doc_disambiguation',
                originalIntent: 'general_doc_retrieval',
                messageId,
                timestamp: Date.now(),
                clarificationQuestion: result.clarification || 'Which one do you mean?',
                options: options.map(opt => ({
                  id: opt.id,
                  label: opt.label,
                  sublabel: opt.sublabel,
                  type: opt.type,
                })),
                metaCount: 0,
              })

              // V5 Metrics: Track clarification shown
              void debugLog({
                component: 'ChatNavigation',
                action: 'clarification_shown',
                metadata: { optionCount: options.length, labels: options.map(o => o.label) },
                metrics: {
                  event: 'clarification_shown',
                  optionCount: options.length,
                  timestamp: Date.now(),
                },
              })

              // Store topic tokens for potential re-query
              updateDocRetrievalState({
                lastTopicTokens: queryTokens,
                lastMode: isDocStyle ? 'doc' : 'bare_noun',
              })

              setIsLoading(false)
              return
            }

            // No match - ask for clarification with examples
            const noMatchMessage: ChatMessage = {
              id: `assistant-${Date.now()}`,
              role: 'assistant',
              content: result.clarification || "I don't see docs for that exact term. Which feature are you asking about?\n(e.g., workspace, notes, widgets)",
              timestamp: new Date(),
              isError: false,
            }
            addMessage(noMatchMessage)

            // Clear doc state on no match
            updateDocRetrievalState({ lastDocSlug: undefined, lastTopicTokens: queryTokens })

            setIsLoading(false)
            return
          }
        } catch (error) {
          console.error('[ChatNavigation] General doc retrieval error:', error)
          // Fall through to LLM on error
        }
      }

      // ---------------------------------------------------------------------------
      // V4 LLM Route: Handle non-app queries (skip retrieval)
      // Per general-doc-retrieval-routing-plan.md (v4) - app relevance gate
      // When routeDocInput returns 'llm', the query is not app-relevant
      // ---------------------------------------------------------------------------
      if (docRoute === 'llm' && (!lastClarification || clarificationCleared)) {
        void debugLog({
          component: 'ChatNavigation',
          action: 'llm_route_non_app',
          metadata: { userInput: trimmedInput, route: docRoute },
        })

        // For non-app queries, provide a helpful redirect to app topics
        // This prevents the confusing typo fallback for queries like "quantum physics"
        const llmRouteMessage: ChatMessage = {
          id: `assistant-${Date.now()}`,
          role: 'assistant',
          content: "I'm best at helping with this app. Try asking about workspaces, notes, widgets, or navigation.",
          timestamp: new Date(),
          isError: false,
        }
        addMessage(llmRouteMessage)
        setIsLoading(false)
        return
      }

      // ---------------------------------------------------------------------------
      // Affirmation Without Context: Handle "yes" when no active suggestion
      // Per suggestion-fallback-polish-plan.md
      // ---------------------------------------------------------------------------
      if (!lastSuggestion && isAffirmationPhrase(trimmedInput)) {
        void debugLog({
          component: 'ChatNavigation',
          action: 'affirmation_without_context',
          metadata: { userInput: trimmedInput },
        })

        const assistantMessage: ChatMessage = {
          id: `assistant-${Date.now()}`,
          role: 'assistant',
          content: 'Yes to which option?',
          timestamp: new Date(),
          isError: false,
        }
        addMessage(assistantMessage)
        setIsLoading(false)
        return
      }

      // ---------------------------------------------------------------------------
      // Re-show Options: Deterministic check for re-show phrases
      // Per pending-options-message-source-plan.md - use chat messages as source of truth
      // ---------------------------------------------------------------------------
      if (matchesReshowPhrases(trimmedInput)) {
        const now = Date.now()
        // Find last options from chat messages (source of truth)
        const lastOptionsMessage = findLastOptionsMessage(messages)
        const messageAge = lastOptionsMessage ? now - lastOptionsMessage.timestamp.getTime() : null
        const isWithinGraceWindow = lastOptionsMessage && messageAge !== null && messageAge <= RESHOW_WINDOW_MS

        if (isWithinGraceWindow && lastOptionsMessage) {
          void debugLog({
            component: 'ChatNavigation',
            action: 'reshow_options_deterministic',
            metadata: { optionsCount: lastOptionsMessage.options.length, messageAgeMs: messageAge },
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
          addMessage(assistantMessage)

          // Restore pendingOptions for selection handling
          setPendingOptions(lastOptionsMessage.options)
          setPendingOptionsMessageId(messageId)
          setPendingOptionsGraceCount(0)

          // Per options-visible-clarification-sync-plan.md: sync lastClarification on re-show
          setLastClarification({
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

          setIsLoading(false)
          return
        } else {
          // Grace window expired or no prior options
          void debugLog({
            component: 'ChatNavigation',
            action: 'reshow_options_expired',
            metadata: { hasLastOptionsMessage: !!lastOptionsMessage, messageAgeMs: messageAge },
          })

          const assistantMessage: ChatMessage = {
            id: `assistant-${Date.now()}`,
            role: 'assistant',
            content: "No options are open. Say 'show quick links' to see them again.",
            timestamp: new Date(),
            isError: false,
          }
          addMessage(assistantMessage)
          setIsLoading(false)
          return
        }
      }

      // ---------------------------------------------------------------------------
      // NOTE: Local clarification handler removed per llm-chat-context-first-plan.md
      // Clarification questions now go to the LLM with ChatContext for better answers.
      // The LLM can answer "what did you just open?", "is F in the list?", etc.
      // using the chatContext passed in the API request.
      // ---------------------------------------------------------------------------

      // ---------------------------------------------------------------------------
      // Explicit Command Bypass: Clear pending options if explicit command detected
      // Per pending-options-explicit-command-bypass.md
      // ---------------------------------------------------------------------------
      if (isExplicitCommand(trimmedInput)) {
        // Check if we have pending options (either in state or in recent messages)
        const lastOptionsMessage = findLastOptionsMessage(messages)
        const hasRecentOptions = lastOptionsMessage &&
          (Date.now() - lastOptionsMessage.timestamp.getTime()) <= RESHOW_WINDOW_MS

        if (pendingOptions.length > 0 || hasRecentOptions) {
          void debugLog({
            component: 'ChatNavigation',
            action: 'explicit_command_bypass',
            metadata: {
              input: trimmedInput,
              hadPendingOptions: pendingOptions.length > 0,
              hadRecentOptions: hasRecentOptions,
            },
          })

          // Clear pending options so the command proceeds to normal routing
          setPendingOptions([])
          setPendingOptionsMessageId(null)
          setPendingOptionsGraceCount(0)
        }
        // Don't return - let the message fall through to LLM for normal processing
      }

      // ---------------------------------------------------------------------------
      // Preview Shortcut: Check for "show all" when a preview exists
      // ---------------------------------------------------------------------------
      const PREVIEW_TIMEOUT_MS = 2 * 60 * 1000 // 2 minutes
      const previewIsRecent = lastPreview && (Date.now() - lastPreview.createdAt) < PREVIEW_TIMEOUT_MS

      if (previewIsRecent && matchesShowAllHeuristic(trimmedInput)) {
        // Keyword heuristic matched - open view panel directly
        void debugLog({
          component: 'ChatNavigation',
          action: 'show_all_shortcut',
          metadata: { source: lastPreview.source, totalCount: lastPreview.totalCount, method: 'heuristic' },
        })

        if (lastPreview.drawerPanelId) {
          openPanelDrawer(lastPreview.drawerPanelId, lastPreview.drawerPanelTitle)
        } else {
          openPanelWithTracking(lastPreview.viewPanelContent, lastPreview.drawerPanelId)
        }

        const assistantMessage: ChatMessage = {
          id: `assistant-${Date.now()}`,
          role: 'assistant',
          content: `Opening full list for ${lastPreview.source}.`,
          timestamp: new Date(),
          isError: false,
        }
        addMessage(assistantMessage)
        setIsLoading(false)
        return
      }

      // Tiny LLM classifier fallback: if preview exists but heuristic didn't match,
      // ask the LLM if user wants to expand the preview
      if (previewIsRecent && !hasGraceSkipActionVerb(trimmedInput)) {
        try {
          const classifyResponse = await fetch('/api/chat/classify-expand', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              userMessage: trimmedInput,
              previewSource: lastPreview.source,
              previewCount: lastPreview.totalCount,
            }),
          })

          if (classifyResponse.ok) {
            const { expand } = await classifyResponse.json()
            if (expand) {
              void debugLog({
                component: 'ChatNavigation',
                action: 'show_all_shortcut',
                metadata: { source: lastPreview.source, totalCount: lastPreview.totalCount, method: 'classifier' },
              })

              if (lastPreview.drawerPanelId) {
                openPanelDrawer(lastPreview.drawerPanelId, lastPreview.drawerPanelTitle)
              } else {
                openPanelWithTracking(lastPreview.viewPanelContent, lastPreview.drawerPanelId)
              }

              const assistantMessage: ChatMessage = {
                id: `assistant-${Date.now()}`,
                role: 'assistant',
                content: `Opening full list for ${lastPreview.source}.`,
                timestamp: new Date(),
                isError: false,
              }
              addMessage(assistantMessage)
              setIsLoading(false)
              return
            }
          }
        } catch (classifyError) {
          // Classifier failed - continue with normal intent parsing
          void debugLog({
            component: 'ChatNavigation',
            action: 'classify_expand_error',
            metadata: { error: String(classifyError) },
          })
        }
      }

      // ---------------------------------------------------------------------------
      // Selection-Only Guard: Only intercept pure selection patterns
      // Per llm-chat-context-first-plan.md - let everything else go to LLM
      // ---------------------------------------------------------------------------
      if (pendingOptions.length > 0) {
        const optionLabels = pendingOptions.map(opt => opt.label)
        const selectionResult = isSelectionOnly(trimmedInput, pendingOptions.length, optionLabels)

        if (selectionResult.isSelection && selectionResult.index !== undefined) {
          // Pure selection pattern - handle locally for speed
          const selectedOption = pendingOptions[selectionResult.index]

          void debugLog({
            component: 'ChatNavigation',
            action: 'selection_only_guard',
            metadata: {
              input: trimmedInput,
              index: selectionResult.index,
              selectedLabel: selectedOption.label,
            },
            // V5 Metrics: Track clarification resolved
            metrics: {
              event: 'clarification_resolved',
              selectedLabel: selectedOption.label,
              timestamp: Date.now(),
            },
          })

          // Use grace window: keep options for one more turn
          setPendingOptionsGraceCount(1)

          // Execute the selection directly
          const optionToSelect: SelectionOption = {
            type: selectedOption.type as SelectionOption['type'],
            id: selectedOption.id,
            label: selectedOption.label,
            sublabel: selectedOption.sublabel,
            data: selectedOption.data as SelectionOption['data'],
          }

          setIsLoading(false)
          handleSelectOption(optionToSelect)
          return
        }

        // Phase 2a.1: Try label matching for visible options
        // e.g., "workspace 6" matches "Workspace 6 (Home)"
        const labelMatch = findExactOptionMatch(trimmedInput, pendingOptions)
        if (labelMatch) {
          void debugLog({
            component: 'ChatNavigation',
            action: 'label_match_selection',
            metadata: {
              input: trimmedInput,
              matchedLabel: labelMatch.label,
            },
            // V5 Metrics: Track clarification resolved via label match
            metrics: {
              event: 'clarification_resolved',
              selectedLabel: labelMatch.label,
              timestamp: Date.now(),
            },
          })

          // Use grace window: keep options for one more turn
          setPendingOptionsGraceCount(1)

          // Execute the selection directly
          const optionToSelect: SelectionOption = {
            type: labelMatch.type as SelectionOption['type'],
            id: labelMatch.id,
            label: labelMatch.label,
            sublabel: labelMatch.sublabel,
            data: labelMatch.data as SelectionOption['data'],
          }

          setIsLoading(false)
          handleSelectOption(optionToSelect)
          return
        }

        // Not a pure selection or label match - fall through to LLM with context
        // The LLM can handle: "is D available?", "what are the options?", etc.
        // Per Phase 2a.1: If no label match, fall back to LLM with pendingOptions context
        void debugLog({
          component: 'ChatNavigation',
          action: 'selection_guard_passthrough_to_llm',
          metadata: { input: trimmedInput, pendingCount: pendingOptions.length },
        })
      }

      // ---------------------------------------------------------------------------
      // Fallback Selection: Use message-derived options when pendingOptions is empty
      // Per llm-chat-context-first-plan.md - only intercept pure selection patterns
      // ---------------------------------------------------------------------------
      if (pendingOptions.length === 0) {
        const now = Date.now()
        // Find last options from chat messages (source of truth)
        const lastOptionsMessage = findLastOptionsMessage(messages)
        const messageAge = lastOptionsMessage ? now - lastOptionsMessage.timestamp.getTime() : null
        const isWithinGraceWindow = lastOptionsMessage && messageAge !== null && messageAge <= RESHOW_WINDOW_MS

        if (isWithinGraceWindow && lastOptionsMessage) {
          // Use selection-only guard for message-derived options too
          const optionLabels = lastOptionsMessage.options.map(opt => opt.label)
          const selectionResult = isSelectionOnly(trimmedInput, lastOptionsMessage.options.length, optionLabels)

          if (selectionResult.isSelection && selectionResult.index !== undefined) {
            const selectedOption = lastOptionsMessage.options[selectionResult.index]
            void debugLog({
              component: 'ChatNavigation',
              action: 'selection_from_message',
              metadata: {
                input: trimmedInput,
                index: selectionResult.index,
                selectedLabel: selectedOption.label,
              },
            })

            // Restore pendingOptions and execute selection
            setPendingOptions(lastOptionsMessage.options)
            const optionToSelect: SelectionOption = {
              type: selectedOption.type as SelectionOption['type'],
              id: selectedOption.id,
              label: selectedOption.label,
              sublabel: selectedOption.sublabel,
              data: selectedOption.data as SelectionOption['data'],
            }
            setIsLoading(false)
            handleSelectOption(optionToSelect)
            return
          }

          // Not a pure selection - let it go to LLM with context
          // LLM will see lastOptions in chatContext and can answer accordingly
          void debugLog({
            component: 'ChatNavigation',
            action: 'message_options_passthrough_to_llm',
            metadata: { input: trimmedInput, optionsCount: lastOptionsMessage.options.length },
          })
        }
      }

      // ---------------------------------------------------------------------------
      // Normal flow: Call the LLM API
      // ---------------------------------------------------------------------------

      // Get context from props or fall back to session state (which tracks view mode properly)
      // Use sessionState.currentWorkspaceId instead of getActiveWorkspaceContext() because:
      // - sessionState is cleared when on dashboard (via setCurrentLocation)
      // - getActiveWorkspaceContext() might retain stale workspace ID for quick-return feature
      const entryId = currentEntryId ?? sessionState.currentEntryId ?? getActiveEntryContext() ?? undefined
      const workspaceId = currentWorkspaceId ?? sessionState.currentWorkspaceId ?? undefined

      void debugLog({
        component: 'ChatNavigation',
        action: 'sending_to_api',
        metadata: { entryId, workspaceId, fromProps: !!currentWorkspaceId, fromSessionState: sessionState.currentWorkspaceId, viewMode: sessionState.currentViewMode },
      })

      // Normalize the input message before sending to LLM
      const normalizedMessage = normalizeUserMessage(trimmedInput)

      // Build conversation context from message history (use DB summary if available)
      const contextPayload = buildContextPayload(messages, conversationSummary)

      // Build pending options for LLM context (for free-form selection fallback)
      const pendingOptionsForContext = pendingOptions.length > 0
        ? pendingOptions.map((opt) => ({
            index: opt.index,
            label: opt.label,
            sublabel: opt.sublabel,
            type: opt.type,
          }))
        : undefined

      // Build chat context for LLM clarification answers (per llm-chat-context-first-plan.md)
      // DEBUG: Trace uiContext to diagnose stale closure issue
      console.log('[ChatNavigation] sendMessage_uiContext:', {
        mode: uiContext?.mode,
        openDrawer: uiContext?.dashboard?.openDrawer?.title,
        openDrawerId: uiContext?.dashboard?.openDrawer?.panelId,
        hasUiContext: !!uiContext,
      })
      void debugLog({
        component: 'ChatNavigation',
        action: 'sendMessage_uiContext',
        metadata: {
          mode: uiContext?.mode,
          openDrawer: uiContext?.dashboard?.openDrawer?.title,
          hasUiContext: !!uiContext,
        },
      })
      const chatContext = buildChatContext(messages, uiContext)

      // Call the navigate API with normalized message, context, and session state
      const response = await fetch('/api/chat/navigate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          message: normalizedMessage,
          currentEntryId: entryId,
          currentWorkspaceId: workspaceId,
          context: {
            ...contextPayload,
            sessionState,
            pendingOptions: pendingOptionsForContext,
            // Panel visibility context for intent prioritization
            visiblePanels,
            focusedPanelId,
            // Chat context for LLM clarification answers
            chatContext,
            // UI context for current screen visibility
            uiContext,
            // Phase 2a: Clarification context for "yes please" / affirmation handling
            lastClarification,
            // Full chat history for need_context retrieval loop
            // Per llm-context-retrieval-general-answers-plan.md
            fullChatHistory: messages.slice(-50).map(m => ({
              role: m.role,
              content: m.content,
            })),
          },
        }),
      })

      if (!response.ok) {
        throw new Error('Failed to process request')
      }

      const { resolution, suggestions: rawSuggestions, clarification: apiClarification } = (await response.json()) as {
        resolution: IntentResolutionResult
        suggestions?: ChatSuggestions
        // Phase 2a.3: Clarification metadata from API
        clarification?: {
          id: string
          nextAction: 'show_workspace_picker'
          originalIntent: string
        }
      }

      // Filter out rejected candidates from suggestions
      let suggestions: ChatSuggestions | undefined = rawSuggestions
      let allSuggestionsFiltered = false
      if (rawSuggestions && rawSuggestions.candidates.length > 0) {
        // Debug: log rejection filtering
        void debugLog({
          component: 'ChatNavigation',
          action: 'filtering_suggestions',
          metadata: {
            rawCandidates: rawSuggestions.candidates.map(c => c.label),
            rejectedLabels: Array.from(rawSuggestions.candidates.map(c => ({
              label: c.label,
              isRejected: isRejectedSuggestion(c.label),
            }))),
          },
        })

        const filteredCandidates = rawSuggestions.candidates.filter(
          (c) => !isRejectedSuggestion(c.label)
        )
        if (filteredCandidates.length === 0) {
          // All candidates were rejected - don't show suggestions
          suggestions = undefined
          allSuggestionsFiltered = true
          void debugLog({
            component: 'ChatNavigation',
            action: 'all_suggestions_filtered',
            metadata: { reason: 'all candidates were rejected' },
          })
        } else if (filteredCandidates.length !== rawSuggestions.candidates.length) {
          // Some candidates were filtered out
          suggestions = {
            ...rawSuggestions,
            candidates: filteredCandidates,
            // If we went from multiple to single, change type to confirm_single
            type: filteredCandidates.length === 1 ? 'confirm_single' : rawSuggestions.type,
          }
        }
      }

      // ---------------------------------------------------------------------------
      // Handle select_option action from LLM (free-form selection fallback)
      // ---------------------------------------------------------------------------
      void debugLog({
        component: 'ChatNavigation',
        action: 'llm_response',
        metadata: {
          action: resolution.action,
          optionIndex: (resolution as any).optionIndex,
          optionLabel: (resolution as any).optionLabel,
          pendingOptionsCount: pendingOptions.length,
        },
      })

      // ---------------------------------------------------------------------------
      // Track user requests for "did I ask you to..." queries
      // ---------------------------------------------------------------------------
      // Track request based on resolution action (before execution)
      const trackRequest = () => {
        switch (resolution.action) {
          case 'open_panel_drawer':
            if (resolution.panelId) {
              appendRequestHistory({
                type: 'request_open_panel',
                targetType: 'panel',
                targetName: resolution.panelTitle || resolution.panelId,
                targetId: resolution.semanticPanelId || resolution.panelId,
              })
            }
            break
          case 'navigate_workspace':
            if (resolution.workspace) {
              appendRequestHistory({
                type: 'request_open_workspace',
                targetType: 'workspace',
                targetName: resolution.workspace.name,
                targetId: resolution.workspace.id,
              })
            }
            break
          case 'navigate_entry':
            if (resolution.entry) {
              appendRequestHistory({
                type: 'request_open_entry',
                targetType: 'entry',
                targetName: resolution.entry.name,
                targetId: resolution.entry.id,
              })
            }
            break
          case 'navigate_home':
            appendRequestHistory({
              type: 'request_go_home',
              targetType: 'navigation',
              targetName: 'Home',
            })
            break
          case 'navigate_dashboard':
            appendRequestHistory({
              type: 'request_go_dashboard',
              targetType: 'navigation',
              targetName: 'Dashboard',
            })
            break
          case 'list_workspaces':
            appendRequestHistory({
              type: 'request_list_workspaces',
              targetType: 'workspace',
              targetName: 'Workspaces',
            })
            break
          case 'inform':
          case 'show_view_panel':
            // Track panel_intent (custom widgets) when viewPanelContent is shown
            // This handles "show my demo widget" style requests
            if (resolution.viewPanelContent?.title) {
              appendRequestHistory({
                type: 'request_open_panel',
                targetType: 'panel',
                targetName: resolution.viewPanelContent.title,
                targetId: resolution.panelId || resolution.viewPanelContent.title.toLowerCase().replace(/\s+/g, '-'),
              })
            }
            break
        }
      }
      trackRequest()

      if (resolution.action === 'select_option' && pendingOptions.length > 0) {
        // LLM returned select_option - map to pending options
        // Resolution should have optionIndex or optionLabel from the resolver
        const optionIndex = (resolution as any).optionIndex as number | undefined
        const optionLabel = (resolution as any).optionLabel as string | undefined

        let selectedOption: PendingOptionState | undefined

        if (optionIndex !== undefined && optionIndex >= 1 && optionIndex <= pendingOptions.length) {
          selectedOption = pendingOptions[optionIndex - 1]
        } else if (optionLabel) {
          // Safety net: Try to find by label (should rarely be used after prompt hardening)
          // Normalize: strip common filler phrases
          const normalizedLabel = optionLabel
            .replace(/^(the one (from|called|named|with|in)|the|that)\s+/gi, '')
            .replace(/\s+(one|option)$/gi, '')
            .trim()
            .toLowerCase()

          selectedOption = pendingOptions.find(
            (opt) =>
              // Exact match
              opt.label.toLowerCase() === normalizedLabel ||
              // Label contains search term
              opt.label.toLowerCase().includes(normalizedLabel) ||
              // Search term contains label (e.g., "the Workspace 6 one" contains "Workspace 6")
              normalizedLabel.includes(opt.label.toLowerCase()) ||
              // Sublabel contains search term
              (opt.sublabel && opt.sublabel.toLowerCase().includes(normalizedLabel)) ||
              // Search term contains sublabel
              (opt.sublabel && normalizedLabel.includes(opt.sublabel.toLowerCase()))
          )
        }

        if (selectedOption) {
          void debugLog({
            component: 'ChatNavigation',
            action: 'llm_select_option',
            metadata: { optionIndex, optionLabel, selectedLabel: selectedOption.label },
          })

          // Use grace window: keep options for one more turn
          setPendingOptionsGraceCount(1)

          // Execute the selection
          const optionToSelect: SelectionOption = {
            type: selectedOption.type as SelectionOption['type'],
            id: selectedOption.id,
            label: selectedOption.label,
            sublabel: selectedOption.sublabel,
            data: selectedOption.data as SelectionOption['data'],
          }

          setIsLoading(false)
          handleSelectOption(optionToSelect)
          return
        } else {
          // Could not match option - show clarification
          const assistantMessage: ChatMessage = {
            id: `assistant-${Date.now()}`,
            role: 'assistant',
            content: "I couldn't tell which one you meant. Please click a pill or say 'first', 'second', or 'last'.",
            timestamp: new Date(),
            isError: false,
          }
          addMessage(assistantMessage)
          setIsLoading(false)
          return
        }
      }

      // ---------------------------------------------------------------------------
      // Handle reshow_options - user wants to see pending options again
      // Per pending-options-message-source-plan.md - use chat messages as source of truth
      // ---------------------------------------------------------------------------
      if (resolution.action === 'reshow_options') {
        const now = Date.now()
        // Find last options from chat messages (source of truth)
        const lastOptionsMessage = findLastOptionsMessage(messages)
        const messageAge = lastOptionsMessage ? now - lastOptionsMessage.timestamp.getTime() : null
        const isWithinGraceWindow = lastOptionsMessage && messageAge !== null && messageAge <= RESHOW_WINDOW_MS

        // Determine which options to show: pendingOptions or message-derived (grace window)
        const optionsToShow = pendingOptions.length > 0
          ? pendingOptions
          : (isWithinGraceWindow && lastOptionsMessage ? lastOptionsMessage.options : null)

        if (optionsToShow && optionsToShow.length > 0) {
          void debugLog({
            component: 'ChatNavigation',
            action: 'llm_reshow_options',
            metadata: {
              source: pendingOptions.length > 0 ? 'pendingOptions' : 'message',
              optionsCount: optionsToShow.length,
            },
          })

          const messageId = `assistant-${Date.now()}`
          const assistantMessage: ChatMessage = {
            id: messageId,
            role: 'assistant',
            content: resolution.message || 'Here are your options:',
            timestamp: new Date(),
            isError: false,
            options: optionsToShow.map((opt) => ({
              type: opt.type as SelectionOption['type'],
              id: opt.id,
              label: opt.label,
              sublabel: opt.sublabel,
              data: opt.data as SelectionOption['data'],
            })),
          }
          addMessage(assistantMessage)

          // Restore pendingOptions if using message-derived options
          if (pendingOptions.length === 0 && lastOptionsMessage) {
            setPendingOptions(lastOptionsMessage.options)
          }
          setPendingOptionsMessageId(messageId)
          setPendingOptionsGraceCount(0)

          // Per options-visible-clarification-sync-plan.md: sync lastClarification on re-show
          setLastClarification({
            type: 'option_selection',
            originalIntent: 'reshow_options',
            messageId,
            timestamp: Date.now(),
            clarificationQuestion: resolution.message || 'Here are your options:',
            options: optionsToShow.map(opt => ({
              id: opt.id,
              label: opt.label,
              sublabel: opt.sublabel,
              type: opt.type,
            })),
            metaCount: 0,
          })

          setIsLoading(false)
          return
        } else {
          // No options to show - grace window expired or no prior options
          void debugLog({
            component: 'ChatNavigation',
            action: 'llm_reshow_options_expired',
            metadata: { hasLastOptionsMessage: !!lastOptionsMessage, messageAgeMs: messageAge },
          })

          const assistantMessage: ChatMessage = {
            id: `assistant-${Date.now()}`,
            role: 'assistant',
            content: "No options are open. Say 'show quick links' to see them again.",
            timestamp: new Date(),
            isError: false,
          }
          addMessage(assistantMessage)
          setIsLoading(false)
          return
        }
      }

      // Execute the action
      const result = await executeAction(resolution)

      // ---------------------------------------------------------------------------
      // Update pending options based on result
      // ---------------------------------------------------------------------------
      // Handle actions that return selectable options:
      // - 'select': disambiguation options
      // - 'clarify_type': entry vs workspace conflict
      // - 'list_workspaces': workspace list with selectable pills (Phase 2b)
      const hasSelectableOptions = (
        resolution.action === 'select' ||
        resolution.action === 'clarify_type' ||
        resolution.action === 'list_workspaces'
      ) && resolution.options && resolution.options.length > 0

      if (hasSelectableOptions && resolution.options) {
        // Store new pending options for hybrid selection
        const newPendingOptions: PendingOptionState[] = resolution.options.map((opt, idx) => ({
          index: idx + 1,
          label: opt.label,
          sublabel: opt.sublabel,
          type: opt.type,
          id: opt.id,
          data: opt.data,
        }))
        setPendingOptions(newPendingOptions)
        setPendingOptionsMessageId(`assistant-${Date.now()}`)
        setPendingOptionsGraceCount(0)  // Fresh options, no grace yet
        // Note: lastOptions state removed - now using findLastOptionsMessage() as source of truth

        // Per options-visible-clarification-sync-plan.md: sync lastClarification with options
        setLastClarification({
          type: 'option_selection',
          originalIntent: resolution.action || 'select',
          messageId: `assistant-${Date.now()}`,
          timestamp: Date.now(),
          clarificationQuestion: resolution.message || 'Which one would you like?',
          options: resolution.options.map(opt => ({
            id: opt.id,
            label: opt.label,
            sublabel: opt.sublabel,
            type: opt.type,
          })),
          metaCount: 0,
        })

        void debugLog({
          component: 'ChatNavigation',
          action: 'stored_pending_options',
          metadata: { count: newPendingOptions.length },
        })
      } else {
        // Only clear pending options for explicit navigation/action commands
        // Do NOT clear on fallback/error responses (preserves options for retry)
        const explicitActionsThatClearOptions = [
          'navigate_workspace',
          'navigate_entry',
          'navigate_home',
          'navigate_dashboard',
          'create_workspace',
          'rename_workspace',
          'delete_workspace',
          'open_panel_drawer',
          'confirm_delete',
          // Note: list_workspaces removed - it now stores its own options (Phase 2b)
        ]
        const shouldClear = resolution.action && explicitActionsThatClearOptions.includes(resolution.action)

        if (shouldClear && pendingOptions.length > 0) {
          setPendingOptions([])
          setPendingOptionsMessageId(null)
          setPendingOptionsGraceCount(0)
        }
      }

      // Track successful actions for session state and show toast
      if (result.success && result.action) {
        // Clear rejected suggestions when user successfully navigates (explicitly named a target)
        if (result.action === 'navigated' || result.action === 'created' || result.action === 'renamed' || result.action === 'deleted') {
          clearRejectedSuggestions()
        }

        const now = Date.now()
        switch (result.action) {
          case 'navigated':
            if (resolution.action === 'navigate_workspace' && resolution.workspace) {
              setLastAction({
                type: 'open_workspace',
                workspaceId: resolution.workspace.id,
                workspaceName: resolution.workspace.name,
                timestamp: now,
              })
              showWorkspaceOpenedToast(resolution.workspace.name, resolution.workspace.entryName)
              // Note: incrementOpenCount is NOT called here - DashboardView.handleWorkspaceSelectById
              // is the single source of truth for open counts (avoids double-counting)
            } else if (resolution.action === 'navigate_dashboard') {
              setLastAction({
                type: 'go_to_dashboard',
                timestamp: now,
              })
              showDashboardToast()
            } else if (resolution.action === 'navigate_home') {
              setLastAction({
                type: 'go_home',
                timestamp: now,
              })
              showHomeToast()
              // Track Home entry open for session stats
              // Fetch Home entry info and track it
              fetch('/api/dashboard/info')
                .then(res => res.ok ? res.json() : null)
                .then(data => {
                  if (data?.homeEntryId) {
                    const homeEntryName = data.homeEntryName || 'Home'
                    incrementOpenCount(data.homeEntryId, homeEntryName, 'entry')
                  }
                })
                .catch(err => console.warn('[ChatNavigation] Failed to track Home entry:', err))
            } else if (resolution.action === 'navigate_entry' && resolution.entry) {
              setLastAction({
                type: 'open_entry',
                entryId: resolution.entry.id,
                entryName: resolution.entry.name,
                timestamp: now,
              })
              showEntryOpenedToast(resolution.entry.name)
              incrementOpenCount(resolution.entry.id, resolution.entry.name, 'entry')
            } else if (resolution.action === 'open_panel_drawer' && resolution.panelId) {
              // Track panel drawer opens for "did I open X?" queries
              // Use semanticPanelId for robust ID-based matching (e.g., "quick-links-d")
              setLastAction({
                type: 'open_panel',
                panelId: resolution.semanticPanelId || resolution.panelId,
                panelTitle: resolution.panelTitle || resolution.panelId,
                timestamp: now,
              })
            }
            break
          case 'created':
            if (resolution.newWorkspace) {
              setLastAction({
                type: 'create_workspace',
                workspaceName: resolution.newWorkspace.name,
                timestamp: now,
              })
              showWorkspaceCreatedToast(resolution.newWorkspace.name)
            }
            break
          case 'renamed':
            if (resolution.renamedWorkspace) {
              setLastAction({
                type: 'rename_workspace',
                workspaceId: resolution.renamedWorkspace.id,
                workspaceName: resolution.renamedWorkspace.name,
                fromName: resolution.renamedFrom,  // Original name before rename
                toName: resolution.renamedWorkspace.name,
                timestamp: now,
              })
              if (resolution.renamedFrom) {
                showWorkspaceRenamedToast(resolution.renamedFrom, resolution.renamedWorkspace.name)
              }
            }
            break
          case 'deleted':
            if (resolution.deleteTarget) {
              setLastAction({
                type: 'delete_workspace',
                workspaceId: resolution.deleteTarget.id,
                workspaceName: resolution.deleteTarget.name,
                timestamp: now,
              })
              showWorkspaceDeletedToast(resolution.deleteTarget.name)
            }
            break
        }
      }

      if (result.success) {
        const quickLinksBadge = extractQuickLinksBadge(
          resolution.panelTitle || resolution.viewPanelContent?.title
        )
        if (quickLinksBadge) {
          setLastQuickLinksBadge(quickLinksBadge)
        }
      }

      // Create assistant message
      // Include options for 'selected' (disambiguation pills), 'clarify_type' (entry vs workspace),
      // and confirmation dialogs (confirm_delete, confirm_panel_write)
      const showOptions = (
        result.action === 'selected' ||
        resolution.action === 'clarify_type' ||
        resolution.action === 'confirm_delete' ||
        resolution.action === 'confirm_panel_write'
      ) && resolution.options
      const assistantMessageId = `assistant-${Date.now()}`
      // Override message content if all suggestions were filtered out (user rejected them)
      // Per suggestion-fallback-polish-plan.md: filter rejected labels from fallback
      // Phase 2a.2: Skip typo fallback when pendingOptions exist - let LLM handle with context
      let messageContent = result.message
      if (allSuggestionsFiltered && pendingOptions.length === 0) {
        const baseFallbackLabels = ['recent', 'quick links', 'workspaces']
        const filteredFallbackLabels = baseFallbackLabels.filter(
          (label) => !isRejectedSuggestion(label)
        )
        const fallbackList = filteredFallbackLabels.length > 0
          ? filteredFallbackLabels.map((l) => `\`${l}\``).join(', ')
          : '`workspaces`' // Ultimate fallback if all are rejected
        messageContent = `I'm not sure what you meant. Try: ${fallbackList}.`
      }
      const assistantMessage: ChatMessage = {
        id: assistantMessageId,
        role: 'assistant',
        content: messageContent,
        timestamp: new Date(),
        isError: !result.success,
        options: showOptions
            ? resolution.options!.map((opt) => ({
                type: opt.type,
                id: opt.id,
                label: opt.label,
                sublabel: opt.sublabel,
                data: opt.data,
              }))
            : undefined,
        // Typo recovery suggestions
        suggestions: suggestions,
        // View panel content for "Show all" preview
        viewPanelContent: resolution.viewPanelContent,
        previewItems: resolution.previewItems,
        totalCount: resolution.totalCount,
        drawerPanelId: resolution.panelId,
        drawerPanelTitle: resolution.panelTitle,
      }
      addMessage(assistantMessage)

      // Store lastSuggestion for rejection handling
      if (suggestions && suggestions.candidates.length > 0) {
        setLastSuggestion({
          candidates: suggestions.candidates,
          messageId: assistantMessageId,
        })
      } else {
        // Clear lastSuggestion if no suggestions (user moved on to valid command)
        setLastSuggestion(null)
      }

      // Phase 2a.3: Set clarification from API metadata (not text matching)
      if (apiClarification) {
        setLastClarification({
          type: apiClarification.id as 'notes_scope',
          originalIntent: apiClarification.originalIntent as 'list_open_notes',
          nextAction: apiClarification.nextAction,
          messageId: assistantMessageId,
          timestamp: Date.now(),
        })
      } else if (resolution.success && resolution.action !== 'error' && resolution.action !== 'answer_from_context') {
        // Only clear clarification when an explicit action is executed (navigation, panel open, etc.)
        // NOT on every response without metadata - that would break the clarification flow
        // The clarification-mode intercept handles clearing in executeNextAction() and handleRejection()
        setLastClarification(null)
      }
      // If response is an error or answer_from_context without clarification metadata,
      // preserve lastClarification so user can still reply to the original clarification

      // Store lastPreview for "show all" shortcut
      if (resolution.viewPanelContent && resolution.previewItems && resolution.previewItems.length > 0) {
        setLastPreview({
          source: resolution.viewPanelContent.title || 'preview',
          viewPanelContent: resolution.viewPanelContent,
          totalCount: resolution.totalCount || resolution.previewItems.length,
          messageId: assistantMessage.id,
          createdAt: Date.now(),
          drawerPanelId: resolution.panelId,
          drawerPanelTitle: resolution.panelTitle,
        })
      }

      // Open view panel if content is available
      if (resolution.showInViewPanel && resolution.viewPanelContent) {
        openPanelWithTracking(resolution.viewPanelContent, resolution.panelId)
      }
    } catch (error) {
      const errorMessage: ChatMessage = {
        id: `error-${Date.now()}`,
        role: 'assistant',
        content: 'Something went wrong. Please try again.',
        timestamp: new Date(),
        isError: true,
      }
      addMessage(errorMessage)
    } finally {
      setIsLoading(false)
    }
  }, [input, isLoading, currentEntryId, currentWorkspaceId, executeAction, messages, addMessage, setInput, sessionState, setLastAction, setLastQuickLinksBadge, appendRequestHistory, openPanelWithTracking, openPanelDrawer, conversationSummary, pendingOptions, pendingOptionsGraceCount, handleSelectOption, lastPreview, lastSuggestion, setLastSuggestion, addRejectedSuggestions, clearRejectedSuggestions, isRejectedSuggestion, uiContext, visiblePanels, focusedPanelId, lastClarification, setLastClarification, setNotesScopeFollowUpActive])

  // ---------------------------------------------------------------------------
  // Handle Key Press
  // ---------------------------------------------------------------------------

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault()
        sendMessage()
      }
    },
    [sendMessage]
  )

  // ---------------------------------------------------------------------------
  // Clear Chat
  // ---------------------------------------------------------------------------

  const clearChat = useCallback(() => {
    clearMessages()
  }, [clearMessages])

  // ---------------------------------------------------------------------------
  // Render
  // ---------------------------------------------------------------------------

  // Render trigger button if showTrigger is true (for non-global usage)
  const triggerButton = showTrigger ? (
    trigger || (
      <Button
        variant="ghost"
        size="icon"
        className="h-8 w-8"
        onClick={() => setOpen(!isOpen)}
      >
        <MessageSquare className="h-4 w-4" />
        <span className="sr-only">Open chat navigation</span>
      </Button>
    )
  ) : null

  return (
    <>
      {/* Trigger button (only when showTrigger is true) */}
      {triggerButton}

      {/* View Panel - slides in from right for displaying content */}
      <ViewPanel />

      {/* Left-side overlay panel - uses CSS hiding to preserve scroll position */}
      {/* Backdrop - click to close */}
      <div
        className="fixed inset-0 bg-black/20 z-40 transition-opacity duration-200"
        onClick={() => setOpen(false)}
        aria-hidden="true"
        style={{
          opacity: isOpen ? 1 : 0,
          pointerEvents: isOpen ? 'auto' : 'none',
        }}
      />

      {/* Panel - Glassmorphism effect */}
      <div
        className={cn(
          'fixed left-0 top-0 z-50',
          'h-screen',
          'bg-background/80 backdrop-blur-xl border-r border-white/20 shadow-2xl',
          'flex flex-col',
          'transition-transform duration-200',
          isOpen ? 'translate-x-0' : '-translate-x-full',
          className
        )}
        style={{ width: '25vw', minWidth: '320px' }}
      >
            {/* Header - high contrast for readability */}
            <div className="flex items-center justify-between border-b border-white/20 px-4 py-3 shrink-0 bg-white/90 backdrop-blur-md">
              <div className="flex items-center gap-2">
                <MessageSquare className="h-5 w-5 text-zinc-600" />
                <span className="text-base font-semibold text-zinc-800">Navigate</span>
              </div>
              <div className="flex items-center gap-1">
                {messages.length > 0 && (
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-8 w-8 text-zinc-600 hover:text-zinc-900 hover:bg-zinc-200/50"
                    onClick={clearChat}
                    title="Clear chat"
                  >
                    <X className="h-4 w-4" />
                    <span className="sr-only">Clear chat</span>
                  </Button>
                )}
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-8 w-8 text-zinc-600 hover:text-zinc-900 hover:bg-zinc-200/50"
                  onClick={() => setOpen(false)}
                  title="Close panel"
                >
                  <PanelLeftClose className="h-4 w-4" />
                  <span className="sr-only">Close panel</span>
                </Button>
              </div>
            </div>

            {/* Messages - takes remaining space */}
            <ScrollArea className="flex-1" ref={scrollRef as any}>
              <div className="flex flex-col gap-3 p-4">
                {/* Loading history indicator */}
                {isLoadingHistory && messages.length === 0 && (
                  <div className="flex items-center justify-center py-8 bg-white/80 backdrop-blur-sm rounded-lg mx-2">
                    <Loader2 className="h-5 w-5 animate-spin text-zinc-500" />
                    <span className="ml-2 text-sm text-zinc-600">Loading history...</span>
                  </div>
                )}

                {/* Load older messages button */}
                {hasMoreMessages && !isLoadingHistory && (
                  <button
                    onClick={handleLoadOlder}
                    className="text-xs text-zinc-600 hover:text-zinc-900 text-center py-2 px-3 transition-colors bg-white/70 hover:bg-white/90 rounded-lg mx-auto block"
                  >
                    ↑ Show older messages
                  </button>
                )}
                {hasMoreMessages && isLoadingHistory && (
                  <div className="flex items-center justify-center py-2 bg-white/70 rounded-lg mx-auto px-3">
                    <Loader2 className="h-3 w-3 animate-spin text-zinc-500" />
                    <span className="ml-1.5 text-xs text-zinc-600">Loading...</span>
                  </div>
                )}

                {/* Summary banner (optional) - high contrast */}
                {conversationSummary && messages.length > 0 && (
                  <div className="text-xs text-zinc-600 bg-white/90 backdrop-blur-md rounded-lg px-3 py-2 mb-2 shadow-sm">
                    <span className="font-semibold text-zinc-800">Earlier:</span> {conversationSummary}
                  </div>
                )}

                {messages.length === 0 && !isLoadingHistory ? (
                  <div className="text-center text-sm py-12 bg-white/80 backdrop-blur-sm rounded-lg mx-2 shadow-sm">
                    <p className="mb-3 text-zinc-700 font-medium">Try saying:</p>
                    <p className="italic mb-1 text-zinc-600">&quot;open workspace Research&quot;</p>
                    <p className="italic mb-1 text-zinc-600">&quot;go to note Project Plan&quot;</p>
                    <p className="italic mb-1 text-zinc-600">&quot;create workspace Sprint 12&quot;</p>
                    <p className="italic mb-1 text-zinc-600">&quot;list workspaces&quot;</p>
                    <p className="italic mb-1 text-zinc-600">&quot;where am I?&quot;</p>
                    <p className="italic text-zinc-600">&quot;what did I just do?&quot;</p>
                  </div>
                ) : (
                  <>
                  {messages.map((message, index) => {
                    const prevMessage = index > 0 ? messages[index - 1] : null
                    const showDateHeader = !prevMessage || isDifferentDay(message.timestamp, prevMessage.timestamp)
                    const messageIsToday = isToday(message.timestamp)

                    return (
                    <div key={message.id}>
                      {/* Date Header: show when day changes */}
                      {showDateHeader && (
                        <DateHeader date={message.timestamp} isToday={messageIsToday} />
                      )}
                      {/* Session Divider: show after history messages (before first new message) */}
                      {index === initialMessageCount && initialMessageCount > 0 && (
                        <SessionDivider />
                      )}
                      <div
                        className={cn(
                          'flex flex-col gap-1',
                          message.role === 'user' ? 'items-end' : 'items-start',
                          // Slightly fade history messages
                          index < initialMessageCount && 'opacity-75'
                        )}
                      >
                        <div
                          className={cn(
                            'rounded-lg px-3 py-2 text-sm max-w-[90%] shadow-lg',
                            message.role === 'user'
                              ? 'bg-zinc-900/90 text-white backdrop-blur-xl border border-white/10'
                              : message.isError
                                ? 'bg-red-950/90 text-red-200 backdrop-blur-xl border border-red-500/20'
                                : 'bg-white/90 text-indigo-900 backdrop-blur-xl border border-white/20'
                          )}
                        >
                          {message.content}
                        </div>

                        {/* Message Result Preview (for "Show all" view panel content) */}
                        {message.previewItems && message.previewItems.length > 0 && message.viewPanelContent && (
                          <MessageResultPreview
                            title={message.viewPanelContent.title}
                            previewItems={message.previewItems}
                            totalCount={message.totalCount ?? message.previewItems.length}
                            fullContent={message.viewPanelContent}
                            onShowAll={
                              message.drawerPanelId
                                ? () => openPanelDrawer(message.drawerPanelId!, message.drawerPanelTitle)
                                : undefined
                            }
                          />
                        )}

                        {/* Selection Pills */}
                        {message.options && message.options.length > 0 && (
                          <div className="flex flex-wrap gap-1.5 mt-1.5">
                            {message.options.map((option) => (
                              <button
                                key={option.id}
                                onClick={() => handleSelectOption(option)}
                                disabled={isLoading}
                                className="group"
                              >
                                <Badge
                                  variant="secondary"
                                  className={cn(
                                    'cursor-pointer transition-colors',
                                    'hover:bg-primary hover:text-primary-foreground',
                                    isLoading && 'opacity-50 cursor-not-allowed'
                                  )}
                                >
                                  <span className="flex items-center gap-1">
                                    {option.label}
                                    {option.sublabel && (
                                      <span className="text-xs opacity-70">
                                        ({option.sublabel})
                                      </span>
                                    )}
                                    <ChevronRight className="h-3 w-3 opacity-50 group-hover:opacity-100" />
                                  </span>
                                </Badge>
                              </button>
                            ))}
                          </div>
                        )}

                        {/* Suggestion Pills (typo recovery) */}
                        {message.suggestions && message.suggestions.candidates.length > 0 && (
                          <div className="flex flex-wrap gap-1.5 mt-1.5">
                            {/* Case A: High-confidence single match - show dual action buttons */}
                            {message.suggestions.type === 'confirm_single' && message.suggestions.candidates.length === 1 && (
                              <>
                                {/* Open button - primary action */}
                                <button
                                  key={`suggestion-open-${message.suggestions.candidates[0].label}`}
                                  onClick={() => handleSuggestionClick(message.suggestions!.candidates[0].label, 'open')}
                                  disabled={isLoading}
                                  className="group"
                                >
                                  <Badge
                                    variant="secondary"
                                    className={cn(
                                      'cursor-pointer transition-colors',
                                      'hover:bg-primary hover:text-primary-foreground',
                                      isLoading && 'opacity-50 cursor-not-allowed'
                                    )}
                                  >
                                    <span className="flex items-center gap-1">
                                      {message.suggestions.candidates[0].primaryAction === 'list'
                                        ? `Show ${message.suggestions.candidates[0].label}`
                                        : `Open ${message.suggestions.candidates[0].label}`}
                                      <ChevronRight className="h-3 w-3 opacity-50 group-hover:opacity-100" />
                                    </span>
                                  </Badge>
                                </button>
                                {/* List in chat button - preview action */}
                                <button
                                  key={`suggestion-list-${message.suggestions.candidates[0].label}`}
                                  onClick={() => handleSuggestionClick(message.suggestions!.candidates[0].label, 'list')}
                                  disabled={isLoading}
                                  className="group"
                                >
                                  <Badge
                                    variant="outline"
                                    className={cn(
                                      'cursor-pointer transition-colors',
                                      'hover:bg-primary hover:text-primary-foreground',
                                      'border-dashed text-muted-foreground',
                                      isLoading && 'opacity-50 cursor-not-allowed'
                                    )}
                                  >
                                    <span className="flex items-center gap-1">
                                      List in chat
                                      <ChevronRight className="h-3 w-3 opacity-50 group-hover:opacity-100" />
                                    </span>
                                  </Badge>
                                </button>
                              </>
                            )}
                            {/* Case B/C: Multiple matches or low confidence - show single button per candidate */}
                            {(message.suggestions.type !== 'confirm_single' || message.suggestions.candidates.length > 1) &&
                              message.suggestions.candidates.map((candidate, idx) => (
                              <button
                                key={`suggestion-${idx}-${candidate.label}`}
                                onClick={() => handleSuggestionClick(candidate.label, 'open')}
                                disabled={isLoading}
                                className="group"
                              >
                                <Badge
                                  variant="outline"
                                  className={cn(
                                    'cursor-pointer transition-colors',
                                    'hover:bg-primary hover:text-primary-foreground',
                                    'border-dashed text-muted-foreground',
                                    isLoading && 'opacity-50 cursor-not-allowed'
                                  )}
                                >
                                  <span className="flex items-center gap-1">
                                    {candidate.label}
                                    <ChevronRight className="h-3 w-3 opacity-50 group-hover:opacity-100" />
                                  </span>
                                </Badge>
                              </button>
                            ))}
                          </div>
                        )}
                      </div>
                    </div>
                    )
                  })}
                  {/* Session Divider at end: show after all history messages when no new messages yet */}
                  {initialMessageCount > 0 && messages.length === initialMessageCount && (
                    <SessionDivider />
                  )}
                  </>
                )}

                {/* Loading Indicator */}
                {isLoading && (
                  <div className="flex items-center gap-2 text-muted-foreground">
                    <Loader2 className="h-4 w-4 animate-spin" />
                    <span className="text-sm">Processing...</span>
                  </div>
                )}

                {/* Scroll anchor - always at bottom for auto-scroll */}
                <div ref={scrollAnchorRef} aria-hidden="true" />
              </div>
            </ScrollArea>

            {/* Input - fixed at bottom with high contrast */}
            <div className="border-t border-white/20 p-3 shrink-0 bg-white/90 backdrop-blur-md">
              <div className="flex items-center gap-2">
                <Input
                  ref={inputRef}
                  type="text"
                  placeholder="Where would you like to go?"
                  value={input}
                  onChange={(e) => setInput(e.target.value)}
                  onKeyDown={handleKeyDown}
                  disabled={isLoading}
                  className="h-10 text-sm bg-white text-zinc-900 border-zinc-300 placeholder:text-zinc-400"
                />
                <Button
                  size="icon"
                  className="h-10 w-10 shrink-0"
                  onClick={sendMessage}
                  disabled={!input.trim() || isLoading}
                >
                  {isLoading ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <Send className="h-4 w-4" />
                  )}
                  <span className="sr-only">Send</span>
                </Button>
              </div>
            </div>
          </div>
    </>
  )
}
