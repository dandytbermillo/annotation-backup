import { useMemo } from "react"
import type { MouseEvent } from "react"

import type { KnowledgeBaseWorkspaceApi } from "@/lib/hooks/annotation/use-knowledge-base-workspace"
import type { MoveCascadeState } from "@/lib/hooks/annotation/use-popup-overlay-state"
import type { OverlayCameraState } from "@/lib/types/overlay-layout"

type AnyHandler = (...args: any[]) => any

type UseWorkspaceOverlayPropsOptions = {
  canRenderOverlay: boolean
  adaptedPopups: Map<string, any>
  draggingPopup: any
  onClosePopup: AnyHandler
  onInitiateClose: AnyHandler
  onConfirmClose: AnyHandler
  onCancelClose: AnyHandler
  onTogglePin: AnyHandler
  onDragStart: AnyHandler
  onHoverFolder: AnyHandler
  onLeaveFolder: AnyHandler
  onPopupHover: AnyHandler
  onSelectNote: AnyHandler
  onDeleteSelected: AnyHandler
  onBulkMove: AnyHandler
  onFolderCreated: AnyHandler
  onFolderRenamed: AnyHandler
  onPopupCardClick: AnyHandler
  onContextMenu: (event: MouseEvent) => void
  onPopupPositionChange: AnyHandler
  onResizePopup: AnyHandler
  isWorkspaceLayoutLoading: boolean
  isPopupLayerActive: boolean
  backdropStyle: string
  currentWorkspaceId: string | null
  optimisticHydrationEnabled: boolean
  hydrationStatusLabel: string | null
  hydrationVeilActive: boolean
  onUserCameraTransform: (snapshot: { transform: OverlayCameraState; timestamp: number }) => void
  knowledgeBaseWorkspace: KnowledgeBaseWorkspaceApi
  moveCascadeState: MoveCascadeState
  onToggleMoveCascade: AnyHandler
  onClearMoveCascadeState: () => void
}

export function useWorkspaceOverlayProps({
  canRenderOverlay,
  adaptedPopups,
  draggingPopup,
  onClosePopup,
  onInitiateClose,
  onConfirmClose,
  onCancelClose,
  onTogglePin,
  onDragStart,
  onHoverFolder,
  onLeaveFolder,
  onPopupHover,
  onSelectNote,
  onDeleteSelected,
  onBulkMove,
  onFolderCreated,
  onFolderRenamed,
  onPopupCardClick,
  onContextMenu,
  onPopupPositionChange,
  onResizePopup,
  isWorkspaceLayoutLoading,
  isPopupLayerActive,
  backdropStyle,
  currentWorkspaceId,
  optimisticHydrationEnabled,
  hydrationStatusLabel,
  hydrationVeilActive,
  onUserCameraTransform,
  knowledgeBaseWorkspace,
  moveCascadeState,
  onToggleMoveCascade,
  onClearMoveCascadeState,
}: UseWorkspaceOverlayPropsOptions) {
  return useMemo(
    () => ({
      shouldRender: canRenderOverlay,
      popups: adaptedPopups,
      draggingPopup,
      onClosePopup,
      onInitiateClose,
      onConfirmClose,
      onCancelClose,
      onTogglePin,
      onDragStart,
      onHoverFolder,
      onLeaveFolder,
      onPopupHover,
      onSelectNote,
      onDeleteSelected,
      onBulkMove,
      onFolderCreated,
      onFolderRenamed,
      onPopupCardClick,
      onContextMenu,
      onPopupPositionChange,
      onResizePopup,
      isLocked: optimisticHydrationEnabled ? false : isWorkspaceLayoutLoading,
      sidebarOpen: isPopupLayerActive,
      backdropStyle,
      workspaceId: currentWorkspaceId,
      optimisticHydrationEnabled,
      hydrationStatusLabel,
      hydrationVeilActive,
      onUserCameraTransform,
      knowledgeBaseWorkspace,
      activeMoveCascadeParentId: moveCascadeState.parentId,
      moveCascadeChildIds: moveCascadeState.childIds,
      onToggleMoveCascade,
      moveCascadeState,
      onClearMoveCascadeState,
    }),
    [
      adaptedPopups,
      backdropStyle,
      canRenderOverlay,
      currentWorkspaceId,
      draggingPopup,
      isPopupLayerActive,
      isWorkspaceLayoutLoading,
      knowledgeBaseWorkspace,
      hydrationStatusLabel,
      hydrationVeilActive,
      optimisticHydrationEnabled,
      moveCascadeState,
      onBulkMove,
      onCancelClose,
      onClearMoveCascadeState,
      onClosePopup,
      onConfirmClose,
      onContextMenu,
      onDragStart,
      onFolderCreated,
      onFolderRenamed,
      onHoverFolder,
      onInitiateClose,
      onLeaveFolder,
      onPopupCardClick,
      onPopupHover,
      onPopupPositionChange,
      onResizePopup,
      onSelectNote,
      onUserCameraTransform,
      onDeleteSelected,
      onToggleMoveCascade,
      onTogglePin,
    ],
  )
}
