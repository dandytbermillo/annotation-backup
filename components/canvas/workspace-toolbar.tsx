"use client"

import React, { useState, useEffect, useRef, useMemo } from "react"
import { Settings } from "lucide-react"
import { NoteSwitcherButton } from "./note-switcher-button"
import { NoteSwitcherPopover } from "./note-switcher-popover"
import type { OpenNoteItem } from "./note-switcher-item"

type WorkspaceToolbarNote = {
  noteId: string
  updatedAt?: string | null
}

interface WorkspaceToolbarProps {
  notes: WorkspaceToolbarNote[]
  activeNoteId: string | null
  isLoading?: boolean
  formatNoteLabel: (noteId: string) => string
  onActivateNote: (noteId: string) => void
  onCenterNote: (noteId: string) => void
  onCloseNote: (noteId: string) => void
  onNewNote?: () => void
  onSettings?: () => void
  /** @deprecated No longer used in popover design */
  maxVisibleNotes?: number
  /** Optional workspace ID for the transformed notes */
  workspaceId?: string
  /** External control: whether popover is open (controlled mode) */
  isPopoverOpen?: boolean
  /** External control: callback when popover open state changes */
  onPopoverOpenChange?: (open: boolean) => void
}

/**
 * Compact popover-based note switcher toolbar.
 * Replaces the horizontal tab bar with a single icon button that opens a vertical list.
 */
export function WorkspaceToolbar({
  notes,
  activeNoteId,
  isLoading = false,
  formatNoteLabel,
  onActivateNote,
  onCenterNote,
  onCloseNote,
  onNewNote,
  onSettings,
  workspaceId = "default",
  isPopoverOpen: externalIsOpen,
  onPopoverOpenChange,
}: WorkspaceToolbarProps) {
  // Internal state for uncontrolled mode
  const [internalIsOpen, setInternalIsOpen] = useState(false)
  const containerRef = useRef<HTMLDivElement>(null)

  // Use external state if provided (controlled mode), otherwise internal state
  const isControlled = externalIsOpen !== undefined
  const isPopoverOpen = isControlled ? externalIsOpen : internalIsOpen

  const setIsPopoverOpen = (open: boolean) => {
    if (isControlled) {
      onPopoverOpenChange?.(open)
    } else {
      setInternalIsOpen(open)
    }
  }

  // Transform notes to OpenNoteItem format
  const openNoteItems: OpenNoteItem[] = useMemo(() => {
    return notes.map((note) => ({
      id: note.noteId,
      title: formatNoteLabel(note.noteId),
      lastEditedAt: note.updatedAt ? new Date(note.updatedAt).getTime() : Date.now(),
      isActive: note.noteId === activeNoteId,
      workspaceId,
    }))
  }, [notes, activeNoteId, formatNoteLabel, workspaceId])

  // Sort: active first, then by last edited (most recent first)
  const sortedNotes = useMemo(() => {
    return [...openNoteItems].sort((a, b) => {
      if (a.isActive) return -1
      if (b.isActive) return 1
      return b.lastEditedAt - a.lastEditedAt
    })
  }, [openNoteItems])

  // Close popover when clicking outside
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
        setIsPopoverOpen(false)
      }
    }

    if (isPopoverOpen) {
      // Use mousedown for immediate response
      document.addEventListener("mousedown", handleClickOutside)
      return () => document.removeEventListener("mousedown", handleClickOutside)
    }
  }, [isPopoverOpen])

  // Close popover on Escape
  useEffect(() => {
    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === "Escape" && isPopoverOpen) {
        setIsPopoverOpen(false)
      }
    }

    document.addEventListener("keydown", handleEscape)
    return () => document.removeEventListener("keydown", handleEscape)
  }, [isPopoverOpen])

  const handleSelectNote = (noteId: string) => {
    onActivateNote(noteId)
    setIsPopoverOpen(false)
  }

  const handleCreateNote = () => {
    onNewNote?.()
    setIsPopoverOpen(false)
  }

  return (
    <div className="flex items-center gap-3">
      {/* Note Switcher */}
      <div className="relative" ref={containerRef}>
        <NoteSwitcherButton
          noteCount={notes.length}
          isOpen={isPopoverOpen}
          onClick={() => setIsPopoverOpen(!isPopoverOpen)}
        />

        {/* Popover */}
        {isPopoverOpen && (
          <div className="absolute left-0 top-full z-[9999] mt-2">
            <NoteSwitcherPopover
              notes={sortedNotes}
              onSelectNote={handleSelectNote}
              onCloseNote={onCloseNote}
              onCenterNote={onCenterNote}
              onCreateNote={handleCreateNote}
              onClose={() => setIsPopoverOpen(false)}
              isLoading={isLoading}
            />
          </div>
        )}
      </div>

      {/* Loading indicator */}
      {isLoading && (
        <div className="flex items-center gap-2">
          <div className="h-1.5 w-1.5 animate-pulse rounded-full bg-neutral-500" />
          <span className="text-xs text-neutral-500">Syncing…</span>
        </div>
      )}

      {/* Settings button */}
      {onSettings && (
        <button
          type="button"
          onClick={onSettings}
          className="group flex h-9 w-9 items-center justify-center rounded-lg border border-neutral-700/80 bg-neutral-900/80 text-neutral-300 backdrop-blur-sm transition-all hover:border-neutral-600 hover:bg-neutral-800 hover:text-neutral-100 hover:shadow-md"
          aria-label="Settings"
          title="Settings"
        >
          <Settings className="h-4 w-4 transition-transform group-hover:rotate-45" />
        </button>
      )}
    </div>
  )
}
