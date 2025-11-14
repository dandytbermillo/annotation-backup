"use client"

import { useCallback } from "react"
import type { Dispatch, SetStateAction } from "react"

import type { CanvasViewportState } from "@/lib/canvas/canvas-defaults"
import { debugLog } from "@/lib/utils/debug-logger"

type PersistCameraSnapshot = (camera: { x: number; y: number; zoom: number }) => void | Promise<void>

type UseSnapshotCameraSyncOptions = {
  noteId: string
  setCanvasState: Dispatch<SetStateAction<CanvasViewportState>>
  persistCameraSnapshot?: PersistCameraSnapshot
}

type ApplySnapshotCameraOptions = {
  translateX: number
  translateY: number
  zoom: number
  showConnections?: boolean
  isNewlyOpened: boolean
}

export function useSnapshotCameraSync({
  noteId,
  setCanvasState,
  persistCameraSnapshot,
}: UseSnapshotCameraSyncOptions) {
  return useCallback(
    async ({ translateX, translateY, zoom, showConnections, isNewlyOpened }: ApplySnapshotCameraOptions) => {
      setCanvasState(prev => ({
        ...prev,
        zoom,
        ...(showConnections !== undefined ? { showConnections } : {}),
        ...(isNewlyOpened ? {} : { translateX, translateY }),
      }))

      if (!isNewlyOpened && persistCameraSnapshot) {
        await persistCameraSnapshot({ x: translateX, y: translateY, zoom })
      }

      debugLog({
        component: "AnnotationCanvas",
        action: "snapshot_camera_restoration",
        metadata: {
          noteId,
          isNewlyOpened,
          restoredCamera: isNewlyOpened ? "skipped" : { translateX, translateY, zoom },
          reason: isNewlyOpened ? "newly_opened_will_be_centered" : "reload_or_tab_switch",
        },
      })
    },
    [noteId, persistCameraSnapshot, setCanvasState],
  )
}
