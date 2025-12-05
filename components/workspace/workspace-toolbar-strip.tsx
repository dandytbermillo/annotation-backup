"use client"

import type { ComponentProps } from "react"

import { AutoHideToolbar } from "@/components/canvas/auto-hide-toolbar"
import { WorkspaceToolbar } from "@/components/canvas/workspace-toolbar"

type WorkspaceToolbarProps = ComponentProps<typeof WorkspaceToolbar>

export type WorkspaceToolbarStripProps = {
  isVisible: boolean
  /** Top offset in pixels (for embedding below another header) */
  topOffset?: number
} & WorkspaceToolbarProps

export function WorkspaceToolbarStrip({
  isVisible,
  topOffset = 0,
  ...toolbarProps
}: WorkspaceToolbarStripProps) {
  if (!isVisible) {
    return null
  }

  return (
    <AutoHideToolbar edgeThreshold={50} hideDelay={800} topOffset={topOffset}>
      <div className="flex flex-wrap items-center gap-2 px-4 py-2 overflow-visible">
        <WorkspaceToolbar {...toolbarProps} />
      </div>
    </AutoHideToolbar>
  )
}
