"use client"

import React, { type MouseEvent } from "react"
import { Crosshair, X } from "lucide-react"

type WorkspaceToolbarNote = {
  noteId: string
  updatedAt?: string | null
}

interface WorkspaceToolbarProps {
  notes: WorkspaceToolbarNote[]
  focusedNoteId: string | null
  isLoading?: boolean
  formatNoteLabel: (noteId: string) => string
  onActivateNote: (noteId: string) => void
  onCenterNote: (noteId: string) => void
  onCloseNote: (noteId: string) => void
}

/**
 * Toolbar-style list of open notes. Replaces the old tab strip while keeping the
 * highlight + center affordances callers expect.
 */
export function WorkspaceToolbar({
  notes,
  focusedNoteId,
  isLoading,
  formatNoteLabel,
  onActivateNote,
  onCenterNote,
  onCloseNote,
}: WorkspaceToolbarProps) {
  const handleCenter = (event: MouseEvent<HTMLButtonElement>, noteId: string) => {
    event.stopPropagation()
    onCenterNote(noteId)
  }

  const handleClose = (event: MouseEvent<HTMLButtonElement>, noteId: string) => {
    event.stopPropagation()
    onCloseNote(noteId)
  }

  return (
    <div className="flex flex-1 flex-wrap items-center gap-2">
      <span className="text-xs uppercase tracking-wide text-neutral-400">Workspace</span>
      {notes.length === 0 ? (
        <span className="text-sm text-neutral-500">
          No notes open
        </span>
      ) : notes.map(note => {
        const isActive = note.noteId === focusedNoteId
        const label = formatNoteLabel(note.noteId)
        const timestampLabel = note.updatedAt
          ? new Date(note.updatedAt).toLocaleTimeString()
          : 'new'
        const baseClasses = isActive
          ? 'border-indigo-400 bg-indigo-500/20 text-indigo-100'
          : 'border-neutral-700 bg-neutral-900 text-neutral-300 hover:border-neutral-500 hover:text-neutral-100'

        return (
          <div
            key={note.noteId}
            className={`group flex items-center overflow-hidden rounded-md border text-sm transition ${baseClasses}`}
          >
            <button
              type="button"
              onClick={() => onActivateNote(note.noteId)}
              className="flex items-center gap-2 px-3 py-1"
            >
              <span className="font-medium">{label}</span>
              <span className="text-xs text-neutral-500 group-hover:text-neutral-300">
                {timestampLabel}
              </span>
            </button>
            <button
              type="button"
              onClick={event => handleCenter(event, note.noteId)}
              aria-label={`Center ${label}`}
              className="h-full border-l border-l-neutral-700/60 px-1.5 py-1 text-neutral-500 transition hover:bg-neutral-800 hover:text-neutral-100 -ml-px"
            >
              <Crosshair className="h-3.5 w-3.5" />
            </button>
            <button
              type="button"
              onClick={event => handleClose(event, note.noteId)}
              aria-label={`Close ${label}`}
              className="h-full border-l border-l-neutral-700/60 px-1.5 py-1 text-neutral-500 transition hover:bg-neutral-800 hover:text-neutral-100 -ml-px"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          </div>
        )
      })}
      {isLoading && (
        <span className="text-xs text-neutral-500">
          Syncing…
        </span>
      )}
    </div>
  )
}
