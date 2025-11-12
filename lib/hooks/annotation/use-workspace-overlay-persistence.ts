import { useEffect, useRef } from "react"
import type { MutableRefObject } from "react"

import type { OverlayPopup } from "@/components/floating-toolbar"
import type { OverlayLayoutPayload } from "@/lib/types/overlay-layout"

const serializeForChangeDetection = (popups: OverlayPopup[]) =>
  popups.map(p => ({
    id: p.id,
    width: p.width,
    height: p.height,
    canvasPosition: p.canvasPosition,
    position: p.position,
    level: p.level,
    parentPopupId: p.parentPopupId,
    childrenCount: p.children?.length ?? 0,
  }))

export type UseWorkspaceOverlayPersistenceOptions = {
  overlayPopups: OverlayPopup[]
  overlayPersistenceActive: boolean
  overlayPersistenceEnabled: boolean
  overlayPanning: boolean
  draggingActive: boolean
  layerTransform: { x: number; y: number; scale: number }
  latestCameraRef: MutableRefObject<{ x: number; y: number; scale: number }>
  prevCameraForSaveRef: MutableRefObject<{ x: number; y: number; scale: number }>
  layoutLoadedRef: MutableRefObject<boolean>
  scheduleLayoutSave: (immediate: boolean) => void
  saveTimeoutRef: MutableRefObject<NodeJS.Timeout | null>
  pendingLayoutRef: MutableRefObject<{ payload: OverlayLayoutPayload; hash: string } | null>
}

export function useWorkspaceOverlayPersistence({
  overlayPopups,
  overlayPersistenceActive,
  overlayPersistenceEnabled,
  overlayPanning,
  draggingActive,
  layerTransform,
  latestCameraRef,
  prevCameraForSaveRef,
  layoutLoadedRef,
  scheduleLayoutSave,
  saveTimeoutRef,
  pendingLayoutRef,
}: UseWorkspaceOverlayPersistenceOptions) {
  const prevPopupsRef = useRef<OverlayPopup[]>([])
  const needsSaveAfterInteractionRef = useRef(false)

  useEffect(() => {
    latestCameraRef.current = layerTransform
  }, [layerTransform, latestCameraRef])

  useEffect(() => {
    if (!overlayPersistenceActive) {
      prevCameraForSaveRef.current = latestCameraRef.current
      return
    }
    if (!layoutLoadedRef.current) {
      prevCameraForSaveRef.current = latestCameraRef.current
      return
    }

    const prev = prevCameraForSaveRef.current
    const current = latestCameraRef.current
    if (prev.x === current.x && prev.y === current.y && prev.scale === current.scale) {
      return
    }

    prevCameraForSaveRef.current = current
    scheduleLayoutSave(false)
  }, [overlayPersistenceActive, layerTransform, latestCameraRef, layoutLoadedRef, prevCameraForSaveRef, scheduleLayoutSave])

  useEffect(() => {
    console.log("[AnnotationApp] Save effect triggered.", {
      overlayPersistenceEnabled,
      overlayPersistenceActive,
      overlayCount: overlayPopups.length,
      layoutLoaded: layoutLoadedRef.current,
    })

    if (!overlayPersistenceActive) {
      console.log("[AnnotationApp] Save skipped: persistence inactive")
      return
    }
    if (!layoutLoadedRef.current) {
      console.log("[AnnotationApp] Save skipped: layout not loaded yet")
      prevPopupsRef.current = overlayPopups
      return
    }

    const currentSnapshot = serializeForChangeDetection(overlayPopups)
    const prevSnapshot = serializeForChangeDetection(prevPopupsRef.current)
    const changed = JSON.stringify(currentSnapshot) !== JSON.stringify(prevSnapshot)

    if (draggingActive || overlayPanning) {
      if (changed) {
        console.log("[AnnotationApp] Save deferred: canvas interaction in progress", {
          draggingActive,
          overlayPanning,
        })
        needsSaveAfterInteractionRef.current = true
      } else {
        console.log("[AnnotationApp] Save skipped: interaction in progress (no layout delta)")
      }
      if (saveTimeoutRef.current) {
        clearTimeout(saveTimeoutRef.current)
        saveTimeoutRef.current = null
      }
      return
    }

    if (!changed) {
      console.log("[AnnotationApp] Save skipped: no changes detected")
      prevPopupsRef.current = overlayPopups
      needsSaveAfterInteractionRef.current = false
      return
    }

    const isCreation = overlayPopups.length > prevPopupsRef.current.length
    const isDeletion = overlayPopups.length < prevPopupsRef.current.length
    const isExistenceChange = isCreation || isDeletion

    if (isCreation) {
      console.log("[AnnotationApp] Scheduling save... (IMMEDIATE - creation)")
    } else if (isDeletion) {
      console.log("[AnnotationApp] Scheduling save... (IMMEDIATE - deletion)")
    } else {
      console.log("[AnnotationApp] Scheduling save... (debounced - property change)")
    }

    prevPopupsRef.current = overlayPopups
    needsSaveAfterInteractionRef.current = false
    scheduleLayoutSave(isExistenceChange)
  }, [
    overlayPopups,
    overlayPersistenceActive,
    overlayPersistenceEnabled,
    overlayPanning,
    draggingActive,
    layoutLoadedRef,
    saveTimeoutRef,
    scheduleLayoutSave,
  ])

  useEffect(() => {
    if (!overlayPanning) return
    if (saveTimeoutRef.current) {
      clearTimeout(saveTimeoutRef.current)
      saveTimeoutRef.current = null
      pendingLayoutRef.current = null
      console.log("[AnnotationApp] Cleared pending layout save due to overlay panning")
    }
  }, [overlayPanning, pendingLayoutRef, saveTimeoutRef])

  useEffect(() => {
    if (!overlayPanning && needsSaveAfterInteractionRef.current) {
      console.log("[AnnotationApp] Resuming deferred overlay save after interaction")
      needsSaveAfterInteractionRef.current = false
      scheduleLayoutSave(false)
    }
  }, [overlayPanning, scheduleLayoutSave])
}
