"use client"

import { createPortal } from "react-dom"

import { PreviewPopover } from "@/components/shared/preview-popover"
import type { NotePreviewState } from "@/hooks/useNotePreviewHover"

type WorkspacePreviewPortalProps<TContext = unknown> = {
  preview: NotePreviewState<TContext> | null
  isLoading: boolean
  onOpenNote: (noteId: string) => void
  onDismiss?: () => void
  onMouseEnter?: () => void
  onMouseLeave?: () => void
}

export function WorkspacePreviewPortal<TContext = unknown>({
  preview,
  isLoading,
  onOpenNote,
  onDismiss,
  onMouseEnter,
  onMouseLeave,
}: WorkspacePreviewPortalProps<TContext>) {
  if (!preview || typeof document === "undefined") {
    return null
  }

  const handleOpenNote = (noteId: string) => {
    onOpenNote(noteId)
    onDismiss?.()
  }

  return createPortal(
    <PreviewPopover
      content={preview.content}
      status={isLoading ? "loading" : "ready"}
      position={preview.position}
      noteId={preview.noteId}
      onOpenNote={handleOpenNote}
      onMouseEnter={onMouseEnter}
      onMouseLeave={onMouseLeave}
    />,
    document.body,
  )
}
