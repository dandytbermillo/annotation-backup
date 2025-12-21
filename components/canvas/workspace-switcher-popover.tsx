"use client"

import { useEffect, useRef, useCallback } from "react"
import { Layers, X, Plus } from "lucide-react"
import { cn } from "@/lib/utils"
import { WorkspaceSwitcherItem, type WorkspaceItem } from "./workspace-switcher-item"

interface WorkspaceSwitcherPopoverProps {
  workspaces: WorkspaceItem[]
  onSelectWorkspace: (workspaceId: string) => void
  onDeleteWorkspace?: (workspaceId: string) => void
  onRenameWorkspace?: (workspaceId: string, newName: string) => void
  onCreateWorkspace: () => void
  onClose: () => void
  isLoading?: boolean
  deletingWorkspaceId?: string | null
  disableCreate?: boolean
}

/**
 * Popover panel showing list of workspaces with actions.
 * Similar to NoteSwitcherPopover but for workspace management.
 */
export function WorkspaceSwitcherPopover({
  workspaces,
  onSelectWorkspace,
  onDeleteWorkspace,
  onRenameWorkspace,
  onCreateWorkspace,
  onClose,
  isLoading = false,
  deletingWorkspaceId = null,
  disableCreate = false,
}: WorkspaceSwitcherPopoverProps) {
  const popoverRef = useRef<HTMLDivElement>(null)

  // Focus first menuitem on mount for keyboard navigation
  useEffect(() => {
    // Small delay to ensure DOM is ready
    const timer = setTimeout(() => {
      const firstItem = popoverRef.current?.querySelector('[role="menuitem"]') as HTMLElement | null
      firstItem?.focus()
    }, 50)
    return () => clearTimeout(timer)
  }, [])

  // Keyboard navigation
  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      switch (e.key) {
        case "Escape":
          e.preventDefault()
          onClose()
          break
        case "ArrowDown":
          e.preventDefault()
          {
            const focused = document.activeElement
            const items = popoverRef.current?.querySelectorAll('[role="menuitem"]')
            if (items) {
              const currentIndex = Array.from(items).indexOf(focused as Element)
              const nextIndex = currentIndex < items.length - 1 ? currentIndex + 1 : 0
              ;(items[nextIndex] as HTMLElement)?.focus()
            }
          }
          break
        case "ArrowUp":
          e.preventDefault()
          {
            const focused = document.activeElement
            const items = popoverRef.current?.querySelectorAll('[role="menuitem"]')
            if (items) {
              const currentIndex = Array.from(items).indexOf(focused as Element)
              const prevIndex = currentIndex > 0 ? currentIndex - 1 : items.length - 1
              ;(items[prevIndex] as HTMLElement)?.focus()
            }
          }
          break
      }
    },
    [onClose]
  )

  return (
    <div
      ref={popoverRef}
      className={cn(
        "w-[340px] overflow-hidden rounded-xl",
        "border border-neutral-700/80 bg-neutral-900/95 backdrop-blur-xl",
        "shadow-2xl shadow-black/50"
      )}
      role="menu"
      aria-label="Workspaces"
      onKeyDown={handleKeyDown}
    >
      {/* Header */}
      <div className="flex items-center justify-between border-b border-neutral-800 px-4 py-3">
        <div className="flex items-center gap-2 font-semibold text-neutral-200">
          <Layers className="h-4 w-4 text-indigo-400" />
          <span>Workspaces</span>
          {workspaces.length > 0 && (
            <span className="rounded-full bg-neutral-800 px-2 py-0.5 text-xs font-medium text-neutral-400">
              {workspaces.length}
            </span>
          )}
        </div>
        <button
          type="button"
          className={cn(
            "flex h-6 w-6 items-center justify-center rounded",
            "text-neutral-500 hover:bg-neutral-800 hover:text-neutral-300",
            "transition-colors duration-100"
          )}
          onClick={onClose}
          title="Close"
        >
          <X className="h-4 w-4" />
        </button>
      </div>

      {/* Workspace List */}
      <div className="max-h-[400px] overflow-y-auto">
        {isLoading ? (
          <div className="flex items-center justify-center py-10">
            <div className="h-5 w-5 animate-spin rounded-full border-2 border-neutral-600 border-t-indigo-400" />
          </div>
        ) : workspaces.length === 0 ? (
          <div className="py-10 text-center">
            <Layers className="mx-auto mb-2 h-8 w-8 text-neutral-600" />
            <div className="text-sm text-neutral-500">No workspaces yet</div>
            <div className="mt-1 text-xs text-neutral-600">
              Click &quot;+ New Workspace&quot; to create one
            </div>
          </div>
        ) : (
          workspaces.map((workspace) => (
            <WorkspaceSwitcherItem
              key={workspace.id}
              workspace={workspace}
              onSelect={() => {
                onSelectWorkspace(workspace.id)
                onClose()
              }}
              onDelete={onDeleteWorkspace ? () => onDeleteWorkspace(workspace.id) : undefined}
              onRename={onRenameWorkspace ? (newName) => onRenameWorkspace(workspace.id, newName) : undefined}
              isDeleting={deletingWorkspaceId === workspace.id}
            />
          ))
        )}
      </div>

      {/* Footer */}
      <div className="flex items-center justify-between border-t border-neutral-800 px-4 py-2.5">
        <span className="text-xs text-neutral-600">
          Click to switch workspace
        </span>
        <button
          type="button"
          className={cn(
            "flex items-center gap-1.5 rounded-md px-3 py-1.5",
            "border border-indigo-500/30 bg-indigo-500/10",
            "text-xs font-medium text-indigo-400",
            "transition-colors duration-150",
            "hover:border-indigo-500/50 hover:bg-indigo-500/20 hover:text-indigo-300",
            "disabled:opacity-50 disabled:cursor-not-allowed"
          )}
          onClick={() => {
            onCreateWorkspace()
            onClose()
          }}
          disabled={disableCreate}
        >
          <Plus className="h-3 w-3" />
          New Workspace
        </button>
      </div>
    </div>
  )
}
