"use client"

import type { ComponentProps } from "react"

import { AutoHideToolbar } from "@/components/canvas/auto-hide-toolbar"
import { WorkspaceToolbar } from "@/components/canvas/workspace-toolbar"

type WorkspaceToolbarProps = ComponentProps<typeof WorkspaceToolbar>

type WorkspaceToolbarStripProps = {
  isVisible: boolean
} & WorkspaceToolbarProps

export function WorkspaceToolbarStrip({
  isVisible,
  ...toolbarProps
}: WorkspaceToolbarStripProps) {
  if (!isVisible) {
    return null
  }

  return (
    <AutoHideToolbar edgeThreshold={50} hideDelay={800}>
      <div className="flex flex-wrap items-center gap-2 px-4 py-2 overflow-visible">
        <WorkspaceToolbar {...toolbarProps} />
      </div>
    </AutoHideToolbar>
  )
}
