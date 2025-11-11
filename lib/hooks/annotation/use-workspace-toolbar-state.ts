import { useCallback, useRef, useState } from "react"

type ToolbarPanel =
  | "recents"
  | "org"
  | "tools"
  | "layer"
  | "format"
  | "resize"
  | "branches"
  | "actions"
  | "add-component"
  | "display"
  | null

type UseWorkspaceToolbarStateOptions = {
  initialNotesWidgetPosition?: { x: number; y: number }
}

export function useWorkspaceToolbarState({
  initialNotesWidgetPosition = { x: 100, y: 100 },
}: UseWorkspaceToolbarStateOptions = {}) {
  const [showNotesWidget, setShowNotesWidget] = useState(false)
  const [notesWidgetPosition, setNotesWidgetPosition] = useState(initialNotesWidgetPosition)
  const activeEditorRef = useRef<any>(null)
  const [activePanelId, setActivePanelId] = useState<string | null>(null)
  const [toolbarActivePanel, setToolbarActivePanel] = useState<ToolbarPanel>(null)
  const [recentNotesRefreshTrigger, setRecentNotesRefreshTrigger] = useState(0)
  const [showAddComponentMenu, setShowAddComponentMenu] = useState(false)

  const bumpRecentNotesRefresh = useCallback(() => {
    setRecentNotesRefreshTrigger((prev) => prev + 1)
  }, [])

  const openNotesWidgetAt = useCallback((position: { x: number; y: number }) => {
    setNotesWidgetPosition(position)
    setShowNotesWidget(true)
  }, [])

  const closeNotesWidget = useCallback(() => {
    setShowNotesWidget(false)
  }, [])

  return {
    showNotesWidget,
    setShowNotesWidget,
    notesWidgetPosition,
    setNotesWidgetPosition,
    openNotesWidgetAt,
    closeNotesWidget,
    activeEditorRef,
    activePanelId,
    setActivePanelId,
    toolbarActivePanel,
    setToolbarActivePanel,
    recentNotesRefreshTrigger,
    bumpRecentNotesRefresh,
    showAddComponentMenu,
    setShowAddComponentMenu,
  }
}

export type WorkspaceToolbarState = ReturnType<typeof useWorkspaceToolbarState>
