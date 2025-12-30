/**
 * Mixed List Renderer
 *
 * Quick Links content with both links (selectable) and plain text notes (non-selectable).
 * Links have blue accent and checkboxes.
 * Notes have yellow/amber accent and no selection.
 */

'use client'

import { useViewPanel } from '@/lib/chat/view-panel-context'
import type { ViewListItem } from '@/lib/chat/view-panel-types'
import { FileText, Edit3, ChevronRight, Check } from 'lucide-react'

export function MixedListRenderer() {
  const { filteredItems, state, toggleItemSelection } = useViewPanel()

  if (filteredItems.length === 0) {
    return (
      <div className="flex items-center justify-center h-32 text-white/40 text-sm">
        No items found
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-2">
      {filteredItems.map((item) => (
        <MixedListItem
          key={item.id}
          item={item}
          isSelected={state.selectedItems.has(item.id)}
          onToggle={() => toggleItemSelection(item.id)}
        />
      ))}
    </div>
  )
}

interface MixedListItemProps {
  item: ViewListItem
  isSelected: boolean
  onToggle: () => void
}

function MixedListItem({ item, isSelected, onToggle }: MixedListItemProps) {
  const isNote = item.type === 'note'
  const isSelectable = item.isSelectable !== false && !isNote

  return (
    <div
      className={`
        group flex items-center justify-between
        px-3.5 py-3 rounded-xl
        border transition-all duration-150
        ${isNote
          ? 'border-l-[3px] border-l-amber-500/50 border-t-white/6 border-r-white/6 border-b-white/6 bg-white/3 cursor-default'
          : isSelected
            ? 'border-indigo-500/40 bg-indigo-500/15 cursor-pointer'
            : 'border-white/6 bg-white/3 hover:border-indigo-500/30 hover:bg-indigo-500/10 cursor-pointer'
        }
      `}
      onClick={isSelectable ? onToggle : undefined}
      data-testid="view-list-item"
      data-type={item.type}
    >
      <div className="flex items-center gap-3 flex-1 min-w-0">
        {/* Checkbox (only for links) */}
        {isSelectable && (
          <div
            className={`
              w-[18px] h-[18px] rounded-[5px] border-2 flex-shrink-0
              flex items-center justify-center transition-all
              ${isSelected
                ? 'bg-indigo-500 border-indigo-500'
                : 'border-white/20 bg-transparent'
              }
            `}
          >
            {isSelected && <Check className="w-3 h-3 text-white" strokeWidth={3} />}
          </div>
        )}

        {/* Icon */}
        {isNote ? (
          <Edit3 className="w-[18px] h-[18px] text-amber-400 flex-shrink-0" />
        ) : (
          <FileText className="w-[18px] h-[18px] text-white/50 flex-shrink-0" />
        )}

        {/* Content */}
        <div className="flex flex-col gap-0.5 min-w-0">
          <span className="text-[13px] font-medium text-white/90 truncate">
            {item.name}
          </span>
          <div className="flex items-center gap-2">
            <span
              className={`
                text-[10px] font-semibold uppercase tracking-wide px-1.5 py-0.5 rounded
                ${isNote
                  ? 'bg-amber-500/20 text-amber-400'
                  : 'bg-indigo-500/20 text-indigo-300'
                }
              `}
            >
              {isNote ? 'Note' : 'Link'}
            </span>
            {item.meta && (
              <span className="text-[11px] text-white/50">{item.meta}</span>
            )}
          </div>
        </div>
      </div>

      {/* Arrow (only for links) */}
      {isSelectable && (
        <ChevronRight
          className={`
            w-4 h-4 text-white/30 flex-shrink-0 transition-all
            group-hover:translate-x-0.5 group-hover:text-indigo-400
          `}
        />
      )}
    </div>
  )
}
