import { useMemo } from "react"

type WorkspaceToolbarNote = {
  noteId: string
  updatedAt?: string | null
}

type UseWorkspaceToolbarPropsOptions = {
  notes: WorkspaceToolbarNote[]
  activeNoteId: string | null
  isWorkspaceLoading: boolean
  isCreatingNote: boolean
  formatNoteLabel: (noteId: string) => string
  onActivateNote: (noteId: string) => void
  onCenterNote: (noteId: string) => void
  onCloseNote: (noteId: string) => void
  onNewNote: () => void
  onSettings: () => void
  // Controlled popover state (shared with dock)
  isPopoverOpen?: boolean
  onPopoverOpenChange?: (open: boolean) => void
}

export function useWorkspaceToolbarProps({
  notes,
  activeNoteId,
  isWorkspaceLoading,
  isCreatingNote,
  formatNoteLabel,
  onActivateNote,
  onCenterNote,
  onCloseNote,
  onNewNote,
  onSettings,
  isPopoverOpen,
  onPopoverOpenChange,
}: UseWorkspaceToolbarPropsOptions) {
  return useMemo(
    () => ({
      notes,
      activeNoteId,
      isLoading: isWorkspaceLoading || isCreatingNote,
      formatNoteLabel,
      onActivateNote,
      onCenterNote,
      onCloseNote,
      onNewNote,
      onSettings,
      isPopoverOpen,
      onPopoverOpenChange,
    }),
    [
      notes,
      activeNoteId,
      isWorkspaceLoading,
      isCreatingNote,
      formatNoteLabel,
      onActivateNote,
      onCenterNote,
      onCloseNote,
      onNewNote,
      onSettings,
      isPopoverOpen,
      onPopoverOpenChange,
    ],
  )
}
