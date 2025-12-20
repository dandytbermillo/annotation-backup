"use client"

import { useState, useEffect, useRef, useCallback } from "react"
import { Grid3x3, Plus, Clock, Layout, Puzzle } from "lucide-react"
import { cn } from "@/lib/utils"

interface WorkspaceControlCenterToggleProps {
  /** Callback to create a new note */
  onCreateNote?: () => void
  /** Callback to open recent notes panel */
  onOpenRecent?: () => void
  /** Callback to toggle constellation/canvas view */
  onToggleCanvas?: () => void
  /** Whether constellation panel is currently visible */
  showConstellationPanel?: boolean
  /** Callback to open component picker */
  onOpenComponentPicker?: () => void
  /** Whether to show the toggle (hide when canvas has its own Control Center) */
  visible?: boolean
  /** Additional class names */
  className?: string
}

/**
 * Minimal Control Center toggle for workspace level.
 * Shows when the canvas doesn't render its own Control Center (e.g., no notes open).
 * Provides quick access to: +Note, Recent, Canvas toggle, Components.
 */
export function WorkspaceControlCenterToggle({
  onCreateNote,
  onOpenRecent,
  onToggleCanvas,
  showConstellationPanel = false,
  onOpenComponentPicker,
  visible = true,
  className,
}: WorkspaceControlCenterToggleProps) {
  const [isOpen, setIsOpen] = useState(false)
  const containerRef = useRef<HTMLDivElement>(null)

  // Close on outside click
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
        setIsOpen(false)
      }
    }

    if (isOpen) {
      document.addEventListener("mousedown", handleClickOutside)
      return () => document.removeEventListener("mousedown", handleClickOutside)
    }
  }, [isOpen])

  // Close on Escape
  useEffect(() => {
    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === "Escape" && isOpen) {
        setIsOpen(false)
      }
    }
    document.addEventListener("keydown", handleEscape)
    return () => document.removeEventListener("keydown", handleEscape)
  }, [isOpen])

  const handleAction = useCallback((action?: () => void) => {
    action?.()
    setIsOpen(false)
  }, [])

  if (!visible) return null

  const actions = [
    {
      icon: Plus,
      label: "+ Note",
      onClick: () => handleAction(onCreateNote),
      color: "text-green-400",
      hoverBg: "hover:bg-green-500/20",
    },
    {
      icon: Clock,
      label: "Recent",
      onClick: () => handleAction(onOpenRecent),
      color: "text-blue-400",
      hoverBg: "hover:bg-blue-500/20",
    },
    {
      icon: Layout,
      label: showConstellationPanel ? "Canvas" : "Constellation",
      onClick: () => handleAction(onToggleCanvas),
      color: showConstellationPanel ? "text-purple-400" : "text-indigo-400",
      hoverBg: showConstellationPanel ? "hover:bg-purple-500/20" : "hover:bg-indigo-500/20",
      active: showConstellationPanel,
    },
    {
      icon: Puzzle,
      label: "Components",
      onClick: () => handleAction(onOpenComponentPicker),
      color: "text-orange-400",
      hoverBg: "hover:bg-orange-500/20",
    },
  ]

  return (
    <div
      ref={containerRef}
      className={cn("fixed bottom-6 right-6 z-[9998]", className)}
    >
      {/* Action Panel */}
      {isOpen && (
        <div
          className={cn(
            "absolute bottom-14 right-0 mb-2",
            "w-[180px] overflow-hidden rounded-xl",
            "border border-neutral-700/80 bg-neutral-900/95 backdrop-blur-xl",
            "shadow-2xl shadow-black/50"
          )}
        >
          {actions.map((action, index) => (
            <button
              key={index}
              type="button"
              onClick={action.onClick}
              className={cn(
                "flex w-full items-center gap-3 px-4 py-3",
                "border-b border-neutral-800 last:border-b-0",
                "transition-colors duration-100",
                action.hoverBg,
                action.active && "bg-white/5"
              )}
            >
              <action.icon className={cn("h-4 w-4", action.color)} />
              <span className="text-sm font-medium text-neutral-200">
                {action.label}
              </span>
            </button>
          ))}
        </div>
      )}

      {/* Toggle Button */}
      <button
        type="button"
        onClick={() => setIsOpen(!isOpen)}
        className={cn(
          "flex h-12 w-12 items-center justify-center rounded-full",
          "border border-neutral-600/50 bg-neutral-800/90 backdrop-blur-xl",
          "shadow-lg shadow-black/30",
          "transition-all duration-200",
          "hover:border-indigo-500/50 hover:bg-neutral-700/90 hover:shadow-xl hover:shadow-indigo-500/10",
          isOpen && "border-indigo-500/50 bg-indigo-500/20 shadow-xl shadow-indigo-500/20"
        )}
        title="Control Center"
        aria-label="Open Control Center"
        aria-expanded={isOpen}
      >
        <Grid3x3 className={cn(
          "h-5 w-5 transition-colors",
          isOpen ? "text-indigo-400" : "text-neutral-300"
        )} />
      </button>
    </div>
  )
}
