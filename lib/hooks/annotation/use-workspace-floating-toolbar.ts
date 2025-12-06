import { useMemo } from "react"
import type { ComponentProps, MutableRefObject } from "react"

import { FloatingToolbar } from "@/components/floating-toolbar"
import type { KnowledgeBaseWorkspaceApi } from "@/lib/hooks/annotation/use-knowledge-base-workspace"
import type { WorkspaceToolbarState } from "@/lib/hooks/annotation/use-workspace-toolbar-state"

type FloatingToolbarProps = ComponentProps<typeof FloatingToolbar>

type UseWorkspaceFloatingToolbarOptions = {
  notesWidgetPosition: { x: number; y: number }
  showNotesWidget: boolean
  activeNoteId: string | null
  showConstellationPanel: boolean
  onClose: () => void
  onSelectNote: FloatingToolbarProps["onSelectNote"]
  onCreateOverlayPopup: FloatingToolbarProps["onCreateOverlayPopup"]
  onAddComponent: FloatingToolbarProps["onAddComponent"]
  activeEditorRef: MutableRefObject<any>
  activePanelId: string | null
  onBackdropStyleChange: FloatingToolbarProps["onBackdropStyleChange"]
  onFolderRenamed: FloatingToolbarProps["onFolderRenamed"]
  toolbarActivePanel: WorkspaceToolbarState["toolbarActivePanel"]
  setToolbarActivePanel: WorkspaceToolbarState["setToolbarActivePanel"]
  recentNotesRefreshTrigger: number
  toggleConstellationView: FloatingToolbarProps["onToggleConstellationPanel"]
  knowledgeBaseWorkspace: KnowledgeBaseWorkspaceApi
  /** When true, suppress floating toolbar portal (for embedded mode when parent is hidden) */
  isHidden?: boolean
}

export function useWorkspaceFloatingToolbar({
  notesWidgetPosition,
  showNotesWidget,
  activeNoteId,
  showConstellationPanel,
  onClose,
  onSelectNote,
  onCreateOverlayPopup,
  onAddComponent,
  activeEditorRef,
  activePanelId,
  onBackdropStyleChange,
  onFolderRenamed,
  toolbarActivePanel,
  setToolbarActivePanel,
  recentNotesRefreshTrigger,
  toggleConstellationView,
  knowledgeBaseWorkspace,
  isHidden = false,
}: UseWorkspaceFloatingToolbarOptions) {
  const floatingToolbarProps = useMemo<FloatingToolbarProps>(
    () => ({
      x: notesWidgetPosition.x,
      y: notesWidgetPosition.y,
      onClose,
      onSelectNote,
      onCreateOverlayPopup,
      onAddComponent,
      editorRef: activeEditorRef,
      activePanelId,
      onBackdropStyleChange,
      onFolderRenamed,
      activePanel: toolbarActivePanel,
      onActivePanelChange: setToolbarActivePanel,
      refreshRecentNotes: recentNotesRefreshTrigger,
      onToggleConstellationPanel: toggleConstellationView,
      showConstellationPanel,
      knowledgeBaseWorkspace,
    }),
    [
      activeEditorRef,
      activePanelId,
      knowledgeBaseWorkspace,
      notesWidgetPosition.x,
      notesWidgetPosition.y,
      onAddComponent,
      onBackdropStyleChange,
      onClose,
      onCreateOverlayPopup,
      onFolderRenamed,
      onSelectNote,
      recentNotesRefreshTrigger,
      setToolbarActivePanel,
      showConstellationPanel,
      toggleConstellationView,
      toolbarActivePanel,
    ],
  )

  const floatingToolbarVisible =
    showNotesWidget && !activeNoteId && !showConstellationPanel && !isHidden

  return {
    floatingToolbarProps,
    floatingToolbarVisible,
  }
}
