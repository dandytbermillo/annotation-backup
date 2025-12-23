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
import { MessageSquare, Send, X, Loader2, ChevronRight } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Badge } from '@/components/ui/badge'
import { ScrollArea } from '@/components/ui/scroll-area'
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover'
import { cn } from '@/lib/utils'
import {
  useChatNavigation,
  type IntentResolutionResult,
  type WorkspaceMatch,
  type NoteMatch,
} from '@/lib/chat'
import { getActiveEntryContext } from '@/lib/entry/entry-context'
import { getActiveWorkspaceContext } from '@/lib/note-workspaces/state'

// =============================================================================
// Types
// =============================================================================

interface ChatMessage {
  id: string
  role: 'user' | 'assistant'
  content: string
  timestamp: Date
  options?: SelectionOption[]
  isError?: boolean
}

interface SelectionOption {
  type: 'workspace' | 'note'
  id: string
  label: string
  sublabel?: string
  data: WorkspaceMatch | NoteMatch
}

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
}: ChatNavigationPanelProps) {
  const [open, setOpen] = useState(false)
  const [input, setInput] = useState('')
  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [isLoading, setIsLoading] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)
  const scrollRef = useRef<HTMLDivElement>(null)

  const { executeAction, selectOption } = useChatNavigation({
    onNavigationComplete: () => {
      onNavigationComplete?.()
      setOpen(false)
    },
  })

  // Auto-focus input when popover opens
  useEffect(() => {
    if (open) {
      setTimeout(() => inputRef.current?.focus(), 100)
    }
  }, [open])

  // Scroll to bottom when messages change
  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight
    }
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
    setMessages((prev) => [...prev, userMessage])
    setInput('')
    setIsLoading(true)

    try {
      // Get context from props or fall back to module-level state
      const entryId = currentEntryId ?? getActiveEntryContext() ?? undefined
      const workspaceId = currentWorkspaceId ?? getActiveWorkspaceContext() ?? undefined

      // Call the navigate API
      const response = await fetch('/api/chat/navigate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          message: trimmedInput,
          currentEntryId: entryId,
          currentWorkspaceId: workspaceId,
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
      setMessages((prev) => [...prev, assistantMessage])
    } catch (error) {
      const errorMessage: ChatMessage = {
        id: `error-${Date.now()}`,
        role: 'assistant',
        content: 'Something went wrong. Please try again.',
        timestamp: new Date(),
        isError: true,
      }
      setMessages((prev) => [...prev, errorMessage])
    } finally {
      setIsLoading(false)
    }
  }, [input, isLoading, currentEntryId, currentWorkspaceId, executeAction])

  // ---------------------------------------------------------------------------
  // Handle Selection
  // ---------------------------------------------------------------------------

  const handleSelectOption = useCallback(
    async (option: SelectionOption) => {
      setIsLoading(true)

      try {
        const result = await selectOption({
          type: option.type,
          id: option.id,
          data: option.data,
        })

        const assistantMessage: ChatMessage = {
          id: `assistant-${Date.now()}`,
          role: 'assistant',
          content: result.message,
          timestamp: new Date(),
          isError: !result.success,
        }
        setMessages((prev) => [...prev, assistantMessage])
      } catch {
        const errorMessage: ChatMessage = {
          id: `error-${Date.now()}`,
          role: 'assistant',
          content: 'Failed to navigate. Please try again.',
          timestamp: new Date(),
          isError: true,
        }
        setMessages((prev) => [...prev, errorMessage])
      } finally {
        setIsLoading(false)
      }
    },
    [selectOption]
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
    setMessages([])
    setInput('')
  }, [])

  // ---------------------------------------------------------------------------
  // Render
  // ---------------------------------------------------------------------------

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        {trigger || (
          <Button variant="ghost" size="icon" className="h-8 w-8">
            <MessageSquare className="h-4 w-4" />
            <span className="sr-only">Open chat navigation</span>
          </Button>
        )}
      </PopoverTrigger>

      <PopoverContent
        className={cn('w-80 p-0', className)}
        align="end"
        sideOffset={8}
      >
        {/* Header */}
        <div className="flex items-center justify-between border-b px-3 py-2">
          <div className="flex items-center gap-2">
            <MessageSquare className="h-4 w-4 text-muted-foreground" />
            <span className="text-sm font-medium">Navigate</span>
          </div>
          <div className="flex items-center gap-1">
            {messages.length > 0 && (
              <Button
                variant="ghost"
                size="icon"
                className="h-6 w-6"
                onClick={clearChat}
              >
                <X className="h-3 w-3" />
                <span className="sr-only">Clear chat</span>
              </Button>
            )}
          </div>
        </div>

        {/* Messages */}
        <ScrollArea className="h-64" ref={scrollRef as any}>
          <div className="flex flex-col gap-3 p-3">
            {messages.length === 0 ? (
              <div className="text-center text-xs text-muted-foreground py-8">
                <p className="mb-2">Try saying:</p>
                <p className="italic">&quot;open workspace Research&quot;</p>
                <p className="italic">&quot;go to note Project Plan&quot;</p>
                <p className="italic">&quot;create workspace Sprint 12&quot;</p>
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
                      'rounded-lg px-3 py-2 text-sm max-w-[90%]',
                      message.role === 'user'
                        ? 'bg-primary text-primary-foreground'
                        : message.isError
                          ? 'bg-destructive/10 text-destructive'
                          : 'bg-muted'
                    )}
                  >
                    {message.content}
                  </div>

                  {/* Selection Pills */}
                  {message.options && message.options.length > 0 && (
                    <div className="flex flex-wrap gap-1 mt-1">
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
                <span className="text-xs">Processing...</span>
              </div>
            )}
          </div>
        </ScrollArea>

        {/* Input */}
        <div className="border-t p-2">
          <div className="flex items-center gap-2">
            <Input
              ref={inputRef}
              type="text"
              placeholder="Where would you like to go?"
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={handleKeyDown}
              disabled={isLoading}
              className="h-8 text-sm"
            />
            <Button
              size="icon"
              className="h-8 w-8 shrink-0"
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
      </PopoverContent>
    </Popover>
  )
}
