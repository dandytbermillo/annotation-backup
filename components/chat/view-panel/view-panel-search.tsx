/**
 * View Panel Search
 *
 * Search/filter bar for list content types.
 */

'use client'

import { Search, X } from 'lucide-react'
import { useViewPanel } from '@/lib/chat/view-panel-context'

export function ViewPanelSearch() {
  const { state, setSearchQuery } = useViewPanel()
  const { searchQuery } = state

  return (
    <div className="flex items-center gap-2 px-4 py-2 border-b border-white/6 flex-shrink-0">
      <div className="relative flex-1">
        <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-white/40" />
        <input
          type="text"
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          placeholder="Filter items..."
          className="w-full pl-8 pr-8 py-1.5 text-xs text-white bg-white/5 border border-white/10 rounded-lg placeholder:text-white/40 focus:outline-none focus:border-indigo-500/50 focus:bg-white/8 transition-colors"
          data-testid="view-panel-search"
        />
        {searchQuery && (
          <button
            type="button"
            onClick={() => setSearchQuery('')}
            className="absolute right-2 top-1/2 -translate-y-1/2 flex items-center justify-center w-4 h-4 rounded-full text-white/40 hover:text-white/60 hover:bg-white/10 transition-colors"
            aria-label="Clear search"
          >
            <X className="w-3 h-3" />
          </button>
        )}
      </div>
    </div>
  )
}
