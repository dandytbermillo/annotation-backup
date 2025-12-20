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

export type ControlCenterToggleProps = {
  /** Callback to create a new note */
  onCreateNote?: () => void
  /** Callback to open recent notes panel */
  onOpenRecent?: () => void
  /** Callback to toggle constellation/canvas view */
  onToggleCanvas?: () => void
  /** Whether constellation panel is currently visible */
  showConstellationPanel?: boolean
  /** Callback to open component picker */
  onOpenComponentPicker?: () => void
  /** Whether to show the toggle */
  visible?: boolean
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
  /** Control Center toggle props - shows when canvas isn't rendering its own */
  controlCenterProps?: ControlCenterToggleProps
}
