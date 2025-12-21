"use client"

import { Trash2, Pencil, Check, X } from "lucide-react"
import { cn } from "@/lib/utils"
import { useState, useRef, useEffect } from "react"

export interface WorkspaceItem {
  id: string
  name: string
  noteCount?: number
  updatedAt?: string | null
  isDefault?: boolean
  isActive: boolean
}

interface WorkspaceSwitcherItemProps {
  workspace: WorkspaceItem
  onSelect: () => void
  onDelete?: () => void
  onRename?: (newName: string) => void
  isDeleting?: boolean
}

/**
 * Format relative time (e.g., "2m ago", "just now")
 */
function formatTimeAgo(dateString: string | null | undefined): string {
  if (!dateString) return "Never saved"

  const date = new Date(dateString)
  if (isNaN(date.getTime())) return "Never saved"

  const now = Date.now()
  const timestamp = date.getTime()
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
  return date.toLocaleDateString(undefined, { month: "short", day: "numeric" })
}

/**
 * Individual workspace item in the switcher popover list.
 * Shows name, note count, timestamp, and hover actions (rename, delete).
 */
export function WorkspaceSwitcherItem({
  workspace,
  onSelect,
  onDelete,
  onRename,
  isDeleting = false,
}: WorkspaceSwitcherItemProps) {
  const [isRenaming, setIsRenaming] = useState(false)
  const [renameValue, setRenameValue] = useState(workspace.name)
  const inputRef = useRef<HTMLInputElement>(null)

  const timeAgo = formatTimeAgo(workspace.updatedAt)
  const canDelete = !workspace.isDefault && !isDeleting && onDelete

  useEffect(() => {
    if (isRenaming && inputRef.current) {
      inputRef.current.focus()
      inputRef.current.select()
    }
  }, [isRenaming])

  const handleRenameSubmit = () => {
    const trimmed = renameValue.trim()
    if (trimmed && trimmed !== workspace.name && onRename) {
      onRename(trimmed)
    }
    setIsRenaming(false)
    setRenameValue(workspace.name)
  }

  const handleRenameCancel = () => {
    setIsRenaming(false)
    setRenameValue(workspace.name)
  }

  return (
    <div
      className={cn(
        "group relative flex cursor-pointer items-center gap-3 border-b border-neutral-800 px-4 py-2.5",
        "transition-colors duration-100",
        "hover:bg-neutral-800/50",
        workspace.isActive && "bg-indigo-500/10"
      )}
      onClick={() => !isRenaming && onSelect()}
      role="menuitem"
      tabIndex={0}
      onKeyDown={(e) => {
        if (isRenaming) return
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault()
          onSelect()
        }
      }}
    >
      {/* Active indicator */}
      {workspace.isActive && (
        <div className="absolute left-0 top-0 bottom-0 w-0.5 bg-indigo-400" />
      )}

      {/* Workspace Info */}
      <div className="min-w-0 flex-1">
        {isRenaming ? (
          <div className="flex items-center gap-1">
            <input
              ref={inputRef}
              type="text"
              value={renameValue}
              onChange={(e) => setRenameValue(e.target.value)}
              onKeyDown={(e) => {
                e.stopPropagation()
                if (e.key === "Enter") {
                  e.preventDefault()
                  handleRenameSubmit()
                }
                if (e.key === "Escape") {
                  e.preventDefault()
                  handleRenameCancel()
                }
              }}
              onClick={(e) => e.stopPropagation()}
              className={cn(
                "flex-1 rounded bg-neutral-800 px-2 py-0.5 text-sm font-medium text-neutral-200",
                "border border-neutral-700 focus:border-indigo-500 focus:outline-none"
              )}
            />
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation()
                handleRenameSubmit()
              }}
              className="flex h-5 w-5 items-center justify-center rounded text-green-400 hover:bg-green-500/20"
            >
              <Check className="h-3 w-3" />
            </button>
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation()
                handleRenameCancel()
              }}
              className="flex h-5 w-5 items-center justify-center rounded text-neutral-400 hover:bg-neutral-700"
            >
              <X className="h-3 w-3" />
            </button>
          </div>
        ) : (
          <>
            <div className="flex items-center gap-2">
              <span
                className={cn(
                  "truncate text-sm font-medium",
                  workspace.isActive ? "text-indigo-300" : "text-neutral-200"
                )}
                title={workspace.name}
              >
                {workspace.name}
              </span>
              {workspace.isDefault && (
                <span className="rounded bg-neutral-800 px-1.5 py-0.5 text-[10px] font-medium text-neutral-500">
                  Default
                </span>
              )}
            </div>
            <div className="flex items-center gap-2 text-xs text-neutral-500">
              {typeof workspace.noteCount === "number" && (
                <span>{workspace.noteCount} note{workspace.noteCount !== 1 ? "s" : ""}</span>
              )}
              <span>Updated {timeAgo}</span>
            </div>
          </>
        )}
      </div>

      {/* Hover Actions */}
      {!isRenaming && (
        <div className="flex items-center gap-1 opacity-0 transition-opacity group-hover:opacity-100">
          {/* Rename button */}
          {onRename && (
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
                setIsRenaming(true)
              }}
              title="Rename workspace"
            >
              <Pencil className="h-3 w-3" />
            </button>
          )}

          {/* Delete button */}
          {canDelete && (
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
                onDelete()
              }}
              title="Delete workspace"
              disabled={isDeleting}
            >
              {isDeleting ? (
                <span className="text-[10px]">...</span>
              ) : (
                <Trash2 className="h-3 w-3" />
              )}
            </button>
          )}
        </div>
      )}
    </div>
  )
}
