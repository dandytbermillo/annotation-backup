"use client"

import type { MouseEventHandler, ReactNode } from "react"
import type { ComponentProps } from "react"

import { WorkspaceToolbarStrip } from "@/components/workspace/workspace-toolbar-strip"
import { SidebarPreviewPopups } from "@/components/sidebar/sidebar-preview-popups"
import { WorkspacePreviewPortal } from "@/components/workspace/workspace-preview-portal"
import { WorkspaceCanvasArea } from "@/components/workspace/workspace-canvas-area"
import { WorkspaceCanvasContent } from "@/components/workspace/workspace-canvas-content"
import { WorkspaceOverlay } from "@/components/workspace/workspace-overlay"
import { WorkspaceFloatingToolbar } from "@/components/workspace/workspace-floating-toolbar"
import { WorkspaceConstellationLayer } from "@/components/workspace/workspace-constellation-layer"
import { WorkspaceSidebar } from "@/components/workspace/workspace-sidebar"

type WorkspaceToolbarStripProps = ComponentProps<typeof WorkspaceToolbarStrip>
type SidebarPreviewPopupsProps = ComponentProps<typeof SidebarPreviewPopups>
type WorkspacePreviewPortalProps = ComponentProps<typeof WorkspacePreviewPortal>
type WorkspaceOverlayProps = ComponentProps<typeof WorkspaceOverlay>
type WorkspaceFloatingToolbarProps = ComponentProps<typeof WorkspaceFloatingToolbar>
type ConstellationPanelProps = ComponentProps<typeof WorkspaceConstellationLayer>
type WorkspaceCanvasAreaProps = ComponentProps<typeof WorkspaceCanvasArea>
type WorkspaceSidebarProps = ComponentProps<typeof WorkspaceSidebar>

type WorkspaceCanvasViewProps = {
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

export function AnnotationWorkspaceView({
  sidebar,
  sidebarProps,
  toolbar,
  toolbarProps,
  workspaceToggle,
  canvasArea,
  canvasProps,
  workspaceLayers,
  workspaceOverlayProps,
  sidebarPreviewProps,
  floatingToolbar,
  floatingToolbarProps,
  previewPortalProps,
  constellationPanel,
  constellationPanelProps,
  onMainAreaContextMenu,
}: AnnotationWorkspaceViewProps) {
  return (
    <div className="relative h-screen w-screen overflow-hidden bg-neutral-950/80">
      <div className="flex h-full w-full">
        {sidebar ?? (sidebarProps ? <WorkspaceSidebar {...sidebarProps} /> : null)}
        <div className="flex flex-1 flex-col overflow-hidden">
          {toolbar ?? (toolbarProps ? <WorkspaceToolbarStrip {...toolbarProps} /> : null)}
          <div className="relative flex-1" onContextMenu={onMainAreaContextMenu}>
            {workspaceToggle}
            {canvasArea
              ? canvasArea
              : canvasProps
              ? (
                <WorkspaceCanvasArea
                  showConstellationPanel={canvasProps.showConstellationPanel}
                  isPopupLayerActive={canvasProps.isPopupLayerActive}
                >
                  <WorkspaceCanvasContent
                    hasOpenNotes={canvasProps.hasOpenNotes}
                    canvas={canvasProps.canvas}
                  />
                </WorkspaceCanvasArea>
                )
              : null}
            {workspaceLayers
              ? workspaceLayers
              : workspaceOverlayProps
              ? <WorkspaceOverlay {...workspaceOverlayProps} />
              : null}
            {sidebarPreviewProps ? <SidebarPreviewPopups {...sidebarPreviewProps} /> : null}
            {previewPortalProps ? <WorkspacePreviewPortal {...previewPortalProps} /> : null}
            {floatingToolbar
              ? floatingToolbar
              : floatingToolbarProps
              ? <WorkspaceFloatingToolbar {...floatingToolbarProps} />
              : null}
            {constellationPanel
              ? constellationPanel
              : constellationPanelProps
              ? <WorkspaceConstellationLayer {...constellationPanelProps} />
              : null}
          </div>
        </div>
      </div>
    </div>
  )
}
