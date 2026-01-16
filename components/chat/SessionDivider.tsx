/**
 * Session Divider Component
 * Part of: Step 4 Refactor (UI subcomponents extraction)
 *
 * Renders a divider between previous session messages and new messages.
 */

'use client'

import { Clock } from 'lucide-react'

/**
 * Renders a "Previous session" divider with clock icon.
 * Used to separate messages loaded from history vs new messages.
 */
export function SessionDivider() {
  return (
    <div className="flex items-center gap-3 py-4 my-2">
      <div className="flex-1 h-px bg-gradient-to-r from-transparent via-zinc-400 to-transparent" />
      <div className="flex items-center gap-1.5 text-[11px] uppercase tracking-wider text-zinc-500 font-semibold bg-zinc-100 px-3 py-1 rounded-full border border-zinc-200 shadow-sm">
        <Clock className="h-3.5 w-3.5" />
        <span>Previous session</span>
      </div>
      <div className="flex-1 h-px bg-gradient-to-l from-transparent via-zinc-400 to-transparent" />
    </div>
  )
}
