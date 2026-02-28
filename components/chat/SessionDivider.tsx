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
      <div className="flex-1 h-px bg-gradient-to-r from-transparent via-cyan-600/25 to-transparent" />
      <div className="flex items-center gap-1.5 text-[11px] uppercase tracking-wider text-slate-400 font-semibold bg-slate-700/10 px-3 py-1 rounded-full border border-cyan-600/20">
        <Clock className="h-3.5 w-3.5" />
        <span>Previous session</span>
      </div>
      <div className="flex-1 h-px bg-gradient-to-l from-transparent via-cyan-600/25 to-transparent" />
    </div>
  )
}
