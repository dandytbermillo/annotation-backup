"use client"

import { useCallback } from "react"

export type CameraState = { x: number; y: number; zoom: number }

export function useCameraSnapshotPersistence(noteId: string, cameraUserId: string | null | undefined) {
  return useCallback(async (camera: CameraState) => {
    if (typeof window === "undefined" || !noteId) {
      return
    }

    try {
      await fetch(`/api/canvas/camera/${noteId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ camera, userId: cameraUserId ?? null }),
      })
    } catch (error) {
      console.warn("[AnnotationCanvas] Failed to persist restored camera snapshot", error)
    }
  }, [noteId, cameraUserId])
}
