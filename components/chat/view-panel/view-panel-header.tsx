/**
 * View Panel Header
 *
 * Displays title, subtitle, and close button for the view panel.
 */

'use client'

import { X } from 'lucide-react'
import { useViewPanel } from '@/lib/chat/view-panel-context'

export function ViewPanelHeader() {
  const { state, closePanel } = useViewPanel()
  const { content } = state

  if (!content) return null

  return (
    <div className="flex items-start justify-between gap-3 px-4 py-3 border-b border-white/6 flex-shrink-0">
      <div className="flex flex-col gap-0.5 min-w-0">
        <h2
          className="text-sm font-semibold text-white truncate"
          data-testid="view-panel-title"
        >
          {content.title}
        </h2>
        {content.subtitle && (
          <p className="text-[11px] text-white/50">{content.subtitle}</p>
        )}
      </div>
      <button
        type="button"
        onClick={closePanel}
        className="flex items-center justify-center w-7 h-7 rounded-md text-white/60 hover:text-white hover:bg-white/8 transition-colors flex-shrink-0"
        aria-label="Close panel"
      >
        <X className="w-4 h-4" />
      </button>
    </div>
  )
}
