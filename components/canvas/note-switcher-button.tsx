"use client"

import { FileText } from "lucide-react"
import { cn } from "@/lib/utils"

interface NoteSwitcherButtonProps {
  noteCount: number
  isOpen: boolean
  onClick: () => void
  className?: string
}

/**
 * Compact icon button with badge that opens the note switcher popover.
 * Replaces the horizontal tab bar with a minimal footprint design.
 */
export function NoteSwitcherButton({
  noteCount,
  isOpen,
  onClick,
  className,
}: NoteSwitcherButtonProps) {
  return (
    <button
      type="button"
      className={cn(
        "relative flex h-9 w-9 items-center justify-center rounded-lg",
        "border border-neutral-700/80 bg-neutral-900/80 backdrop-blur-sm",
        "transition-all duration-150",
        "hover:border-neutral-600 hover:bg-neutral-800/90 hover:shadow-md",
        isOpen && "border-indigo-500/50 bg-indigo-500/10 shadow-lg shadow-indigo-500/20",
        className
      )}
      onClick={onClick}
      title={`Open Notes (${noteCount})`}
      aria-label={`Open notes (${noteCount} open)`}
      aria-expanded={isOpen}
      aria-haspopup="menu"
    >
      <FileText className="h-4 w-4 text-neutral-300" />

      {/* Badge */}
      {noteCount > 0 && (
        <span
          className={cn(
            "absolute -right-1.5 -top-1.5",
            "flex h-[18px] min-w-[18px] items-center justify-center",
            "rounded-full px-1",
            "text-[10px] font-bold",
            "transition-colors duration-150",
            isOpen
              ? "bg-indigo-500 text-white"
              : "bg-neutral-700 text-neutral-300"
          )}
        >
          {noteCount > 99 ? "99+" : noteCount}
        </span>
      )}
    </button>
  )
}
