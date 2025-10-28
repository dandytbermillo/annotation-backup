"use client"

import React, { type MouseEvent, useState, useEffect, useRef } from "react"
import { Crosshair, X, Plus, Settings, ChevronDown } from "lucide-react"

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
  maxVisibleNotes?: number
}

/**
 * Format relative time (e.g., "2m ago", "just now")
 */
function formatRelativeTime(dateString: string | null | undefined): string {
  if (!dateString) return 'new'

  const date = new Date(dateString)
  const now = new Date()
  const seconds = Math.floor((now.getTime() - date.getTime()) / 1000)

  if (seconds < 10) return 'just now'
  if (seconds < 60) return `${seconds}s ago`

  const minutes = Math.floor(seconds / 60)
  if (minutes < 60) return `${minutes}m ago`

  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours}h ago`

  const days = Math.floor(hours / 24)
  if (days === 1) return 'yesterday'
  if (days < 7) return `${days}d ago`

  // Fallback to time for older dates
  return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
}

/**
 * Toolbar-style list of open notes with overflow dropdown.
 * Shows first N notes inline, rest in dropdown menu.
 */
export function WorkspaceToolbar({
  notes,
  activeNoteId,
  isLoading,
  formatNoteLabel,
  onActivateNote,
  onCenterNote,
  onCloseNote,
  onNewNote,
  onSettings,
  maxVisibleNotes = 3,
}: WorkspaceToolbarProps) {
  const [isDropdownOpen, setIsDropdownOpen] = useState(false)
  const dropdownRef = useRef<HTMLDivElement>(null)

  const handleCenter = (event: MouseEvent<HTMLButtonElement>, noteId: string) => {
    event.stopPropagation()
    onCenterNote(noteId)
  }

  const handleClose = (event: MouseEvent<HTMLButtonElement>, noteId: string) => {
    event.stopPropagation()
    onCloseNote(noteId)
  }

  const handleDropdownItemClick = (noteId: string) => {
    onActivateNote(noteId)
    setIsDropdownOpen(false)
  }

  // Close dropdown when clicking outside
  useEffect(() => {
    const handleClickOutside = (event: globalThis.MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        setIsDropdownOpen(false)
      }
    }

    if (isDropdownOpen) {
      document.addEventListener('mousedown', handleClickOutside)
      return () => document.removeEventListener('mousedown', handleClickOutside)
    }
  }, [isDropdownOpen])

  // Split notes into visible and overflow
  const visibleNotes = notes.slice(0, maxVisibleNotes)
  const overflowNotes = notes.slice(maxVisibleNotes)

  return (
    <div className="flex items-center gap-2 px-1 w-full min-w-0">
      {/* Workspace label with note count */}
      <div className="flex items-center gap-2 shrink-0">
        <span className="text-xs font-semibold uppercase tracking-wider text-neutral-400">
          Workspace
        </span>
        {notes.length > 0 && (
          <span className="rounded-full bg-neutral-800 px-2 py-0.5 text-xs font-medium text-neutral-400">
            {notes.length}
          </span>
        )}
      </div>

      {/* Divider */}
      {notes.length > 0 && (
        <div className="h-4 w-px bg-neutral-700 shrink-0" />
      )}

      {/* Notes container */}
      <div className="flex flex-1 items-center gap-2 overflow-hidden min-w-0">
        {/* Visible notes */}
        <div className="flex items-center gap-2 overflow-hidden min-w-0">
          {notes.length === 0 ? (
            <span className="text-sm italic text-neutral-500">
              No notes open
            </span>
          ) : (
            visibleNotes.map(note => {
              const isActive = note.noteId === activeNoteId
              const label = formatNoteLabel(note.noteId)
              const timestampLabel = formatRelativeTime(note.updatedAt)

              return (
                <div
                  key={note.noteId}
                  className={`group relative flex items-center overflow-hidden rounded-lg border text-sm transition-all shrink-0 ${
                    isActive
                      ? 'border-indigo-500/50 bg-indigo-500/10 shadow-lg shadow-indigo-500/20'
                      : 'border-neutral-700/80 bg-neutral-900/80 backdrop-blur-sm hover:border-neutral-600 hover:bg-neutral-800/90 hover:shadow-md'
                  }`}
                >
                  {/* Active indicator */}
                  {isActive && (
                    <div className="absolute left-0 top-0 bottom-0 w-0.5 bg-indigo-400" />
                  )}

                  {/* Main note button */}
                  <button
                    type="button"
                    onClick={() => onActivateNote(note.noteId)}
                    className={`flex items-center gap-1.5 px-2.5 py-1.5 transition-colors ${
                      isActive ? 'pl-3' : ''
                    }`}
                  >
                    <span className={`font-medium max-w-[100px] truncate ${
                      isActive ? 'text-indigo-100' : 'text-neutral-300'
                    }`}>
                      {label}
                    </span>
                    <span className={`text-xs tabular-nums transition-colors shrink-0 ${
                      isActive
                        ? 'text-indigo-400/70'
                        : 'text-neutral-500 group-hover:text-neutral-400'
                    }`}>
                      {timestampLabel}
                    </span>
                  </button>

                  {/* Action buttons */}
                  <div className="flex items-stretch">
                    <button
                      type="button"
                      onClick={event => handleCenter(event, note.noteId)}
                      aria-label={`Center ${label}`}
                      className={`border-l px-1.5 py-1.5 transition-all ${
                        isActive
                          ? 'border-l-indigo-500/30 text-indigo-300 hover:bg-indigo-500/20 hover:text-indigo-100'
                          : 'border-l-neutral-700/60 text-neutral-500 hover:bg-neutral-800 hover:text-neutral-100'
                      }`}
                      title="Center note on canvas"
                    >
                      <Crosshair className="h-3.5 w-3.5" />
                    </button>
                    <button
                      type="button"
                      onClick={event => handleClose(event, note.noteId)}
                      aria-label={`Close ${label}`}
                      className={`border-l px-1.5 py-1.5 transition-all ${
                        isActive
                          ? 'border-l-indigo-500/30 text-indigo-300 hover:bg-red-500/20 hover:text-red-300'
                          : 'border-l-neutral-700/60 text-neutral-500 hover:bg-red-500/10 hover:text-red-400'
                      }`}
                      title="Close note"
                    >
                      <X className="h-3.5 w-3.5" />
                    </button>
                  </div>
                </div>
              )
            })
          )}
        </div>

        {/* Overflow dropdown button */}
        {overflowNotes.length > 0 && (
          <div className="relative shrink-0" ref={dropdownRef}>
            <button
              type="button"
              onClick={() => setIsDropdownOpen(!isDropdownOpen)}
              className={`relative flex items-center justify-center w-8 h-8 rounded-md border transition-all ${
                isDropdownOpen
                  ? 'border-indigo-500/50 bg-indigo-500/20 text-indigo-300'
                  : 'border-neutral-700/80 bg-neutral-900/80 text-neutral-500 hover:border-neutral-600 hover:bg-neutral-800 hover:text-neutral-300'
              }`}
              aria-label="Show more notes"
            >
              <ChevronDown className={`h-3.5 w-3.5 transition-transform ${
                isDropdownOpen ? 'rotate-180' : ''
              }`} />
              <span className="absolute -top-1 -right-1 min-w-[18px] h-[18px] flex items-center justify-center bg-indigo-500 border-2 border-neutral-950 rounded-full text-[10px] font-semibold text-white px-1">
                {overflowNotes.length}
              </span>
            </button>

            {/* Dropdown menu */}
            {isDropdownOpen && (
              <div
                className="fixed min-w-[280px] max-w-[400px] max-h-[400px] bg-neutral-950/98 backdrop-blur-xl border border-neutral-700/80 rounded-lg shadow-2xl overflow-hidden z-[9999]"
                style={{
                  top: '60px',
                  right: '20px',
                }}
              >
                <div className="px-4 py-3 border-b border-neutral-800">
                  <span className="text-xs font-semibold uppercase tracking-wider text-neutral-400">
                    Hidden Notes
                  </span>
                </div>
                <div className="max-h-[340px] overflow-y-auto">
                  {overflowNotes.map(note => {
                    const isActive = note.noteId === activeNoteId
                    const label = formatNoteLabel(note.noteId)
                    const timestampLabel = formatRelativeTime(note.updatedAt)

                    return (
                      <div
                        key={note.noteId}
                        className={`flex items-center gap-3 px-4 py-2.5 cursor-pointer transition-colors border-b border-neutral-800/50 last:border-b-0 ${
                          isActive
                            ? 'bg-indigo-500/15'
                            : 'hover:bg-neutral-800/50'
                        }`}
                        onClick={() => handleDropdownItemClick(note.noteId)}
                      >
                        {/* Active indicator */}
                        <div className={`w-0.5 h-6 rounded-full flex-shrink-0 ${
                          isActive ? 'bg-indigo-400' : 'bg-transparent'
                        }`} />

                        {/* Note info */}
                        <div className="flex-1 min-w-0">
                          <div className={`text-sm font-medium truncate max-w-[200px] ${
                            isActive ? 'text-indigo-100' : 'text-neutral-300'
                          }`}>
                            {label}
                          </div>
                          <div className={`text-xs tabular-nums mt-0.5 ${
                            isActive ? 'text-indigo-400/70' : 'text-neutral-500'
                          }`}>
                            {timestampLabel}
                          </div>
                        </div>

                        {/* Actions */}
                        <div className="flex items-center gap-1 flex-shrink-0">
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation()
                              onCenterNote(note.noteId)
                            }}
                            className="p-1.5 rounded hover:bg-neutral-700/50 text-neutral-500 hover:text-neutral-300 transition-colors"
                            aria-label="Center note"
                            title="Center note"
                          >
                            <Crosshair className="h-3.5 w-3.5" />
                          </button>
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation()
                              handleClose(e as any, note.noteId)
                            }}
                            className="p-1.5 rounded hover:bg-red-500/15 text-neutral-500 hover:text-red-400 transition-colors"
                            aria-label="Close note"
                            title="Close note"
                          >
                            <X className="h-3.5 w-3.5" />
                          </button>
                        </div>
                      </div>
                    )
                  })}
                </div>
              </div>
            )}
          </div>
        )}
      </div>

      {/* Loading indicator */}
      {isLoading && (
        <div className="flex items-center gap-2 shrink-0">
          <div className="h-1.5 w-1.5 rounded-full bg-neutral-500 animate-pulse" />
          <span className="text-xs text-neutral-500">Syncing…</span>
        </div>
      )}

      {/* Divider */}
      <div className="h-4 w-px bg-neutral-700 shrink-0" />

      {/* Action buttons */}
      <div className="flex items-center gap-2 shrink-0">
        {onNewNote && (
          <button
            type="button"
            onClick={onNewNote}
            disabled={isLoading}
            className="group flex items-center gap-2 rounded-lg border border-neutral-700/80 bg-neutral-900/80 backdrop-blur-sm px-3 py-1.5 text-sm font-medium text-neutral-300 transition-all hover:border-indigo-500/50 hover:bg-indigo-500/10 hover:text-indigo-100 hover:shadow-lg hover:shadow-indigo-500/10 disabled:opacity-50 disabled:cursor-not-allowed disabled:hover:border-neutral-700 disabled:hover:bg-neutral-900 disabled:hover:shadow-none"
            aria-label="Create new note"
          >
            <Plus className="h-4 w-4 transition-transform group-hover:scale-110" />
            <span>{isLoading ? 'Creating...' : 'New Note'}</span>
          </button>
        )}
        {onSettings && (
          <button
            type="button"
            onClick={onSettings}
            className="group flex items-center justify-center rounded-lg border border-neutral-700/80 bg-neutral-900/80 backdrop-blur-sm p-2 text-neutral-300 transition-all hover:border-neutral-600 hover:bg-neutral-800 hover:text-neutral-100 hover:shadow-md"
            aria-label="Settings"
            title="Settings"
          >
            <Settings className="h-4 w-4 transition-transform group-hover:rotate-45" />
          </button>
        )}
      </div>
    </div>
  )
}
