import type { MouseEventHandler, ReactNode } from "react"

import type { WorkspaceToolbarStripProps } from "@/components/workspace/workspace-toolbar-strip"
import type { SidebarPreviewPopupsProps } from "@/components/sidebar/sidebar-preview-popups"
import type { WorkspacePreviewPortalProps } from "@/components/workspace/workspace-preview-portal"
import type { WorkspaceCanvasAreaProps } from "@/components/workspace/workspace-canvas-area"
import type { WorkspaceOverlayProps } from "@/components/workspace/workspace-overlay"
import type { WorkspaceFloatingToolbarProps } from "@/components/workspace/workspace-floating-toolbar"
import type { WorkspaceConstellationLayerProps } from "@/components/workspace/workspace-constellation-layer"
import type { WorkspaceSidebarProps } from "@/components/workspace/workspace-sidebar"

export type ConstellationPanelProps = WorkspaceConstellationLayerProps

export type WorkspaceCanvasViewProps = {
  showConstellationPanel: WorkspaceCanvasAreaProps["showConstellationPanel"]
  isPopupLayerActive: WorkspaceCanvasAreaProps["isPopupLayerActive"]
  hasOpenNotes: boolean
  canvas: ReactNode | null
}

export type AnnotationWorkspaceViewProps = {
  sidebar?: ReactNode
  sidebarProps?: WorkspaceSidebarProps
  toolbar?: ReactNode
  toolbarProps?: WorkspaceToolbarStripProps
  workspaceToggle?: ReactNode
  canvasArea?: ReactNode
  canvasProps?: WorkspaceCanvasViewProps
  workspaceLayers?: ReactNode
  workspaceOverlayProps?: WorkspaceOverlayProps
  sidebarPreviewProps?: SidebarPreviewPopupsProps
  floatingToolbar?: ReactNode
  floatingToolbarProps?: WorkspaceFloatingToolbarProps
  previewPortalProps?: WorkspacePreviewPortalProps
  constellationPanel?: ReactNode
  constellationPanelProps?: ConstellationPanelProps
  onMainAreaContextMenu?: MouseEventHandler<HTMLDivElement>
}
