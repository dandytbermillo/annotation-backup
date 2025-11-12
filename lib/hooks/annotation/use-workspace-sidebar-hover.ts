import { useMemo } from "react"

import { useSidebarFolderPopups } from "@/lib/hooks/annotation/use-sidebar-folder-popups"

export type UseWorkspaceSidebarHoverOptions = {
  ensureOverlayHydrated: (reason: string) => void
  fetchGlobalChildren: (folderId: string) => Promise<any[] | null>
  handleOrganizationSidebarSelect: (id: string) => Promise<void> | void
  openNoteFromSidebar: (noteId: string) => void
  triggerNotePreviewHover: (...args: any[]) => void
  triggerNotePreviewLeave: (...args: any[]) => void
  triggerNotePreviewTooltipEnter: (...args: any[]) => void
  triggerNotePreviewTooltipLeave: (...args: any[]) => void
  cancelNotePreview: () => void
  getPreviewSourceFolderId: () => string | undefined
}

export function useWorkspaceSidebarHover({
  ensureOverlayHydrated,
  fetchGlobalChildren,
  handleOrganizationSidebarSelect,
  openNoteFromSidebar,
  triggerNotePreviewHover,
  triggerNotePreviewLeave,
  triggerNotePreviewTooltipEnter,
  triggerNotePreviewTooltipLeave,
  cancelNotePreview,
  getPreviewSourceFolderId,
}: UseWorkspaceSidebarHoverOptions) {
  const hoverHandlers = useSidebarFolderPopups({
    ensureOverlayHydrated,
    fetchChildren: fetchGlobalChildren,
    onSelectFolder: handleOrganizationSidebarSelect,
    onOpenNote: openNoteFromSidebar,
    triggerNotePreviewHover,
    triggerNotePreviewLeave,
    triggerNotePreviewTooltipEnter,
    triggerNotePreviewTooltipLeave,
    cancelNotePreview,
    getPreviewSourceFolderId,
  })

  const sidebarPreviewProps = useMemo(
    () => ({
      popups: hoverHandlers.sidebarFolderPopups,
      onPopupHover: hoverHandlers.handleSidebarPopupHover,
      onPopupLeave: hoverHandlers.handleSidebarEyeHoverLeave,
      onDismiss: hoverHandlers.dismissSidebarPopup,
      onFolderHover: hoverHandlers.handleSidebarOrgEyeHover,
      onFolderClick: hoverHandlers.handleSidebarPopupFolderClick,
      onNotePreviewHover: hoverHandlers.handleSidebarNotePreviewHover,
      onNotePreviewLeave: hoverHandlers.handleSidebarNotePreviewLeave,
      onNoteOpen: hoverHandlers.handleSidebarNoteOpen,
    }),
    [hoverHandlers],
  )

  return {
    hoverHandlers,
    sidebarPreviewProps,
  }
}
