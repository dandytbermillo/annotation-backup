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
import { MessageSquare, X, Loader2, PanelLeftClose } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { ScrollArea } from '@/components/ui/scroll-area'
import { cn } from '@/lib/utils'
import { debugLog } from '@/lib/utils/debug-logger'
import {
  useChatNavigation,
  useChatNavigationContext,
  ViewPanelProvider,
  useViewPanel,
  ViewContentType,
  type IntentResolutionResult,
  type ChatMessage,
  type SelectionOption,
  type WorkspaceMatch,
  type ViewPanelContent,
  type ViewListItem,
  type ChatSuggestions,
} from '@/lib/chat'
import { ViewPanel } from './view-panel'
import { ChatInput } from './ChatInput'
import { ChatMessageList } from './ChatMessageList'
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
import { fetchKnownTerms, isKnownTermsCacheValid, getKnownTermsFetchStatus } from '@/lib/docs/known-terms-client'
import type { RoutingTelemetryEvent } from '@/lib/chat/routing-telemetry'
// Step 3 refactor: Routing handlers
import { handleCorrection, handleMetaExplain, handleFollowUp, handleClarificationIntercept, type PendingOptionState } from '@/lib/chat/chat-routing'
// TD-3: Import consolidated patterns from query-patterns module
import {
  stripConversationalPrefix,
  isAffirmationPhrase,
  isRejectionPhrase,
  matchesReshowPhrases,
} from '@/lib/chat/query-patterns'
// Step 1 refactor: Pure UI helpers
import { normalizeUserMessage, extractQuickLinksBadge } from '@/lib/chat/ui-helpers'
// Step 3 refactor: Doc routing helpers
import { handleDocRetrieval, maybeFormatSnippetWithHs3, stripMarkdownHeadersForUI, dedupeHeaderPath } from '@/lib/chat/doc-routing'

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

// Context assembly limits
const MAX_RECENT_USER_MESSAGES = 6
const SUMMARY_MAX_CHARS = 400

// PendingOptionState imported from @/lib/chat/chat-routing

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

