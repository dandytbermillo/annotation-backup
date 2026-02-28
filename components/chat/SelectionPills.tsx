/**
 * Selection Pills Component
 * Part of: Step 4 Refactor (UI subcomponents extraction)
 *
 * Renders clickable option pills for chat message selections.
 * Glass card layout with numbered badges (AR HUD inspired).
 */

'use client'

import { ChevronRight } from 'lucide-react'
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
 * Renders a column of clickable glass option cards with number badges.
 * Used for workspace/note/doc disambiguation.
 */
export function SelectionPills({ options, onSelect, disabled = false }: SelectionPillsProps) {
  if (!options || options.length === 0) {
    return null
  }

  return (
    <div className="flex flex-col gap-1.5 mt-2 max-w-[90%]">
      {options.map((option, index) => (
        <button
          key={option.id}
          onClick={() => onSelect(option)}
          disabled={disabled}
          className={cn(
            'group flex items-center gap-2.5 px-2.5 py-2 rounded-lg text-left',
            'bg-cyan-900/10 border border-cyan-600/20',
            'hover:border-cyan-400/40 hover:bg-cyan-800/15',
            'transition-all duration-200',
            disabled && 'opacity-40 cursor-not-allowed'
          )}
        >
          {/* Number badge */}
          <span className={cn(
            'w-7 h-7 rounded-lg shrink-0 flex items-center justify-center',
            'bg-cyan-800/15 border border-cyan-500/35',
            'text-cyan-400 text-xs font-semibold',
            'group-hover:bg-cyan-700/25 group-hover:border-cyan-400/50',
            'group-hover:text-cyan-300 transition-all duration-200'
          )}>
            {index + 1}
          </span>
          {/* Label + sublabel */}
          <span className="flex-1 min-w-0">
            <span className="block text-xs font-medium text-slate-200 truncate">
              {option.label}
            </span>
            {option.sublabel && (
              <span className="block text-[10px] text-slate-400/60">
                {option.sublabel}
              </span>
            )}
          </span>
          {/* Arrow */}
          <ChevronRight className={cn(
            'h-3.5 w-3.5 shrink-0',
            'text-cyan-500/30 group-hover:text-cyan-400/60',
            'group-hover:translate-x-0.5 transition-all duration-200'
          )} />
        </button>
      ))}
    </div>
  )
}
