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
import {
  showWorkspaceOpenedToast,
  showWorkspaceCreatedToast,
  showWorkspaceRenamedToast,
  showWorkspaceDeletedToast,
  showDashboardToast,
  showHomeToast,
  showEntryOpenedToast,
} from '@/lib/chat/navigation-toast'

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
 * Check if input is a rejection phrase.
 * Per suggestion-rejection-handling-plan.md:
 * - Exact: "no", "nope", "not that", "cancel", "never mind"
 * - Or it begins with "no,"
 */
function isRejectionPhrase(input: string): boolean {
  const normalized = input.toLowerCase().trim()

  // Exact rejection phrases
  const rejectionPhrases = ['no', 'nope', 'not that', 'cancel', 'never mind', 'nevermind']
  if (rejectionPhrases.includes(normalized)) {
    return true
  }

  // Begins with "no,"
  if (normalized.startsWith('no,')) {
    return true
  }

  return false
}

/**
 * Check if input is an affirmation phrase.
 * Per suggestion-fallback-polish-plan.md:
 * Used to detect "yes" when there's no active suggestion to confirm.
 */
function isAffirmationPhrase(input: string): boolean {
  const normalized = input.toLowerCase().trim()
  const affirmationPhrases = ['yes', 'yeah', 'yep', 'yup', 'sure', 'ok', 'okay']
  return affirmationPhrases.includes(normalized)
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
function buildChatContext(messages: ChatMessage[]): ChatContext {
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
 */
function hasActionVerb(input: string): boolean {
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
 */
function isExplicitCommand(input: string): boolean {
  const normalized = input.toLowerCase()

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
    // Suggestion rejection handling
    lastSuggestion,
    setLastSuggestion,
    addRejectedSuggestions,
    clearRejectedSuggestions,
    isRejectedSuggestion,
  } = useChatNavigationContext()

  const { executeAction, selectOption, openPanelDrawer: openPanelDrawerBase } = useChatNavigation({
    onNavigationComplete: () => {
      onNavigationComplete?.()
      setOpen(false)
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

  // ---------------------------------------------------------------------------
  // Handle Selection (moved before sendMessage for hybrid selection)
  // ---------------------------------------------------------------------------

  const handleSelectOption = useCallback(
    async (option: SelectionOption) => {
      setIsLoading(true)

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
    [selectOption, addMessage, setLastAction, setLastQuickLinksBadge]
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

            // Handle 'select' action: set pendingOptions so pills render and guard works
            // Per suggestion-confirm-yes-plan.md: set pendingOptions when options are shown
            const hasSelectOptions = resolution.action === 'select' && resolution.options && resolution.options.length > 0
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
      if (previewIsRecent && !hasActionVerb(trimmedInput)) {
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

        // Not a pure selection - fall through to LLM with context
        // The LLM can handle: "is D available?", "what are the options?", etc.
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
      const chatContext = buildChatContext(messages)

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

      const { resolution, suggestions: rawSuggestions } = (await response.json()) as {
        resolution: IntentResolutionResult
        suggestions?: ChatSuggestions
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
      // Handle both 'select' (disambiguation) and 'clarify_type' (entry vs workspace conflict)
      if ((resolution.action === 'select' || resolution.action === 'clarify_type') && resolution.options && resolution.options.length > 0) {
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
          'list_workspaces',
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
      let messageContent = result.message
      if (allSuggestionsFiltered) {
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
  }, [input, isLoading, currentEntryId, currentWorkspaceId, executeAction, messages, addMessage, setInput, sessionState, setLastAction, setLastQuickLinksBadge, appendRequestHistory, openPanelWithTracking, openPanelDrawer, conversationSummary, pendingOptions, pendingOptionsGraceCount, handleSelectOption, lastPreview, lastSuggestion, setLastSuggestion, addRejectedSuggestions, clearRejectedSuggestions, isRejectedSuggestion])

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