// TD-3: isAffirmationPhrase, isRejectionPhrase, isMetaPhrase now imported from query-patterns.ts
// TD-3: matchesReshowPhrases, stripConversationalPrefix, isMetaExplainOutsideClarification,
//       extractMetaExplainConcept now imported from query-patterns.ts
// Step 3 refactor: V4/V5 routing helpers now imported from doc-routing.ts

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
// Step 4 refactor: Message rendering extracted to ChatMessageList.tsx
// Date helpers (isDifferentDay, isToday) now in ChatMessageList
// =============================================================================

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
  // Note: pendingOptionsMessageId state removed - findLastOptionsMessage(messages) is now source of truth
  // Keeping setter as no-op for backward compatibility with handlers
  const setPendingOptionsMessageId = useCallback((_: string | null) => { /* no-op */ }, [])
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
    const handleDocSelection = async (event: CustomEvent<{ docSlug: string; originalQuery?: string }>) => {
      const { docSlug, originalQuery } = event.detail

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
          const rawHeaderPath = topResult.header_path || topResult.title
          const headerPath = dedupeHeaderPath(rawHeaderPath)
          const rawSnippet = topResult.snippet || ''
          const strippedSnippet = stripMarkdownHeadersForUI(rawSnippet)
          const snippetForDisplay = strippedSnippet.length > 0 ? strippedSnippet : rawSnippet

          // V5 HS3: Apply bounded formatting if triggered
          const hs3Result = await maybeFormatSnippetWithHs3(
            snippetForDisplay,
            originalQuery || docSlug, // Preserve user intent (steps) when available
            'medium', // Default to medium style for selections
            1, // Single chunk (no appending in selection path)
            topResult.title
          )

          const finalSnippet = hs3Result.ok && hs3Result.formatted
            ? hs3Result.finalSnippet
            : snippetForDisplay

          const assistantMessage: ChatMessage = {
            id: `assistant-${Date.now()}`,
            role: 'assistant',
            content: `**${headerPath}**\n\n${finalSnippet}`,
            timestamp: new Date(),
            isError: false,
            // Doc metadata for "Show more" button (per show-more-button-spec.md)
            // Show after pill click confirms doc selection
            docSlug: topResult.doc_slug || docSlug,
            chunkId: topResult.chunkId,
            headerPath: headerPath,
          }
          addMessage(assistantMessage)

          // Update docRetrievalState so correction/"not that" works after pill selection
          updateDocRetrievalState({
            lastDocSlug: topResult.doc_slug || docSlug,
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

      // TD-7: Handle high-ambiguity clarification selection
      if (option.type === 'td7_clarification') {
        const td7Data = option.data as { term: string; action: 'doc' | 'llm' }

        void debugLog({
          component: 'ChatNavigation',
          action: 'td7_clarification_selected',
          metadata: { selectedOption: option.id, term: td7Data.term, action: td7Data.action },
        })

        if (td7Data.action === 'doc') {
          // User confirmed app feature → do doc retrieval
          try {
            const retrieveResponse = await fetch('/api/docs/retrieve', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ query: td7Data.term }),
            })

            if (retrieveResponse.ok) {
              const result = await retrieveResponse.json()

              if (result.status === 'found' && result.topMatch) {
                // Found doc - show response
                const assistantMessage: ChatMessage = {
                  id: `assistant-${Date.now()}`,
                  role: 'assistant',
                  content: result.topMatch.snippet || `Here's what I found about ${td7Data.term}.`,
                  timestamp: new Date(),
                  isError: false,
                  // Doc metadata for "Show more" button (per show-more-button-spec.md)
                  docSlug: result.topMatch.slug,
                  chunkId: result.topMatch.chunkId,
                  headerPath: result.topMatch.header_path || result.topMatch.title,
                }
                addMessage(assistantMessage)

                // Set lastDocSlug for follow-ups
                updateDocRetrievalState({
                  lastDocSlug: result.topMatch.slug,
                  lastChunkIdsShown: result.topMatch.chunkId ? [result.topMatch.chunkId] : [],
                })
              } else {
                // No match found
                const noMatchMessage: ChatMessage = {
                  id: `assistant-${Date.now()}`,
                  role: 'assistant',
                  content: `I couldn't find specific documentation about ${td7Data.term}. What would you like to know about it?`,
                  timestamp: new Date(),
                  isError: false,
                }
                addMessage(noMatchMessage)
              }
            } else {
              throw new Error('Retrieval failed')
            }
          } catch {
            const errorMessage: ChatMessage = {
              id: `assistant-${Date.now()}`,
              role: 'assistant',
              content: 'Sorry, I had trouble looking that up. Please try again.',
              timestamp: new Date(),
              isError: true,
            }
            addMessage(errorMessage)
          }
        } else {
          // User selected "something else" → generic response
          const genericMessage: ChatMessage = {
            id: `assistant-${Date.now()}`,
            role: 'assistant',
            content: 'Okay, what would you like help with?',
            timestamp: new Date(),
            isError: false,
          }
          addMessage(genericMessage)
        }

        setIsLoading(false)
        return
      }

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

        // Note: TD-7 clarification options are handled above and return early,
        // so this code path is never reached for td7_clarification type
        const result = await selectOption({
          type: option.type as Exclude<SelectionOption['type'], 'td7_clarification'>,
          id: option.id,
          data: option.data as Exclude<SelectionOption['data'], import('@/lib/chat/chat-navigation-context').TD7ClarificationData>,
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
  // Show More Handler (per show-more-button-spec.md)
  // ---------------------------------------------------------------------------

  const handleShowMore = useCallback(
    (docSlug: string, chunkId?: string) => {
      // Log telemetry - PRIMARY action: open panel
      void debugLog({
        component: 'ChatNavigation',
        action: 'show_more_clicked',
        metadata: { docSlug, chunkId, action: 'open_panel' },
      })

      // PRIMARY behavior: Fetch doc content and open ViewPanel
      // Per show-more-button-spec.md: Open docs side panel for docSlug
      void (async () => {
        try {
          // Request fullContent: true to get ALL chunks combined (not truncated)
          const response = await fetch('/api/docs/retrieve', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ docSlug, fullContent: true }),
          })

          if (!response.ok) {
            throw new Error('Failed to fetch doc content')
          }

          const data = await response.json()

          if (data.success && data.results && data.results.length > 0) {
            const result = data.results[0]

            // Create ViewPanelContent with doc content
            const viewContent: ViewPanelContent = {
              type: ViewContentType.TEXT,
              title: result.title || docSlug,
              subtitle: result.header_path || result.category,
              content: result.snippet || 'No content available',
              docSlug: docSlug, // Track which doc is displayed for Show more button visibility
            }

            // Open the ViewPanel with the doc content
            openPanelWithTracking(viewContent, `doc-${docSlug}`)
          } else {
            // Fallback: Log error and show error in panel
            void debugLog({
              component: 'ChatNavigation',
              action: 'show_more_failed',
              metadata: { docSlug, reason: 'no_doc' },
            })

            const errorContent: ViewPanelContent = {
              type: ViewContentType.TEXT,
              title: 'Document Not Found',
              content: `Could not find documentation for "${docSlug}".`,
            }
            openPanelWithTracking(errorContent, `doc-${docSlug}-error`)
          }
        } catch (error) {
          console.error('[ShowMore] Failed to fetch doc:', error)
          void debugLog({
            component: 'ChatNavigation',
            action: 'show_more_failed',
            metadata: { docSlug, reason: 'fetch_error' },
          })
        }
      })()
    },
    [openPanelWithTracking]
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

    // Track knownTerms fetch status for telemetry
    // Initialize from actual status (may be 'snapshot' on cold start)
    let knownTermsFetchStatus: 'snapshot' | 'cached' | 'fetched' | 'fetch_error' | 'fetch_timeout' =
      getKnownTermsFetchStatus() || 'cached'
    // TD-1: CORE_APP_TERMS fallback removed - SSR snapshot guarantees knownTerms availability
    const usedCoreAppTermsFallback = false // Kept for telemetry backwards compatibility

    try {
      // ---------------------------------------------------------------------------
      // Ensure knownTerms cache is populated before routing decisions
      // Fix for race condition: async useEffect fetch may not complete before routing
      // Timeout after 2s - SSR snapshot ensures knownTerms is still available
      // ---------------------------------------------------------------------------
      const FETCH_TIMEOUT_MS = 2000

      if (!isKnownTermsCacheValid()) {
        try {
          // Race fetch against timeout
          const timeoutPromise = new Promise<null>((resolve) =>
            setTimeout(() => resolve(null), FETCH_TIMEOUT_MS)
          )
          const result = await Promise.race([fetchKnownTerms(), timeoutPromise])

          if (result === null) {
            // Timeout - SSR snapshot should still have terms available
            knownTermsFetchStatus = 'fetch_timeout'
            console.warn('[KnownTerms] Fetch timed out, using SSR snapshot')
          } else if (result.size > 0) {
            knownTermsFetchStatus = 'fetched'
          } else {
            knownTermsFetchStatus = 'fetch_error'
          }
        } catch {
          knownTermsFetchStatus = 'fetch_error'
          console.error('[KnownTerms] Fetch failed in sendMessage, using SSR snapshot')
        }
      }

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
      // Step 3 refactor: Extracted to lib/chat/chat-routing.ts
      // ---------------------------------------------------------------------------
      const clarificationResult = await handleClarificationIntercept({
        trimmedInput,
        lastClarification,
        lastSuggestion,
        pendingOptions,
        uiContext,
        currentEntryId,
        addMessage,
        setLastClarification,
        setIsLoading,
        setPendingOptions,
        setPendingOptionsMessageId,
        setPendingOptionsGraceCount,
        setNotesScopeFollowUpActive,
        handleSelectOption,
      })
      const { clarificationCleared, isNewQuestionOrCommandDetected } = clarificationResult
      if (clarificationResult.handled) {
        return
      }

      // ---------------------------------------------------------------------------
      // Meta-Explain Outside Clarification: Handle "explain", "what do you mean?"
      // Step 3 refactor: Extracted to lib/chat/chat-routing.ts
      // ---------------------------------------------------------------------------
      const metaExplainResult = await handleMetaExplain({
        trimmedInput,
        docRetrievalState,
        messages,
        lastClarification,
        clarificationCleared,
        knownTermsFetchStatus,
        usedCoreAppTermsFallback,
        addMessage,
        updateDocRetrievalState,
        setIsLoading,
        setPendingOptions,
        setPendingOptionsMessageId,
        setLastClarification,
      })
      if (metaExplainResult.handled) {
        return
      }

      // ---------------------------------------------------------------------------
      // V4 Correction Handling: "no / not that" after doc retrieval
      // Per general-doc-retrieval-routing-plan.md (v4)
      // Step 3 refactor: Extracted to lib/chat/chat-routing.ts
      // ---------------------------------------------------------------------------
      const correctionResult = handleCorrection({
        trimmedInput,
        docRetrievalState,
        knownTermsFetchStatus,
        usedCoreAppTermsFallback,
        addMessage,
        updateDocRetrievalState,
        setIsLoading,
      })
      if (correctionResult.handled) {
        return
      }

      // ---------------------------------------------------------------------------
      // V5 Pronoun Follow-up: "tell me more" with HS2 expansion
      // Step 3 refactor: Extracted to lib/chat/chat-routing.ts
      // ---------------------------------------------------------------------------
      const followUpResult = await handleFollowUp({
        trimmedInput,
        docRetrievalState,
        isNewQuestionOrCommandDetected,
        knownTermsFetchStatus,
        usedCoreAppTermsFallback,
        addMessage,
        updateDocRetrievalState,
        setIsLoading,
      })
      // Extract classifier state for use in subsequent routing telemetry
      const {
        classifierCalled,
        classifierResult,
        classifierTimeout,
        classifierLatencyMs,
        classifierError,
      } = followUpResult
      const isFollowUp = followUpResult.handled
      if (followUpResult.handled) {
        return
      }

// ---------------------------------------------------------------------------
      // General Doc Retrieval Routing: Handle "what is X", "how do I X" queries
      // AND bare nouns like "notes", "widgets" (not action nouns like "recent")
      // Per general-doc-retrieval-routing-plan.md (v4)
      // Routes doc-style questions through retrieval for grounded answers.
      // ---------------------------------------------------------------------------
      const docRetrievalResult = await handleDocRetrieval({
        trimmedInput,
        uiContext,
        docRetrievalState,
        lastClarification,
        clarificationCleared,
        knownTermsFetchStatus,
        usedCoreAppTermsFallback,
        classifierCalled,
        classifierResult,
        classifierTimeout,
        classifierLatencyMs,
        classifierError,
        isNewQuestionOrCommandDetected,
        isFollowUp,
        addMessage,
        updateDocRetrievalState,
        setIsLoading,
        setPendingOptions,
        setPendingOptionsMessageId,
        setLastClarification,
      })
      if (docRetrievalResult.handled) {
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
      } else if (resolution.success && resolution.action !== 'error' && resolution.action !== 'answer_from_context' && resolution.action !== 'select' && resolution.action !== 'list_workspaces' && resolution.action !== 'clarify_type') {
        // Only clear clarification when an explicit action is executed (navigation, panel open, etc.)
        // NOT on every response without metadata - that would break the clarification flow
        // NOT on 'select', 'list_workspaces', 'clarify_type' - these SHOW options that need lastClarification preserved
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

  // Check if ViewPanel is open for side-by-side positioning
  const { state: viewPanelState } = useViewPanel()
  const isViewPanelOpen = viewPanelState.isOpen
  // Track which doc is currently displayed (for Show more button visibility)
  const viewPanelDocSlug = viewPanelState.isOpen ? viewPanelState.content?.docSlug : undefined

  // Calculate chat panel width - fixed size, ViewPanel positions next to it
  const chatPanelWidth = '360px'
  const viewPanelWidth = '500px'

  return (
    <>
      {/* Trigger button (only when showTrigger is true) */}
      {triggerButton}

      {/* Backdrop - click to close (only when chat is open) */}
      <div
        className="fixed inset-0 bg-black/20 z-40 transition-opacity duration-200"
        onClick={() => setOpen(false)}
        aria-hidden="true"
        style={{
          opacity: isOpen ? 1 : 0,
          pointerEvents: isOpen ? 'auto' : 'none',
        }}
      />

      {/* Chat Panel - Fixed on left */}
      <div
        className={cn(
          'fixed left-0 top-0 z-50',
          'h-screen',
          'bg-background/80 backdrop-blur-xl border-r border-white/10 shadow-2xl',
          'flex flex-col',
          'transition-transform duration-200',
          isOpen ? 'translate-x-0' : '-translate-x-full',
          className
        )}
        style={{ width: chatPanelWidth }}
      >
        {/* Chat content wrapper */}
        <div className="flex flex-col h-full">
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
                  <ChatMessageList
                    messages={messages}
                    initialMessageCount={initialMessageCount}
                    isLoading={isLoading}
                    onSelectOption={handleSelectOption}
                    onSuggestionClick={handleSuggestionClick}
                    onOpenPanelDrawer={openPanelDrawer}
                    onShowMore={handleShowMore}
                    viewPanelDocSlug={viewPanelDocSlug}
                  />
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
            {/* Step 4 refactor: Extracted to ChatInput component */}
            <ChatInput
              ref={inputRef}
              value={input}
              onChange={setInput}
              onSend={sendMessage}
              isLoading={isLoading}
            />
        </div>
      </div>

      {/* View Panel - Inline mode positioned next to chat panel (Claude-style side-by-side) */}
      <ViewPanel
        inline
        parentOpen={isOpen}
        inlineStyle={{
          left: chatPanelWidth,
          width: viewPanelWidth,
        }}
      />
    </>
  )
}
