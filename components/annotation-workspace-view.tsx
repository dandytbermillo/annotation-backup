"use client"

import type { MouseEventHandler, ReactNode } from "react"

export type AnnotationWorkspaceViewProps = {
  sidebar?: ReactNode
  toolbar?: ReactNode
  workspaceToggle?: ReactNode
  canvasArea: ReactNode
  workspaceLayers?: ReactNode
  sidebarPreviewPopups?: ReactNode
  floatingToolbar?: ReactNode
  previewPortal?: ReactNode
  constellationPanel?: ReactNode
  onMainAreaContextMenu?: MouseEventHandler<HTMLDivElement>
}

export function AnnotationWorkspaceView({
  sidebar,
  toolbar,
  workspaceToggle,
  canvasArea,
  workspaceLayers,
  sidebarPreviewPopups,
  floatingToolbar,
  previewPortal,
  constellationPanel,
  onMainAreaContextMenu,
}: AnnotationWorkspaceViewProps) {
  return (
    <div className="relative h-screen w-screen overflow-hidden bg-neutral-950/80">
      <div className="flex h-full w-full">
        {sidebar}
        <div className="flex flex-1 flex-col overflow-hidden">
          {toolbar}
          <div className="relative flex-1" onContextMenu={onMainAreaContextMenu}>
            {workspaceToggle}
            {canvasArea}
            {workspaceLayers}
            {sidebarPreviewPopups}
            {previewPortal}
            {floatingToolbar}
            {constellationPanel}
          </div>
        </div>
      </div>
    </div>
  )
}
