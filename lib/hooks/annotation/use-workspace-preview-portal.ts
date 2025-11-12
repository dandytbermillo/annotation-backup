import { useMemo } from "react"

import type { NotePreviewState } from "@/hooks/useNotePreviewHover"
import type { SidebarNotePreviewContext } from "@/lib/hooks/annotation/use-sidebar-folder-popups"

type UseWorkspacePreviewPortalOptions = {
  preview: NotePreviewState<SidebarNotePreviewContext> | null
  isLoading: boolean
  onOpenNote: (noteId: string) => void
  onDismiss: () => void
  onMouseEnter: () => void
  onMouseLeave: () => void
}

export function useWorkspacePreviewPortal({
  preview,
  isLoading,
  onOpenNote,
  onDismiss,
  onMouseEnter,
  onMouseLeave,
}: UseWorkspacePreviewPortalOptions) {
  return useMemo(
    () => ({
      preview,
      isLoading,
      onOpenNote,
      onDismiss,
      onMouseEnter,
      onMouseLeave,
    }),
    [preview, isLoading, onOpenNote, onDismiss, onMouseEnter, onMouseLeave],
  )
}
