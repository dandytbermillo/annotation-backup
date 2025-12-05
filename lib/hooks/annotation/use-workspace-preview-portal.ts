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
  /** When true, suppress portal rendering (for embedded mode when hidden) */
  isHidden?: boolean
}

export function useWorkspacePreviewPortal({
  preview,
  isLoading,
  onOpenNote,
  onDismiss,
  onMouseEnter,
  onMouseLeave,
  isHidden = false,
}: UseWorkspacePreviewPortalOptions) {
  return useMemo(
    () => ({
      preview,
      isLoading,
      onOpenNote,
      onDismiss,
      onMouseEnter,
      onMouseLeave,
      isHidden,
    }),
    [preview, isLoading, onOpenNote, onDismiss, onMouseEnter, onMouseLeave, isHidden],
  )
}
