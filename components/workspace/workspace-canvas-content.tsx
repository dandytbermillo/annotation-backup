"use client"

import type { ReactNode } from "react"

export type WorkspaceCanvasContentProps = {
  hasOpenNotes: boolean
  canvas: ReactNode | null
}

/**
 * FIX 12: Always render the canvas to prevent MultiWorkspaceCanvasContainer from unmounting.
 *
 * Previously, when hasOpenNotes was false, we returned a welcome message WITHOUT rendering
 * the canvas. This caused MultiWorkspaceCanvasContainer to unmount, losing its
 * everRenderedWorkspacesRef tracking and all canvas state (alarms, components, etc.).
 *
 * The fix: Always render the canvas using CSS visibility to hide/show it, and overlay
 * the welcome message when there are no notes. This ensures:
 * 1. MultiWorkspaceCanvasContainer stays mounted across workspace switches
 * 2. Hot canvases preserve their state (alarms, timers, etc.)
 * 3. The welcome message still displays when appropriate
 */
export function WorkspaceCanvasContent({ hasOpenNotes, canvas }: WorkspaceCanvasContentProps) {
  return (
    <div className="relative h-full w-full">
      {/* FIX 12: Always render canvas to keep MultiWorkspaceCanvasContainer mounted.
          Use CSS visibility (not display:none) so the component stays in the DOM
          and maintains its state. */}
      <div
        className="absolute inset-0"
        style={{
          visibility: hasOpenNotes ? "visible" : "hidden",
          pointerEvents: hasOpenNotes ? "auto" : "none",
        }}
      >
        {canvas}
      </div>

      {/* Welcome message overlay - shown when no notes are open */}
      {!hasOpenNotes && (
        <div className="absolute inset-0 flex items-center justify-center bg-gray-950">
          <div className="text-center">
            <h2 className="mb-4 text-3xl font-bold text-gray-600">Welcome to Annotation Canvas</h2>
            <p className="mb-6 text-gray-500">Right-click anywhere to open Notes Explorer and create a new note</p>
          </div>
        </div>
      )}
    </div>
  )
}
