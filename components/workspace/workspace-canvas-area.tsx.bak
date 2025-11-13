"use client"

import type { ReactNode } from "react"

type WorkspaceCanvasAreaProps = {
  children: ReactNode
  showConstellationPanel: boolean
  isPopupLayerActive: boolean
}

export function WorkspaceCanvasArea({
  children,
  showConstellationPanel,
  isPopupLayerActive,
}: WorkspaceCanvasAreaProps) {
  return (
    <div className="flex h-full w-full">
      <div
        className="flex-1 relative transition-all duration-300 ease-in-out"
        style={{
          position: "relative",
          zIndex: 1,
          isolation: "isolate",
          opacity: showConstellationPanel ? 0 : 1,
          visibility: showConstellationPanel ? "hidden" : "visible",
        }}
        aria-hidden={showConstellationPanel}
      >
        <div
          className="h-full w-full"
          style={{
            pointerEvents: showConstellationPanel || isPopupLayerActive ? "none" : "auto",
          }}
        >
          {children}
        </div>
      </div>
    </div>
  )
}
