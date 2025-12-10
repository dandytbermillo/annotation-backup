"use client"

import type { ComponentProps } from "react"

import { FloatingToolbar } from "@/components/floating-toolbar"
import { debugLog } from "@/lib/utils/debug-logger"

export type WorkspaceFloatingToolbarProps = {
  visible: boolean
} & ComponentProps<typeof FloatingToolbar>

export function WorkspaceFloatingToolbar({ visible, ...toolbarProps }: WorkspaceFloatingToolbarProps) {
  debugLog({
    component: "WorkspaceFloatingToolbar",
    action: "render_check",
    metadata: { visible, willRender: visible },
  })

  if (!visible) {
    debugLog({
      component: "WorkspaceFloatingToolbar",
      action: "not_rendering",
      metadata: { visible },
    })
    return null
  }

  debugLog({
    component: "WorkspaceFloatingToolbar",
    action: "rendering_fallback_toolbar",
    metadata: { visible },
  })

  return <FloatingToolbar {...toolbarProps} />
}
