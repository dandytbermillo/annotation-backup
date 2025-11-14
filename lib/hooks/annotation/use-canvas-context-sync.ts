"use client"

import { useEffect } from "react"
import type { Dispatch, MutableRefObject, SetStateAction } from "react"

import type { CanvasViewportState } from "@/lib/canvas/canvas-defaults"
import type { CanvasState } from "@/types/canvas"
import type { DebugLogData } from "@/lib/utils/debug-logger"

type CanvasContextStateSlice = Pick<CanvasState, "canvasState">

export type UseCanvasContextSyncOptions = {
  canvasContextState: CanvasContextStateSlice
  setCanvasState: Dispatch<SetStateAction<CanvasViewportState>>
  isRestoringSnapshotRef: MutableRefObject<boolean>
  skipNextContextSyncRef: MutableRefObject<boolean>
  noteId: string
  debugLog: (entry: DebugLogData) => void | Promise<void>
}

export function useCanvasContextSync({
  canvasContextState,
  setCanvasState,
  isRestoringSnapshotRef,
  skipNextContextSyncRef,
  noteId,
  debugLog,
}: UseCanvasContextSyncOptions) {
  const { translateX, translateY, zoom } = canvasContextState.canvasState

  useEffect(() => {
    if (isRestoringSnapshotRef.current) {
      void debugLog({
        component: "AnnotationCanvas",
        action: "skip_context_sync_during_snapshot_restore",
        metadata: { noteId, reason: "snapshot_restoration_in_progress" },
      })
      return
    }

    if (skipNextContextSyncRef.current) {
      skipNextContextSyncRef.current = false
      void debugLog({
        component: "AnnotationCanvas",
        action: "skip_context_sync_after_snapshot_skip",
        metadata: { noteId },
      })
      return
    }

    setCanvasState(prev => {
      if (
        prev.translateX === translateX &&
        prev.translateY === translateY &&
        prev.zoom === zoom
      ) {
        return prev
      }

      return {
        ...prev,
        translateX,
        translateY,
        zoom,
      }
    })
  }, [
    translateX,
    translateY,
    zoom,
    noteId,
    setCanvasState,
    debugLog,
    isRestoringSnapshotRef,
    skipNextContextSyncRef,
  ])
}
