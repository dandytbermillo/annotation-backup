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
import {
  useChatNavigation,
  useChatNavigationContext,
  type IntentResolutionResult,
  type ChatMessage,
  type SelectionOption,
  type WorkspaceMatch,
} from '@/lib/chat'
import { getActiveEntryContext } from '@/lib/entry/entry-context'
import { getActiveWorkspaceContext } from '@/lib/note-workspaces/state'

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

export function ChatNavigationPanel({
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

  // Auto-focus input when popover opens
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

    if (currentCount > prevCount && scrollRef.current) {
      if (isLoadingOlderRef.current) {
        // Older messages were prepended - preserve scroll position
        const scrollHeightAfter = scrollRef.current.scrollHeight
        const addedHeight = scrollHeightAfter - scrollHeightBeforeRef.current
        scrollRef.current.scrollTop = addedHeight
        isLoadingOlderRef.current = false
      } else {
        // New messages added at the end - scroll to bottom
        scrollRef.current.scrollTop = scrollRef.current.scrollHeight
      }
    }

    prevMessageCountRef.current = currentCount
  }, [messages])

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
      // Get context from props or fall back to module-level state
      const entryId = currentEntryId ?? getActiveEntryContext() ?? undefined
      const workspaceId = currentWorkspaceId ?? getActiveWorkspaceContext() ?? undefined

      // Normalize the input message before sending to LLM
      const normalizedMessage = normalizeUserMessage(trimmedInput)

      // Build conversation context from message history (use DB summary if available)
      const contextPayload = buildContextPayload(messages, conversationSummary)

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
          },
        }),
      })

      if (!response.ok) {
        throw new Error('Failed to process request')
      }

      const { resolution } = (await response.json()) as {
        resolution: IntentResolutionResult
      }

      // Execute the action
      const result = await executeAction(resolution)

      // Track successful actions for session state
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
              // Note: incrementOpenCount is NOT called here - DashboardView.handleWorkspaceSelectById
              // is the single source of truth for open counts (avoids double-counting)
            } else if (resolution.action === 'navigate_dashboard') {
              setLastAction({
                type: 'go_to_dashboard',
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
            }
            break
        }
      }

      // Create assistant message
      const assistantMessage: ChatMessage = {
        id: `assistant-${Date.now()}`,
        role: 'assistant',
        content: result.message,
        timestamp: new Date(),
        isError: !result.success,
        options:
          result.action === 'selected' && resolution.options
            ? resolution.options.map((opt) => ({
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
  }, [input, isLoading, currentEntryId, currentWorkspaceId, executeAction, messages, addMessage, setInput, sessionState, setLastAction])

  // ---------------------------------------------------------------------------
  // Handle Selection
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

        // Track successful actions for session state
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
                // Note: incrementOpenCount is NOT called here - DashboardView.handleWorkspaceSelectById
                // is the single source of truth for open counts (avoids double-counting)
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

      {/* Left-side overlay panel */}
      {isOpen && (
        <>
          {/* Backdrop - click to close */}
          <div
            className="fixed inset-0 bg-black/20 z-40"
            onClick={() => setOpen(false)}
            aria-hidden="true"
          />

          {/* Panel - Glassmorphism effect */}
          <div
            className={cn(
              'fixed left-0 top-0 z-50',
              'h-screen',
              'bg-background/80 backdrop-blur-xl border-r border-white/20 shadow-2xl',
              'flex flex-col',
              'animate-in slide-in-from-left duration-200',
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
      )}
    </>
  )
}
