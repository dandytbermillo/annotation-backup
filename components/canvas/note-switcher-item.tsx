"use client"

import { X, Crosshair } from "lucide-react"
import { cn } from "@/lib/utils"

export interface OpenNoteItem {
  id: string
  title: string
  lastEditedAt: number // timestamp in ms
  isActive: boolean
  workspaceId: string
}

interface NoteSwitcherItemProps {
  note: OpenNoteItem
  onSelect: () => void
  onClose: () => void
  onCenter?: () => void
}

/**
 * Format relative time (e.g., "2m ago", "just now")
 */
function formatTimeAgo(timestamp: number): string {
  const now = Date.now()
  const seconds = Math.floor((now - timestamp) / 1000)

  if (seconds < 10) return "just now"
  if (seconds < 60) return `${seconds}s ago`

  const minutes = Math.floor(seconds / 60)
  if (minutes < 60) return `${minutes}m ago`

  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours}h ago`

  const days = Math.floor(hours / 24)
  if (days === 1) return "yesterday"
  if (days < 7) return `${days}d ago`

  // Fallback to date
  const date = new Date(timestamp)
  return date.toLocaleDateString(undefined, { month: "short", day: "numeric" })
}

/**
 * Individual note item in the switcher popover list.
 * Shows title, timestamp, and hover actions (center, close).
 */
export function NoteSwitcherItem({
  note,
  onSelect,
  onClose,
  onCenter,
}: NoteSwitcherItemProps) {
  const timeAgo = formatTimeAgo(note.lastEditedAt)

  return (
    <div
      className={cn(
        "group relative flex cursor-pointer items-center gap-3 border-b border-neutral-800 px-4 py-2.5",
        "transition-colors duration-100",
        "hover:bg-neutral-800/50",
        note.isActive && "bg-indigo-500/10"
      )}
      onClick={onSelect}
      role="menuitem"
      tabIndex={0}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault()
          onSelect()
        }
      }}
    >
      {/* Active indicator */}
      {note.isActive && (
        <div className="absolute left-0 top-0 bottom-0 w-0.5 bg-indigo-400" />
      )}

      {/* Note Info */}
      <div className="min-w-0 flex-1">
        <div
          className={cn(
            "truncate text-sm font-medium",
            note.isActive ? "text-indigo-300" : "text-neutral-200"
          )}
          title={note.title}
        >
          {note.title}
        </div>
        <div className="text-xs text-neutral-500">Edited {timeAgo}</div>
      </div>

      {/* Hover Actions */}
      <div className="flex items-center gap-1 opacity-0 transition-opacity group-hover:opacity-100">
        {/* Center button */}
        {onCenter && (
          <button
            type="button"
            className={cn(
              "flex h-6 w-6 items-center justify-center rounded",
              "border border-neutral-700 bg-neutral-800",
              "text-neutral-400 hover:border-neutral-600 hover:bg-neutral-700 hover:text-neutral-200",
              "transition-colors duration-100"
            )}
            onClick={(e) => {
              e.stopPropagation()
              onCenter()
            }}
            title="Center in view"
          >
            <Crosshair className="h-3 w-3" />
          </button>
        )}

        {/* Close button */}
        <button
          type="button"
          className={cn(
            "flex h-6 w-6 items-center justify-center rounded",
            "border border-neutral-700 bg-neutral-800",
            "text-neutral-400 hover:border-red-500/50 hover:bg-red-500/10 hover:text-red-400",
            "transition-colors duration-100"
          )}
          onClick={(e) => {
            e.stopPropagation()
            onClose()
          }}
          title="Close note"
        >
          <X className="h-3 w-3" />
        </button>
      </div>
    </div>
  )
}
