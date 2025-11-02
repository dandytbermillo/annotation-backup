"use client"

import { useCallback, useMemo } from 'react'
import { useConstellationContext } from '@/components/constellation/constellation-context'
import { ConstellationItem } from '@/types/constellation'

export function ConstellationSidebarShared() {
  const {
    constellations,
    allItems,
    state,
    handleConstellationHighlight,
    handleItemClick,
  } = useConstellationContext()

  const centers = useMemo(
    () => allItems.filter(item => item.isCenter),
    [allItems]
  )

  const handleSelect = useCallback(
    (item: ConstellationItem) => {
      if (!item) return
      handleItemClick(item)

      const constellationId = item.constellation || item.id
      const newHighlight =
        state.highlightedConstellation === constellationId ? null : constellationId
      handleConstellationHighlight(newHighlight)
    },
    [handleConstellationHighlight, handleItemClick, state.highlightedConstellation]
  )

  if (!state.showSidebar) {
    return (
      <div className="flex h-full items-center justify-center px-4 text-sm text-white/60 bg-slate-900/95">
        Constellation sidebar hidden from canvas controls.
      </div>
    )
  }

  return (
    <div className="flex h-full flex-col bg-slate-900/95">
      <div className="px-4 py-4 border-b border-white/10">
        <h2 className="text-lg font-semibold text-blue-300">Universal Data Constellation</h2>
        <p className="text-xs text-white/60 mt-1">
          Your personal data universe organized by context
        </p>
        <div className="mt-3 flex gap-3 text-[11px] uppercase tracking-wide text-white/40">
          <span>Items: {allItems.length}</span>
          <span>Groups: {constellations.length}</span>
          <span>Connections: {Math.max(allItems.length - 1, 0) + 5}</span>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto">
        {centers.map(centerItem => {
          const isSelected = state.selectedItem?.id === centerItem.id
          const isHighlighted = state.highlightedConstellation === centerItem.constellation

          return (
            <button
              key={centerItem.id}
              onClick={() => handleSelect(centerItem)}
              className="w-full text-left transition-colors border-b border-white/5"
              style={{
                backgroundColor: isSelected ? 'rgba(51, 65, 85, 0.35)' : 'transparent',
              }}
            >
              <div className="flex items-center justify-between px-4 py-3">
                <div className="flex items-center gap-3">
                  <span className="text-lg">{centerItem.icon || '⭐'}</span>
                  <span
                    className="font-medium text-sm"
                    style={{ color: isHighlighted ? '#60a5fa' : '#e2e8f0' }}
                  >
                    {centerItem.title}
                  </span>
                </div>
                <span className="text-xs px-2 py-1 rounded bg-white/10 text-white/60">
                  {
                    allItems.filter(
                      item =>
                        item.constellation === centerItem.constellation && item.depthLayer === 2
                    ).length
                  }
                </span>
              </div>
            </button>
          )
        })}
      </div>
    </div>
  )
}
