/**
 * Chat Message List Component
 * Part of: Step 4 Refactor (message rendering loop extraction)
 *
 * Renders the list of chat messages with date headers, session dividers,
 * selection pills, and suggestion pills.
 */

'use client'

import type { ReactNode } from 'react'
import { Bot, User } from 'lucide-react'
import { cn } from '@/lib/utils'
import type { ChatMessage, SelectionOption, ChatSuggestions, ChatProvenance } from '@/lib/chat'
import { MessageResultPreview } from './message-result-preview'
import { SelectionPills } from './SelectionPills'
import { SuggestionPills } from './SuggestionPills'
import { ShowMoreButton } from './ShowMoreButton'
import { DateHeader } from './DateHeader'
import { SessionDivider } from './SessionDivider'

// =============================================================================
// Dev-only Provenance Badge (per provenance-debug-overlay plan)
// =============================================================================

const PROVENANCE_STYLES: Record<ChatProvenance, { emoji: string; label: string; className: string }> = {
  deterministic: { emoji: '\u2705', label: 'Deterministic', className: 'bg-green-900/50 text-green-300 border-green-600/30' },
  llm_executed: { emoji: '\uD83E\uDDE0', label: 'Auto-Executed', className: 'bg-blue-900/50 text-blue-300 border-blue-600/30' },
  llm_influenced: { emoji: '\u2705\uD83E\uDDE0', label: 'LLM-Influenced', className: 'bg-yellow-900/50 text-yellow-300 border-yellow-600/30' },
  llm_clarifier: { emoji: '\uD83D\uDDE8\uFE0F\uD83E\uDDE0', label: 'LLM-Clarifier', className: 'bg-orange-900/50 text-orange-300 border-orange-600/30' },
  safe_clarifier: { emoji: '\uD83D\uDDE8\uFE0F', label: 'Safe Clarifier', className: 'bg-gray-800 text-gray-100 border-gray-500/60' },
}

function ProvenanceBadge({ provenance }: { provenance: ChatProvenance }) {
  const style = PROVENANCE_STYLES[provenance]
  return (
    <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-mono border ${style.className} mt-1`}>
      {style.emoji} {style.label}
    </span>
  )
}

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

/**
 * Format time as HH:MM (24h) for message timestamps
 */
function formatTime(date: Date): string {
  return date.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: false })
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
      return <strong key={index} className="font-semibold text-white">{boldText}</strong>
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
  /** Callback when "Show more" is clicked on a doc/note response (per show-more-button-spec.md) */
  onShowMore?: (docSlug?: string, itemId?: string, chunkId?: string) => void
  /** The docSlug currently displayed in ViewPanel (hides "Show more" for that doc only) */
  viewPanelDocSlug?: string
  /** The itemId currently displayed in ViewPanel (hides "Show more" for that note only) */
  viewPanelItemId?: string
  /** Dev-only: routing provenance per assistant message ID */
  provenanceMap?: Map<string, ChatProvenance>
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
  viewPanelDocSlug,
  viewPanelItemId,
  provenanceMap,
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
            {/* Message row: avatar + bubble */}
            <div
              className={cn(
                'flex items-start gap-2 w-full',
                index < initialMessageCount && 'opacity-75'
              )}
            >
              {/* Assistant avatar — left side */}
              {message.role === 'assistant' && (
                <div
                  className="w-8 h-8 rounded-full shrink-0 flex items-center justify-center border mt-1 border-blue-400/25 bg-slate-700/20"
                  style={{ color: '#94a3b8' }}
                >
                  <Bot className="h-4 w-4" />
                </div>
              )}

              {/* Spacer — pushes user messages to the right */}
              {message.role === 'user' && <div className="flex-1" />}

              {/* Bubble + pills column */}
              <div
                className={cn(
                  'flex flex-col gap-1 min-w-0 max-w-[85%]',
                  message.role === 'user' ? 'items-end' : 'items-start',
                )}
              >
                <div
                  className={cn(
                    // Glass bubble styling (AR HUD inspired)
                    'rounded-lg p-4 max-w-full font-mono backdrop-blur-sm',
                    // User messages: no overflow-hidden to prevent text clipping
                    // Assistant messages: overflow-hidden for consistent card appearance
                    message.role === 'user'
                      ? 'bg-cyan-900/20 text-slate-100 border border-cyan-500/25'
                      : 'overflow-hidden ' + (message.isError
                        ? 'bg-red-900/20 text-red-300 border border-red-500/25'
                        : 'bg-slate-700/15 text-slate-200 border border-blue-300/20')
                  )}
                  style={{
                    fontSize: '13px',
                    lineHeight: '20px',
                    wordBreak: 'break-word',
                    overflowWrap: 'break-word',
                    whiteSpace: 'pre-wrap',
                    // Force text color inline to override inherited light-mode body color
                    color: message.role === 'user'
                      ? '#f1f5f9'  // slate-100
                      : message.isError
                        ? '#fca5a5' // red-300
                        : '#e2e8f0', // slate-200
                  }}
                >
                  {/* Render markdown for assistant messages, plain text for user/error */}
                  {message.role === 'assistant' && !message.isError
                    ? renderSimpleMarkdown(message.content)
                    : message.content}
                </div>

                {/* Timestamp below bubble */}
                <span
                  className="text-[10px] font-mono px-1"
                  style={{ color: 'rgba(148, 163, 184, 0.5)' }}
                >
                  {formatTime(message.timestamp)}
                </span>

                {/* Dev-only: Provenance debug badge */}
                {provenanceMap && message.role === 'assistant' && provenanceMap.has(message.id) && (
                  <ProvenanceBadge provenance={provenanceMap.get(message.id)!} />
                )}

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

                {/* Show More Button (doc/note responses, per show-more-button-spec.md) */}
                {message.role === 'assistant' &&
                  !message.isError &&
                  (message.docSlug || message.itemId) &&
                  !message.options?.length && // Don't show during disambiguation
                  // Hide if ViewPanel shows THIS resource
                  !(message.docSlug && viewPanelDocSlug === message.docSlug) &&
                  !(message.itemId && viewPanelItemId === message.itemId) &&
                  onShowMore && (
                    <ShowMoreButton
                      docSlug={message.docSlug}
                      itemId={message.itemId}
                      itemName={message.itemName}
                      chunkId={message.chunkId}
                      headerPath={message.headerPath}
                      onClick={onShowMore}
                      disabled={isLoading}
                    />
                  )}
              </div>

              {/* User avatar — right side */}
              {message.role === 'user' && (
                <div
                  className="w-8 h-8 rounded-full shrink-0 flex items-center justify-center border mt-1 border-cyan-500/30 bg-cyan-900/20"
                  style={{ color: '#22d3ee' }}
                >
                  <User className="h-4 w-4" />
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
  )
}
