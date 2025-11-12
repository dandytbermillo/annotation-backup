"use client"

import type { ComponentProps } from "react"

import { PopupOverlay } from "@/components/canvas/popup-overlay"

export type WorkspaceOverlayLayerProps = {
  shouldRender: boolean
} & ComponentProps<typeof PopupOverlay>

export function WorkspaceOverlayLayer({ shouldRender, ...props }: WorkspaceOverlayLayerProps) {
  if (!shouldRender) {
    return null
  }

  return <PopupOverlay {...props} />
}
