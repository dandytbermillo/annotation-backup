"use client"

import { useEffect } from "react"
import type { ComponentProps } from "react"

import { WorkspaceOverlayLayer } from "@/components/workspace/workspace-overlay-layer"
import type { MoveCascadeState } from "@/lib/hooks/annotation/use-popup-overlay-state"

type WorkspaceOverlayProps = ComponentProps<typeof WorkspaceOverlayLayer> & {
  moveCascadeState: MoveCascadeState
  onClearMoveCascadeState: () => void
}

export function WorkspaceOverlay({
  moveCascadeState,
  onClearMoveCascadeState,
  popups,
  ...rest
}: WorkspaceOverlayProps) {
  useEffect(() => {
    if (!moveCascadeState.parentId) {
      return
    }

    if (!popups.has(moveCascadeState.parentId)) {
      onClearMoveCascadeState()
    }
  }, [moveCascadeState.parentId, popups, onClearMoveCascadeState])

  if (!rest.shouldRender) {
    return null
  }

  return <WorkspaceOverlayLayer popups={popups} {...rest} />
}
