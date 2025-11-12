"use client"

import { ConstellationPanel } from "@/components/constellation/constellation-panel"

type WorkspaceConstellationLayerProps = {
  visible: boolean
}

export function WorkspaceConstellationLayer({ visible }: WorkspaceConstellationLayerProps) {
  if (!visible) {
    return null
  }

  return (
    <div className="absolute inset-0 z-40">
      <ConstellationPanel />
    </div>
  )
}
