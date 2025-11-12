import { useMemo } from "react"

import type { LayerContextValue } from "@/components/canvas/layer-provider"
import { useOverlayLayerHotkeys } from "@/lib/hooks/annotation/use-overlay-layer-hotkeys"
import { useOverlayLayerInteractions } from "@/lib/hooks/annotation/use-overlay-layer-interactions"
import { useWorkspaceToolbarState } from "@/lib/hooks/annotation/use-workspace-toolbar-state"
import type { CanvasState } from "@/lib/hooks/annotation/use-workspace-canvas-state"
import type { DebugLogFn } from "@/lib/hooks/annotation/use-workspace-canvas-state"

type UseWorkspaceNotesWidgetOptions = {
  layerContext: LayerContextValue | null
  multiLayerEnabled: boolean
  clearAllTimeouts: () => void
  canvasState: CanvasState
  debugLog: DebugLogFn
}

export function useWorkspaceNotesWidget({
  layerContext,
  multiLayerEnabled,
  clearAllTimeouts,
  canvasState,
  debugLog,
}: UseWorkspaceNotesWidgetOptions) {
  const toolbarState = useWorkspaceToolbarState()
  const {
    showNotesWidget,
    setShowNotesWidget,
    notesWidgetPosition,
    setNotesWidgetPosition,
    activeEditorRef,
    activePanelId,
    setActivePanelId,
    toolbarActivePanel,
    setToolbarActivePanel,
    recentNotesRefreshTrigger,
    bumpRecentNotesRefresh,
    showAddComponentMenu,
    setShowAddComponentMenu,
  } = toolbarState

  useOverlayLayerHotkeys({
    layerContext,
    multiLayerEnabled,
    clearAllTimeouts,
    setNotesWidgetPosition,
    setShowNotesWidget,
    showNotesWidget,
  })

  const { handleContextMenu } = useOverlayLayerInteractions({
    layerContext,
    canvasState,
    debugLog,
    setNotesWidgetPosition,
    setShowNotesWidget,
    showNotesWidget,
    setActivePanelId,
  })

  return useMemo(
    () => ({
      showNotesWidget,
      setShowNotesWidget,
      notesWidgetPosition,
      setNotesWidgetPosition,
      activeEditorRef,
      activePanelId,
      setActivePanelId,
      toolbarActivePanel,
      setToolbarActivePanel,
      recentNotesRefreshTrigger,
      bumpRecentNotesRefresh,
      showAddComponentMenu,
      setShowAddComponentMenu,
      handleContextMenu,
    }),
    [
      activeEditorRef,
      activePanelId,
      bumpRecentNotesRefresh,
      handleContextMenu,
      notesWidgetPosition,
      recentNotesRefreshTrigger,
      setActivePanelId,
      setNotesWidgetPosition,
      setShowAddComponentMenu,
      setShowNotesWidget,
      showAddComponentMenu,
      showNotesWidget,
      toolbarActivePanel,
      setToolbarActivePanel,
    ],
  )
}
