"use client"

import type { ReactNode } from "react"

export type WorkspaceCanvasContentProps = {
  hasOpenNotes: boolean
  canvas: ReactNode | null
}

export function WorkspaceCanvasContent({ hasOpenNotes, canvas }: WorkspaceCanvasContentProps) {
  if (!hasOpenNotes) {
    return (
      <div className="flex h-full w-full items-center justify-center bg-gray-950">
        <div className="text-center">
          <h2 className="mb-4 text-3xl font-bold text-gray-600">Welcome to Annotation Canvas</h2>
          <p className="mb-6 text-gray-500">Right-click anywhere to open Notes Explorer and create a new note</p>
        </div>
      </div>
    )
  }

  return <>{canvas}</>
}
