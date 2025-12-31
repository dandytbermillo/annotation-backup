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
import { MessageSquare, Send, X, Loader2, ChevronRight, PanelLeftClose } from 'lucide-react'
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

/**
 * Last preview state for "show all" shortcut
 */
interface LastPreviewState {
  source: string
  viewPanelContent: ViewPanelContent
  totalCount: number
  messageId: string
  createdAt: number
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
    // Persistence
    isLoadingHistory,
    hasMoreMessages,
    loadOlderMessages,
    conversationSummary,
  } = useChatNavigationContext()

  const { executeAction, selectOption } = useChatNavigation({
    onNavigationComplete: () => {
      onNavigationComplete?.()
      setOpen(false)
    },
  })

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
          })
        }

        // Open view panel if content available
        if (resolution.showInViewPanel && resolution.viewPanelContent) {
          openPanel(resolution.viewPanelContent)
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
  }, [currentEntryId, currentWorkspaceId, sessionState, executeAction, addMessage, openPanel])

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
    [selectOption, addMessage, setLastAction]
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

        openPanel(lastPreview.viewPanelContent)

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

              openPanel(lastPreview.viewPanelContent)

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
      // Hybrid Selection: Check for ordinal/label match if pending options exist
      // ---------------------------------------------------------------------------
      if (pendingOptions.length > 0 && !hasActionVerb(trimmedInput)) {
        // 1) Check ordinal first ("first", "second", "last", etc.)
        const ordinalIndex = parseOrdinal(trimmedInput)

        if (ordinalIndex !== null) {
          // Resolve the actual index (handle "last" = -1)
          const resolvedIndex = ordinalIndex === -1 ? pendingOptions.length : ordinalIndex

          // Validate index is in range
          if (resolvedIndex < 1 || resolvedIndex > pendingOptions.length) {
            const assistantMessage: ChatMessage = {
              id: `assistant-${Date.now()}`,
              role: 'assistant',
              content: `Please pick a number between 1 and ${pendingOptions.length}.`,
              timestamp: new Date(),
              isError: false,
            }
            addMessage(assistantMessage)
            setIsLoading(false)
            return
          }

          // Get the selected option
          const selectedOption = pendingOptions[resolvedIndex - 1]

          void debugLog({
            component: 'ChatNavigation',
            action: 'ordinal_selection',
            metadata: { ordinalIndex, resolvedIndex, selectedLabel: selectedOption.label },
          })

          // Use grace window: keep options for one more turn
          setPendingOptionsGraceCount(1)

          // Execute the selection directly via handleSelectOption
          const optionToSelect: SelectionOption = {
            type: selectedOption.type as SelectionOption['type'],
            id: selectedOption.id,
            label: selectedOption.label,
            sublabel: selectedOption.sublabel,
            data: selectedOption.data as SelectionOption['data'],
          }

          // Call handleSelectOption but don't await here - let it update state
          setIsLoading(false)
          handleSelectOption(optionToSelect)
          return
        }

        // 2) Check exact label/sublabel match (grace window feature)
        const exactMatch = findExactOptionMatch(trimmedInput, pendingOptions)

        if (exactMatch) {
          void debugLog({
            component: 'ChatNavigation',
            action: 'exact_label_match',
            metadata: { input: trimmedInput, matchedLabel: exactMatch.label },
          })

          // Use grace window: keep options for one more turn
          setPendingOptionsGraceCount(1)

          // Execute the selection directly
          const optionToSelect: SelectionOption = {
            type: exactMatch.type as SelectionOption['type'],
            id: exactMatch.id,
            label: exactMatch.label,
            sublabel: exactMatch.sublabel,
            data: exactMatch.data as SelectionOption['data'],
          }

          setIsLoading(false)
          handleSelectOption(optionToSelect)
          return
        }
      }

      // ---------------------------------------------------------------------------
      // Grace window expiry: if we had pending options but no match, decrement grace
      // ---------------------------------------------------------------------------
      if (pendingOptions.length > 0 && pendingOptionsGraceCount > 0) {
        // No match found, decrement grace count
        setPendingOptionsGraceCount(0)
        // Clear options after grace expires
        setPendingOptions([])
        setPendingOptionsMessageId(null)
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
          },
        }),
      })

      if (!response.ok) {
        throw new Error('Failed to process request')
      }

      const { resolution } = (await response.json()) as {
        resolution: IntentResolutionResult
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

        void debugLog({
          component: 'ChatNavigation',
          action: 'stored_pending_options',
          metadata: { count: newPendingOptions.length },
        })
      } else {
        // Clear pending options for non-selection intents
        if (pendingOptions.length > 0) {
          setPendingOptions([])
          setPendingOptionsMessageId(null)
          setPendingOptionsGraceCount(0)
        }
      }

      // Track successful actions for session state and show toast
      if (result.success && result.action) {
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
            } else if (resolution.action === 'navigate_entry' && resolution.entry) {
              setLastAction({
                type: 'open_entry',
                entryId: resolution.entry.id,
                entryName: resolution.entry.name,
                timestamp: now,
              })
              showEntryOpenedToast(resolution.entry.name)
              incrementOpenCount(resolution.entry.id, resolution.entry.name, 'entry')
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

      // Create assistant message
      // Include options for 'selected' (disambiguation pills) and 'clarify_type' (entry vs workspace)
      const showOptions = (result.action === 'selected' || resolution.action === 'clarify_type') && resolution.options
      const assistantMessage: ChatMessage = {
        id: `assistant-${Date.now()}`,
        role: 'assistant',
        content: result.message,
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
        // View panel content for "Show all" preview
        viewPanelContent: resolution.viewPanelContent,
        previewItems: resolution.previewItems,
        totalCount: resolution.totalCount,
      }
      addMessage(assistantMessage)

      // Store lastPreview for "show all" shortcut
      if (resolution.viewPanelContent && resolution.previewItems && resolution.previewItems.length > 0) {
        setLastPreview({
          source: resolution.viewPanelContent.title || 'preview',
          viewPanelContent: resolution.viewPanelContent,
          totalCount: resolution.totalCount || resolution.previewItems.length,
          messageId: assistantMessage.id,
          createdAt: Date.now(),
        })
      }

      // Open view panel if content is available
      if (resolution.showInViewPanel && resolution.viewPanelContent) {
        openPanel(resolution.viewPanelContent)
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
  }, [input, isLoading, currentEntryId, currentWorkspaceId, executeAction, messages, addMessage, setInput, sessionState, setLastAction, openPanel, conversationSummary, pendingOptions, pendingOptionsGraceCount, handleSelectOption, lastPreview])

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
                  messages.map((message) => (
                    <div
                      key={message.id}
                      className={cn(
                        'flex flex-col gap-1',
                        message.role === 'user' ? 'items-end' : 'items-start'
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
                    </div>
                  ))
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
