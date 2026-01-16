/**
 * Suggestion Pills Component
 * Part of: Step 4 Refactor (UI subcomponents extraction)
 *
 * Renders typo recovery suggestion pills with different modes:
 * - confirm_single: Dual action buttons (Open + List in chat)
 * - choose_multiple/low_confidence: Single button per candidate
 */

'use client'

import { ChevronRight } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { cn } from '@/lib/utils'
import type { ChatSuggestions, SuggestionCandidate } from '@/lib/chat'

export interface SuggestionPillsProps {
  /** Suggestions data from typo recovery */
  suggestions: ChatSuggestions
  /** Callback when a suggestion is clicked */
  onSuggestionClick: (label: string, action: 'open' | 'list') => void
  /** Whether interaction is disabled (loading state) */
  disabled?: boolean
}

/**
 * Renders typo recovery suggestion pills.
 * Handles different suggestion types with appropriate UI.
 */
export function SuggestionPills({ suggestions, onSuggestionClick, disabled = false }: SuggestionPillsProps) {
  if (!suggestions || suggestions.candidates.length === 0) {
    return null
  }

  const { type, candidates } = suggestions

  return (
    <div className="flex flex-wrap gap-1.5 mt-1.5">
      {/* Case A: High-confidence single match - show dual action buttons */}
      {type === 'confirm_single' && candidates.length === 1 && (
        <>
          {/* Open button - primary action */}
          <SuggestionButton
            candidate={candidates[0]}
            action="open"
            variant="secondary"
            disabled={disabled}
            onSuggestionClick={onSuggestionClick}
          />
          {/* List in chat button - preview action */}
          <button
            onClick={() => onSuggestionClick(candidates[0].label, 'list')}
            disabled={disabled}
            className="group"
          >
            <Badge
              variant="outline"
              className={cn(
                'cursor-pointer transition-colors',
                'hover:bg-primary hover:text-primary-foreground',
                'border-dashed text-muted-foreground',
                disabled && 'opacity-50 cursor-not-allowed'
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
      {(type !== 'confirm_single' || candidates.length > 1) &&
        candidates.map((candidate, idx) => (
          <SuggestionButton
            key={`suggestion-${idx}-${candidate.label}`}
            candidate={candidate}
            action="open"
            variant="outline"
            disabled={disabled}
            onSuggestionClick={onSuggestionClick}
          />
        ))}
    </div>
  )
}

// Internal component for suggestion buttons
interface SuggestionButtonProps {
  candidate: SuggestionCandidate
  action: 'open' | 'list'
  variant: 'secondary' | 'outline'
  disabled: boolean
  onSuggestionClick: (label: string, action: 'open' | 'list') => void
}

function SuggestionButton({
  candidate,
  action,
  variant,
  disabled,
  onSuggestionClick,
}: SuggestionButtonProps) {
  const label = variant === 'secondary'
    ? (candidate.primaryAction === 'list'
        ? `Show ${candidate.label}`
        : `Open ${candidate.label}`)
    : candidate.label

  return (
    <button
      onClick={() => onSuggestionClick(candidate.label, action)}
      disabled={disabled}
      className="group"
    >
      <Badge
        variant={variant}
        className={cn(
          'cursor-pointer transition-colors',
          'hover:bg-primary hover:text-primary-foreground',
          variant === 'outline' && 'border-dashed text-muted-foreground',
          disabled && 'opacity-50 cursor-not-allowed'
        )}
      >
        <span className="flex items-center gap-1">
          {label}
          <ChevronRight className="h-3 w-3 opacity-50 group-hover:opacity-100" />
        </span>
      </Badge>
    </button>
  )
}
