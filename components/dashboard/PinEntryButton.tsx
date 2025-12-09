"use client"

/**
 * Pin Entry Button Component
 * Part of Pinned Entries Feature - Phase 3
 *
 * Allows users to pin/unpin entries to preserve their state when
 * switching between entries.
 */

import { useCallback, useState } from "react"
import { Pin, PinOff } from "lucide-react"
import { cn } from "@/lib/utils"
import { debugLog } from "@/lib/utils/debug-logger"
import {
  useEntryPinActions,
  useIsPinnedEntriesEnabled,
  showEntryPinnedToast,
  showEntryUnpinnedToast,
  showAutoUnpinnedEntryToast,
  showPinErrorToast,
} from "@/lib/navigation"

interface PinEntryButtonProps {
  /** The entry ID to pin/unpin */
  entryId: string
  /** The entry's dashboard workspace ID (required for pinning) */
  dashboardWorkspaceId: string
  /** Display name of the entry */
  entryName: string
  /** Entry icon (emoji or null) */
  entryIcon?: string | null
  /** Additional className */
  className?: string
  /** Whether to show text label alongside icon */
  showLabel?: boolean
  /** Size variant */
  size?: "sm" | "md"
}

export function PinEntryButton({
  entryId,
  dashboardWorkspaceId,
  entryName,
  entryIcon,
  className,
  showLabel = false,
  size = "sm",
}: PinEntryButtonProps) {
  const isFeatureEnabled = useIsPinnedEntriesEnabled()
  const { isPinned, toggle } = useEntryPinActions(entryId)
  const [isAnimating, setIsAnimating] = useState(false)

  const handleClick = useCallback((e: React.MouseEvent) => {
    e.stopPropagation()
    e.preventDefault()

    if (!entryId || !dashboardWorkspaceId) {
      console.warn("[PinEntryButton] Missing entryId or dashboardWorkspaceId")
      return
    }

    // Trigger animation
    setIsAnimating(true)
    setTimeout(() => setIsAnimating(false), 300)

    const result = toggle({
      dashboardWorkspaceId,
      entryName,
      entryIcon,
    })

    void debugLog({
      component: "PinEntryButton",
      action: isPinned ? "unpin_entry" : "pin_entry",
      metadata: {
        entryId,
        entryName,
        success: result.success,
        error: result.error,
        autoUnpinnedEntry: result.autoUnpinnedEntry?.entryId,
      },
    })

    if (!result.success && result.error) {
      console.error("[PinEntryButton] Toggle failed:", result.error)
      showPinErrorToast(result.error)
      return
    }

    // Show success toast
    if (isPinned) {
      showEntryUnpinnedToast(entryName)
    } else {
      showEntryPinnedToast(entryName)
    }

    // Show toast for auto-unpinned entry
    if (result.autoUnpinnedEntry) {
      console.log(
        `[PinEntryButton] Auto-unpinned "${result.autoUnpinnedEntry.entryName}" to make room`
      )
      showAutoUnpinnedEntryToast(result.autoUnpinnedEntry)
    }
  }, [entryId, dashboardWorkspaceId, entryName, entryIcon, isPinned, toggle])

  // Don't render if feature is disabled
  if (!isFeatureEnabled) {
    return null
  }

  const iconSize = size === "sm" ? 14 : 16
  const paddingClass = size === "sm" ? "p-1.5" : "p-2"

  return (
    <button
      onClick={handleClick}
      className={cn(
        "rounded-md transition-all duration-150",
        paddingClass,
        isPinned
          ? "text-indigo-400 hover:text-indigo-300 hover:bg-indigo-500/10"
          : "text-muted-foreground hover:text-foreground hover:bg-muted",
        isAnimating && "scale-110",
        className
      )}
      title={isPinned ? `Unpin ${entryName}` : `Pin ${entryName} to preserve state`}
      aria-label={isPinned ? `Unpin ${entryName}` : `Pin ${entryName}`}
      aria-pressed={isPinned}
    >
      <span className="flex items-center gap-1.5">
        {isPinned ? (
          <Pin
            size={iconSize}
            className={cn(
              "transition-transform",
              isAnimating && "rotate-12"
            )}
            fill="currentColor"
          />
        ) : (
          <PinOff
            size={iconSize}
            className={cn(
              "transition-transform",
              isAnimating && "-rotate-12"
            )}
          />
        )}
        {showLabel && (
          <span className="text-xs font-medium">
            {isPinned ? "Pinned" : "Pin"}
          </span>
        )}
      </span>
    </button>
  )
}

/**
 * Pinned indicator badge (for showing pinned status without button functionality)
 */
export function PinnedIndicator({
  entryId,
  className,
}: {
  entryId: string
  className?: string
}) {
  const isFeatureEnabled = useIsPinnedEntriesEnabled()
  const { isPinned } = useEntryPinActions(entryId)

  if (!isFeatureEnabled || !isPinned) {
    return null
  }

  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-xs",
        "bg-indigo-500/10 text-indigo-400 border border-indigo-500/20",
        className
      )}
      title="This entry is pinned - state will be preserved when switching"
    >
      <Pin size={10} fill="currentColor" />
      <span>Pinned</span>
    </span>
  )
}
