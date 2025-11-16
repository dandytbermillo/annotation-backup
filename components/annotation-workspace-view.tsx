"use client"

import { WorkspaceToolbarStrip } from "@/components/workspace/workspace-toolbar-strip"
import { SidebarPreviewPopups } from "@/components/sidebar/sidebar-preview-popups"
import { WorkspacePreviewPortal } from "@/components/workspace/workspace-preview-portal"
import { WorkspaceCanvasArea } from "@/components/workspace/workspace-canvas-area"
import { WorkspaceCanvasContent } from "@/components/workspace/workspace-canvas-content"
import { WorkspaceOverlay } from "@/components/workspace/workspace-overlay"
import { WorkspaceFloatingToolbar } from "@/components/workspace/workspace-floating-toolbar"
import { WorkspaceConstellationLayer } from "@/components/workspace/workspace-constellation-layer"
import { WorkspaceSidebar } from "@/components/workspace/workspace-sidebar"
import type {
  AnnotationWorkspaceViewProps,
  WorkspaceCanvasViewProps,
} from "@/components/annotation-workspace-view/types"

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
          {workspaceToggle ? (
            <div
              className="relative flex-none"
              style={{ minHeight: "64px", pointerEvents: "none" }}
            >
              {workspaceToggle}
            </div>
          ) : null}
          {toolbar ?? (toolbarProps ? <WorkspaceToolbarStrip {...toolbarProps} /> : null)}
          <div className="relative flex-1" onContextMenu={onMainAreaContextMenu}>
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
