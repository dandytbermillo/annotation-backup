"use client"

import { useCanvas } from "./canvas/canvas-context"
import { FloatingToolbar } from "./floating-toolbar"
import type { ComponentProps } from "react"
import { useEffect, useState } from "react"
import { createPortal } from "react-dom"

/**
 * CanvasAwareFloatingToolbar - Context-Connected Toolbar Wrapper
 *
 * This component bridges FloatingToolbar with CanvasProvider by:
 * 1. Living inside the CanvasProvider component tree (React context scope)
 * 2. Calling useCanvas() to access live canvas state
 * 3. Passing state/dispatch/dataStore as props to FloatingToolbar
 * 4. Portaling to document.body for proper z-index layering
 *
 * When canvas state updates (e.g., new annotation created):
 * - dispatch({ type: "BRANCH_UPDATED" }) fires
 * - CanvasProvider state.lastUpdate changes
 * - React re-renders this wrapper (it's a context consumer)
 * - Fresh state is passed to FloatingToolbar
 * - BranchesSection re-renders with new state.lastUpdate
 * - Branches panel updates automatically ✅
 *
 * Architecture:
 * - Component tree: CanvasProvider → CanvasAwareFloatingToolbar → FloatingToolbar (context access)
 * - DOM tree: document.body → FloatingToolbar (portaled for z-index)
 *
 * This eliminates the need for:
 * - window.canvasState globals
 * - Custom DOM events
 * - Manual event subscriptions
 * - Force re-render hacks (canvasUpdateTrigger)
 */
type CanvasAwareFloatingToolbarProps = Omit<
  ComponentProps<typeof FloatingToolbar>,
  "canvasState" | "canvasDispatch" | "canvasDataStore"
>

export function CanvasAwareFloatingToolbar(props: CanvasAwareFloatingToolbarProps) {
  // Access canvas context - this hook call is safe because CanvasAwareFloatingToolbar
  // is rendered as a child of ModernAnnotationCanvas, inside <CanvasProvider>
  const { state, dispatch, dataStore, noteId } = useCanvas()

  // Only render portal client-side (avoid SSR hydration mismatch)
  const [mounted, setMounted] = useState(false)
  useEffect(() => {
    setMounted(true)
  }, [])

  if (!mounted) return null

  // Pass context values as props to FloatingToolbar
  // When state.lastUpdate changes, this component re-renders with fresh values
  // Portal to document.body so toolbar appears above PopupOverlay (z-index)
  return createPortal(
    <FloatingToolbar
      {...props}
      canvasState={state}
      canvasDispatch={dispatch}
      canvasDataStore={dataStore}
      canvasNoteId={noteId}
    />,
    document.body
  )
}
