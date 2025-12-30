/**
 * List Renderer
 *
 * Standard selectable list for search results, workspaces, entries.
 */

'use client'

import { useViewPanel } from '@/lib/chat/view-panel-context'
import type { ViewListItem } from '@/lib/chat/view-panel-types'
import { FileText, Folder, Layers, File, Check, ChevronRight } from 'lucide-react'

export function ListRenderer() {
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
        <ListItem
          key={item.id}
          item={item}
          isSelected={state.selectedItems.has(item.id)}
          onToggle={() => toggleItemSelection(item.id)}
        />
      ))}
    </div>
  )
}

interface ListItemProps {
  item: ViewListItem
  isSelected: boolean
  onToggle: () => void
}

function ListItem({ item, isSelected, onToggle }: ListItemProps) {
  const Icon = getIconForType(item.type)

  return (
    <div
      className={`
        group flex items-center justify-between
        px-3.5 py-3 rounded-xl
        border transition-all duration-150 cursor-pointer
        ${isSelected
          ? 'border-indigo-500/40 bg-indigo-500/15'
          : 'border-white/6 bg-white/3 hover:border-indigo-500/30 hover:bg-indigo-500/10'
        }
      `}
      onClick={onToggle}
      data-testid="view-list-item"
    >
      <div className="flex items-center gap-3 flex-1 min-w-0">
        {/* Checkbox */}
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

        {/* Icon */}
        <Icon className="w-[18px] h-[18px] text-white/50 flex-shrink-0" />

        {/* Content */}
        <div className="flex flex-col gap-0.5 min-w-0">
          <span className="text-[13px] font-medium text-white/90 truncate">
            {item.name}
          </span>
          {item.meta && (
            <span className="text-[11px] text-white/50">{item.meta}</span>
          )}
        </div>
      </div>

      {/* Arrow */}
      <ChevronRight
        className={`
          w-4 h-4 text-white/30 flex-shrink-0 transition-all
          group-hover:translate-x-0.5 group-hover:text-indigo-400
        `}
      />
    </div>
  )
}

function getIconForType(type: ViewListItem['type']) {
  switch (type) {
    case 'workspace':
      return Layers
    case 'entry':
      return Folder
    case 'file':
      return File
    case 'note':
    case 'link':
    default:
      return FileText
  }
}
