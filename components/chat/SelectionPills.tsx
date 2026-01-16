/**
 * Selection Pills Component
 * Part of: Step 4 Refactor (UI subcomponents extraction)
 *
 * Renders clickable option pills for chat message selections.
 */

'use client'

import { ChevronRight } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { cn } from '@/lib/utils'
import type { SelectionOption } from '@/lib/chat'

export interface SelectionPillsProps {
  /** Options to display as pills */
  options: SelectionOption[]
  /** Callback when an option is selected */
  onSelect: (option: SelectionOption) => void
  /** Whether interaction is disabled (loading state) */
  disabled?: boolean
}

/**
 * Renders a row of clickable selection pills.
 * Used for workspace/note/doc disambiguation.
 */
export function SelectionPills({ options, onSelect, disabled = false }: SelectionPillsProps) {
  if (!options || options.length === 0) {
    return null
  }

  return (
    <div className="flex flex-wrap gap-1.5 mt-1.5">
      {options.map((option) => (
        <button
          key={option.id}
          onClick={() => onSelect(option)}
          disabled={disabled}
          className="group"
        >
          <Badge
            variant="secondary"
            className={cn(
              'cursor-pointer transition-colors',
              'hover:bg-primary hover:text-primary-foreground',
              disabled && 'opacity-50 cursor-not-allowed'
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
  )
}
