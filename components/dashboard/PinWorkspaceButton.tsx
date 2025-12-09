"use client"

/**
 * Pin Workspace Button Component
 * Part of Pinned Entries Feature - Phase 4
 *
 * Allows users to pin/unpin specific workspaces within a pinned entry
 * to preserve their state when switching between entries.
 *
 * Note: Workspaces can only be pinned if their parent entry is already pinned.
 */

import { useCallback, useState } from "react"
import { Pin, PinOff } from "lucide-react"
import { cn } from "@/lib/utils"
import { debugLog } from "@/lib/utils/debug-logger"
import {
  useWorkspacePinActions,
  useIsPinnedEntriesEnabled,
  showWorkspacePinnedToast,
  showWorkspaceUnpinnedToast,
  showAutoUnpinnedWorkspaceToast,
  showPinErrorToast,
} from "@/lib/navigation"

interface PinWorkspaceButtonProps {
  /** The entry ID that contains this workspace */
  entryId: string
  /** The workspace ID to pin/unpin */
  workspaceId: string
  /** Additional className */
  className?: string
  /** Size variant */
  size?: "xs" | "sm"
  /** Whether to show as icon-only (no background) */
  iconOnly?: boolean
}

export function PinWorkspaceButton({
  entryId,
  workspaceId,
  className,
  size = "xs",
  iconOnly = false,
}: PinWorkspaceButtonProps) {
  const isFeatureEnabled = useIsPinnedEntriesEnabled()
  const { isPinned, isEntryPinned, toggle } = useWorkspacePinActions(entryId, workspaceId)
  const [isAnimating, setIsAnimating] = useState(false)

  const handleClick = useCallback((e: React.MouseEvent) => {
    e.stopPropagation()
    e.preventDefault()

    void debugLog({
      component: "PinWorkspaceButton",
      action: "click_start",
      metadata: { entryId, workspaceId, isPinned, isEntryPinned },
    })

    if (!entryId || !workspaceId) {
      void debugLog({
        component: "PinWorkspaceButton",
        action: "click_error_missing_ids",
        metadata: { entryId, workspaceId },
      })
      return
    }

    if (!isEntryPinned) {
      void debugLog({
        component: "PinWorkspaceButton",
        action: "click_error_entry_not_pinned",
        metadata: { entryId, workspaceId },
      })
      return
    }

    // Trigger animation
    setIsAnimating(true)
    setTimeout(() => setIsAnimating(false), 300)

    void debugLog({
      component: "PinWorkspaceButton",
      action: "before_toggle",
      metadata: { entryId, workspaceId, isPinned },
    })

    const result = toggle()

    void debugLog({
      component: "PinWorkspaceButton",
      action: isPinned ? "unpin_workspace" : "pin_workspace",
      metadata: {
        entryId,
        workspaceId,
        success: result.success,
        error: result.error,
        autoUnpinnedWorkspace: result.autoUnpinnedWorkspace?.workspaceId,
      },
    })

    if (!result.success && result.error) {
      void debugLog({
        component: "PinWorkspaceButton",
        action: "toggle_failed",
        metadata: { error: result.error, entryId, workspaceId },
      })
      try {
        showPinErrorToast(result.error)
      } catch (toastError) {
        void debugLog({
          component: "PinWorkspaceButton",
          action: "toast_error",
          metadata: { error: String(toastError), toastType: "error" },
        })
      }
      return
    }

    // Show success toast
    void debugLog({
      component: "PinWorkspaceButton",
      action: "before_success_toast",
      metadata: { isPinned, willShow: isPinned ? "unpinned" : "pinned" },
    })

    try {
      if (isPinned) {
        showWorkspaceUnpinnedToast()
      } else {
        showWorkspacePinnedToast()
      }
    } catch (toastError) {
      void debugLog({
        component: "PinWorkspaceButton",
        action: "toast_error",
        metadata: { error: String(toastError), toastType: "success" },
      })
    }

    void debugLog({
      component: "PinWorkspaceButton",
      action: "after_success_toast",
      metadata: { entryId, workspaceId },
    })

    // Log and toast auto-unpinned workspace
    if (result.autoUnpinnedWorkspace) {
      void debugLog({
        component: "PinWorkspaceButton",
        action: "auto_unpinned_workspace",
        metadata: { workspaceId: result.autoUnpinnedWorkspace.workspaceId },
      })
      try {
        showAutoUnpinnedWorkspaceToast(result.autoUnpinnedWorkspace.workspaceId)
      } catch (toastError) {
        void debugLog({
          component: "PinWorkspaceButton",
          action: "toast_error",
          metadata: { error: String(toastError), toastType: "auto_unpinned" },
        })
      }
    }

    void debugLog({
      component: "PinWorkspaceButton",
      action: "click_complete",
      metadata: { entryId, workspaceId, success: result.success },
    })
  }, [entryId, workspaceId, isEntryPinned, isPinned, toggle])

  // Don't render if feature is disabled
  if (!isFeatureEnabled) {
    return null
  }

  // Don't render if entry is not pinned (can't pin workspace without pinned entry)
  if (!isEntryPinned) {
    return null
  }

  const iconSize = size === "xs" ? 12 : 14

  if (iconOnly) {
    return (
      <button
        onClick={handleClick}
        className={cn(
          "transition-all duration-150",
          isPinned
            ? "text-indigo-400 hover:text-indigo-300"
            : "text-white/50 hover:text-white/80",
          isAnimating && "scale-125",
          className
        )}
        title={isPinned ? "Unpin workspace" : "Pin workspace to preserve state"}
        aria-label={isPinned ? "Unpin workspace" : "Pin workspace"}
        aria-pressed={isPinned}
      >
        {isPinned ? (
          <Pin
            size={iconSize}
            className={cn("transition-transform", isAnimating && "rotate-12")}
            fill="currentColor"
          />
        ) : (
          <PinOff
            size={iconSize}
            className={cn("transition-transform", isAnimating && "-rotate-12")}
          />
        )}
      </button>
    )
  }

  const paddingClass = size === "xs" ? "p-1" : "p-1.5"

  return (
    <button
      onClick={handleClick}
      className={cn(
        "rounded-full border transition-all duration-150",
        paddingClass,
        isPinned
          ? "border-indigo-400/60 bg-indigo-500/20 text-indigo-300 hover:bg-indigo-500/30"
          : "border-white/10 bg-slate-900/80 text-white/70 hover:border-indigo-400/40 hover:bg-indigo-500/10 hover:text-indigo-200",
        isAnimating && "scale-110",
        className
      )}
      title={isPinned ? "Unpin workspace" : "Pin workspace to preserve state"}
      aria-label={isPinned ? "Unpin workspace" : "Pin workspace"}
      aria-pressed={isPinned}
    >
      {isPinned ? (
        <Pin
          size={iconSize}
          className={cn("transition-transform", isAnimating && "rotate-12")}
          fill="currentColor"
        />
      ) : (
        <PinOff
          size={iconSize}
          className={cn("transition-transform", isAnimating && "-rotate-12")}
        />
      )}
    </button>
  )
}

/**
 * Small pinned indicator dot for workspace items
 */
export function WorkspacePinnedDot({
  entryId,
  workspaceId,
  className,
}: {
  entryId: string
  workspaceId: string
  className?: string
}) {
  const isFeatureEnabled = useIsPinnedEntriesEnabled()
  const { isPinned, isEntryPinned } = useWorkspacePinActions(entryId, workspaceId)

  if (!isFeatureEnabled || !isEntryPinned || !isPinned) {
    return null
  }

  return (
    <span
      className={cn(
        "inline-flex items-center justify-center w-4 h-4 rounded-full",
        "bg-indigo-500/20 text-indigo-400",
        className
      )}
      title="Pinned workspace - state will be preserved"
    >
      <Pin size={8} fill="currentColor" />
    </span>
  )
}
