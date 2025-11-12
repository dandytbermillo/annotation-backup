"use client"

import type { ReactNode } from "react"

export type AnnotationWorkspaceViewProps = {
  sidebar?: ReactNode
  content: ReactNode
}

export function AnnotationWorkspaceView({ sidebar, content }: AnnotationWorkspaceViewProps) {
  return (
    <div className="relative h-screen w-screen overflow-hidden bg-neutral-950/80">
      <div className="flex h-full w-full">
        {sidebar}
        {content}
      </div>
    </div>
  )
}
