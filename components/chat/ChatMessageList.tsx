/**
 * Chat Message List Component
 * Part of: Step 4 Refactor (message rendering loop extraction)
 *
 * Renders the list of chat messages with date headers, session dividers,
 * selection pills, and suggestion pills.
 */

'use client'

import type { ReactNode } from 'react'
import { cn } from '@/lib/utils'
import type { ChatMessage, SelectionOption, ChatSuggestions } from '@/lib/chat'
import { MessageResultPreview } from './message-result-preview'
import { SelectionPills } from './SelectionPills'
import { SuggestionPills } from './SuggestionPills'
import { ShowMoreButton } from './ShowMoreButton'
import { DateHeader } from './DateHeader'
import { SessionDivider } from './SessionDivider'

// =============================================================================
// Date Helper Functions
// =============================================================================

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
// Simple Markdown Renderer
// =============================================================================

/**
 * Render simple markdown: **bold** only
 * Lightweight - no external dependencies
 */
function renderSimpleMarkdown(content: string): ReactNode {
  // Split by **bold** patterns while preserving the delimiters for processing
  const parts = content.split(/(\*\*[^*]+\*\*)/g)

  if (parts.length === 1) {
    // No bold markers found, return as-is
    return content
  }

  return parts.map((part, index) => {
    if (part.startsWith('**') && part.endsWith('**') && part.length > 4) {
      // Bold text - remove ** and wrap in <strong>
      const boldText = part.slice(2, -2)
      return <strong key={index} className="font-semibold">{boldText}</strong>
    }
    return part
  })
}

// =============================================================================
// Props Interface
// =============================================================================

export interface ChatMessageListProps {
  /** The messages to render */
  messages: ChatMessage[]
  /** Number of messages loaded from history (for session divider placement) */
  initialMessageCount: number
  /** Whether the chat is currently loading */
  isLoading: boolean
  /** Callback when a selection pill is clicked */
  onSelectOption: (option: SelectionOption) => void
  /** Callback when a suggestion pill is clicked */
  onSuggestionClick: (label: string, action: 'open' | 'list') => void
  /** Callback to open the panel drawer for "show all" */
  onOpenPanelDrawer?: (panelId: string, panelTitle?: string) => void
  /** Callback when "Show more" is clicked on a doc response (per show-more-button-spec.md) */
  onShowMore?: (docSlug: string, chunkId?: string) => void
}

// =============================================================================
// Component
// =============================================================================

/**
 * Renders the list of chat messages with all decorations.
 * Includes date headers, session dividers, and interactive pills.
 */
export function ChatMessageList({
  messages,
  initialMessageCount,
  isLoading,
  onSelectOption,
  onSuggestionClick,
  onOpenPanelDrawer,
  onShowMore,
}: ChatMessageListProps) {
  return (
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
                  // Match ViewPanel TextRenderer styling exactly
                  'rounded-lg p-4 max-w-[90%] font-mono overflow-hidden',
                  'whitespace-pre-wrap break-words',
                  message.role === 'user'
                    ? 'bg-zinc-900 text-white border border-white/10'
                    : message.isError
                      ? 'bg-red-950 text-red-200 border border-red-500/20'
                      : 'bg-slate-900 text-white/80 border border-white/10' // Solid dark like ViewPanel
                )}
                style={{
                  fontSize: '13px',
                  lineHeight: '20px',
                }}
              >
                {/* Render markdown for assistant messages, plain text for user/error */}
                {message.role === 'assistant' && !message.isError
                  ? renderSimpleMarkdown(message.content)
                  : message.content}
              </div>

              {/* Message Result Preview (for "Show all" view panel content) */}
              {message.previewItems && message.previewItems.length > 0 && message.viewPanelContent && (
                <MessageResultPreview
                  title={message.viewPanelContent.title}
                  previewItems={message.previewItems}
                  totalCount={message.totalCount ?? message.previewItems.length}
                  fullContent={message.viewPanelContent}
                  onShowAll={
                    message.drawerPanelId && onOpenPanelDrawer
                      ? () => onOpenPanelDrawer(message.drawerPanelId!, message.drawerPanelTitle)
                      : undefined
                  }
                />
              )}

              {/* Selection Pills */}
              {message.options && message.options.length > 0 && (
                <SelectionPills
                  options={message.options}
                  onSelect={onSelectOption}
                  disabled={isLoading}
                />
              )}

              {/* Suggestion Pills (typo recovery) */}
              {message.suggestions && message.suggestions.candidates.length > 0 && (
                <SuggestionPills
                  suggestions={message.suggestions}
                  onSuggestionClick={onSuggestionClick}
                  disabled={isLoading}
                />
              )}

              {/* Show More Button (doc responses only, per show-more-button-spec.md) */}
              {message.role === 'assistant' &&
                !message.isError &&
                message.docSlug &&
                !message.options?.length && // Don't show during disambiguation
                onShowMore && (
                  <ShowMoreButton
                    docSlug={message.docSlug}
                    chunkId={message.chunkId}
                    headerPath={message.headerPath}
                    onClick={onShowMore}
                    disabled={isLoading}
                  />
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
  )
}
