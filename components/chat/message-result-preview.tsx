/**
 * Message Result Preview
 *
 * Inline preview of results in chat messages with "Show all" button
 * to open the full content in the View Panel.
 */

'use client'

import { useViewPanel } from '@/lib/chat/view-panel-context'
import type { ViewPanelContent, ViewListItem } from '@/lib/chat/view-panel-types'
import { ChevronRight, Search, FileText, Edit3, Folder, Layers } from 'lucide-react'

interface MessageResultPreviewProps {
  title: string
  previewItems: ViewListItem[]
  totalCount: number
  fullContent: ViewPanelContent
  onShowAll?: () => void
}

export function MessageResultPreview({
  title,
  previewItems,
  totalCount,
  fullContent,
  onShowAll,
}: MessageResultPreviewProps) {
  const { togglePanel } = useViewPanel()
  const moreCount = totalCount - previewItems.length

  return (
    <div className="mt-2.5 bg-black/30 rounded-xl p-3 border border-white/6">
      <div className="flex items-center gap-1.5 text-xs font-semibold text-indigo-300 mb-2">
        <Search className="w-3 h-3" />
        {title}
      </div>

      <div className="flex flex-col gap-1.5">
        {previewItems.map((item) => (
          <PreviewItem key={item.id} item={item} />
        ))}

        {moreCount > 0 && (
          <div className="text-[11px] text-white/40 py-1">
            ...and {moreCount} more
          </div>
        )}
      </div>

      <button
        onClick={() => (onShowAll ? onShowAll() : togglePanel(fullContent))}
        className="
          flex items-center justify-center gap-1.5 w-full
          mt-2.5 py-2 px-3.5 rounded-lg
          bg-indigo-500/15 border border-indigo-500/30
          text-indigo-300 text-xs font-medium
          hover:bg-indigo-500/25 hover:border-indigo-500/50
          transition-colors
        "
      >
        <ChevronRight className="w-3.5 h-3.5" />
        Show all {totalCount} items
      </button>
    </div>
  )
}

interface PreviewItemProps {
  item: ViewListItem
}

function PreviewItem({ item }: PreviewItemProps) {
  const isNote = item.type === 'note'
  const Icon = getIconForType(item.type)

  const handleClick = () => {
    // Don't navigate for plain text notes (type === 'note')
    if (isNote) return

    // Navigate using chat-navigate-entry event
    // - Entry links have dashboardId → opens entry's dashboard
    // - Workspace links have only workspaceId → opens specific workspace
    // See: docs/flow/entry/quick-links-entry-links.md
    if (item.entryId) {
      window.dispatchEvent(new CustomEvent('chat-navigate-entry', {
        detail: {
          entryId: item.entryId,
          workspaceId: item.workspaceId,
          dashboardId: item.dashboardId,
        }
      }))
    }
  }

  return (
    <div
      onClick={handleClick}
      className={`
        flex items-center gap-2 px-2.5 py-1.5 rounded-md text-xs
        ${isNote
          ? 'bg-white/4 text-white/60 cursor-default'
          : 'bg-white/4 text-white/80 hover:bg-indigo-500/15 hover:text-indigo-200 cursor-pointer'
        }
        transition-colors
      `}
    >
      <Icon
        className={`w-3.5 h-3.5 flex-shrink-0 ${
          isNote ? 'text-amber-400' : 'text-white/50'
        }`}
      />
      <span className="truncate">{item.name}</span>
      {item.type !== 'note' && item.type !== 'link' && (
        <span className="text-[10px] text-white/30 flex-shrink-0">{item.type}</span>
      )}
    </div>
  )
}

function getIconForType(type: ViewListItem['type']) {
  switch (type) {
    case 'note':
      return Edit3
    case 'workspace':
      return Layers
    case 'entry':
      return Folder
    case 'link':
    case 'file':
    default:
      return FileText
  }
}
