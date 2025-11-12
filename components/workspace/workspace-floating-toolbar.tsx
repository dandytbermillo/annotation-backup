"use client"

import type { ComponentProps } from "react"

import { FloatingToolbar } from "@/components/floating-toolbar"

type WorkspaceFloatingToolbarProps = {
  visible: boolean
} & ComponentProps<typeof FloatingToolbar>

export function WorkspaceFloatingToolbar({ visible, ...toolbarProps }: WorkspaceFloatingToolbarProps) {
  if (!visible) {
    return null
  }

  return <FloatingToolbar {...toolbarProps} />
}
