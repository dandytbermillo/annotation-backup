/**
 * Date Header Component
 * Part of: Step 4 Refactor (UI subcomponents extraction)
 *
 * Renders a date divider between messages from different days.
 */

'use client'

import { cn } from '@/lib/utils'

export interface DateHeaderProps {
  /** The date to display */
  date: Date
  /** Whether this date is today */
  isToday: boolean
}

/**
 * Format a date for display in the header.
 * Returns "Today", "Yesterday", or formatted date.
 */
function formatDate(d: Date, isToday: boolean): string {
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

/**
 * Renders a date divider with styled badge.
 * Today's date gets a highlighted style.
 */
export function DateHeader({ date, isToday }: DateHeaderProps) {
  return (
    <div className="flex items-center gap-3 py-3 my-1">
      <div className="flex-1 h-px bg-zinc-200" />
      <div className={cn(
        "text-[11px] font-medium px-3 py-1 rounded-full border shadow-sm",
        isToday
          ? "text-indigo-600 bg-indigo-50 border-indigo-200"
          : "text-zinc-500 bg-zinc-50 border-zinc-200"
      )}>
        {formatDate(date, isToday)}
      </div>
      <div className="flex-1 h-px bg-zinc-200" />
    </div>
  )
}
