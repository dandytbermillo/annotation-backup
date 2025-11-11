"use client"

import type { ReactNode } from "react"

export type AnnotationWorkspaceViewProps = {
  children: ReactNode
}

export function AnnotationWorkspaceView({ children }: AnnotationWorkspaceViewProps) {
  return <>{children}</>
}
