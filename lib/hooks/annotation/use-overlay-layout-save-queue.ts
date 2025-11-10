import { useCallback } from "react"
import type { MutableRefObject } from "react"
import type { OverlayPopup } from "@/components/floating-toolbar"
import {
  OverlayLayoutConflictError,
  OVERLAY_LAYOUT_SCHEMA_VERSION,
  type OverlayLayoutAdapter,
  type OverlayLayoutPayload,
  type OverlayPopupDescriptor,
} from "@/lib/adapters/overlay-layout-adapter"
import type { OverlayCameraState } from "@/lib/types/overlay-layout"

type PendingSnapshot = { payload: OverlayLayoutPayload; hash: string }

type UseOverlayLayoutSaveQueueOptions = {
  overlayPopups: OverlayPopup[]
  layerTransform: OverlayCameraState
  overlayPersistenceActive: boolean
  overlayAdapterRef: MutableRefObject<OverlayLayoutAdapter | null>
  layoutRevisionRef: MutableRefObject<string | null>
  lastSavedLayoutHashRef: MutableRefObject<string | null>
  pendingLayoutRef: MutableRefObject<PendingSnapshot | null>
  saveTimeoutRef: MutableRefObject<NodeJS.Timeout | null>
  saveInFlightRef: MutableRefObject<boolean>
  applyOverlayLayout: (layout: OverlayLayoutPayload) => void
  draggingPopup: string | null
  defaultCamera: OverlayCameraState
  defaultWidth: number
  defaultHeight: number
  debugLog: (payload: { component: string; action: string; metadata?: Record<string, unknown> }) => void
  isDebugEnabled: () => boolean
}

export type OverlayLayoutSaveQueueApi = {
  buildLayoutPayload: () => PendingSnapshot
  flushLayoutSave: () => Promise<void>
  scheduleLayoutSave: (immediate?: boolean) => void
}

const deriveFromPath = (path?: string | null): string | null => {
  if (!path || typeof path !== "string") return null
  const trimmed = path.trim()
  if (!trimmed) return null
  const normalized = trimmed.replace(/\/+$/, "")
  if (!normalized) return null
  const segments = normalized.split("/")
  const lastSegment = segments[segments.length - 1]
  return lastSegment && lastSegment.trim() ? lastSegment.trim() : null
}

export function useOverlayLayoutSaveQueue({
  overlayPopups,
  layerTransform,
  overlayPersistenceActive,
  overlayAdapterRef,
  layoutRevisionRef,
  lastSavedLayoutHashRef,
  pendingLayoutRef,
  saveTimeoutRef,
  saveInFlightRef,
  applyOverlayLayout,
  draggingPopup,
  defaultCamera,
  defaultWidth,
  defaultHeight,
  debugLog,
  isDebugEnabled,
}: UseOverlayLayoutSaveQueueOptions): OverlayLayoutSaveQueueApi {
  const buildLayoutPayload = useCallback((): PendingSnapshot => {
    const descriptors: OverlayPopupDescriptor[] = []

    overlayPopups.forEach((popup) => {
      const canvasPos = popup.canvasPosition
      if (!canvasPos) return

      const x = Number.isFinite(canvasPos.x) ? (canvasPos.x as number) : 0
      const y = Number.isFinite(canvasPos.y) ? (canvasPos.y as number) : 0

      const displayName =
        popup.folderName?.trim() ||
        popup.folder?.name?.trim() ||
        deriveFromPath((popup.folder as any)?.path) ||
        "Untitled Folder"

      const descriptor: OverlayPopupDescriptor = {
        id: popup.id,
        folderId: popup.folderId || null,
        folderName: displayName,
        folderColor: null,
        parentId: popup.parentPopupId || null,
        canvasPosition: { x, y },
        level: popup.level || 0,
        width: popup.width ?? defaultWidth,
        height: popup.height ?? defaultHeight,
      }

      descriptors.push(descriptor)
    })

    const camera: OverlayCameraState = {
      x: Number.isFinite(layerTransform.x) ? (layerTransform.x as number) : 0,
      y: Number.isFinite(layerTransform.y) ? (layerTransform.y as number) : 0,
      scale: Number.isFinite(layerTransform.scale) ? (layerTransform.scale as number) : 1,
    }

    const payload: OverlayLayoutPayload = {
      schemaVersion: OVERLAY_LAYOUT_SCHEMA_VERSION,
      popups: descriptors,
      inspectors: [],
      lastSavedAt: new Date().toISOString(),
      camera,
    }

    const hash = JSON.stringify({
      schemaVersion: payload.schemaVersion,
      popups: payload.popups,
      inspectors: payload.inspectors,
      camera,
    })

    return { payload, hash }
  }, [defaultHeight, defaultWidth, layerTransform, overlayPopups])

  const flushLayoutSave = useCallback(async () => {
    if (!overlayPersistenceActive) return

    const adapter = overlayAdapterRef.current
    if (!adapter) return

    const snapshot =
      pendingLayoutRef.current ??
      (() => {
        const next = buildLayoutPayload()
        return next.hash === lastSavedLayoutHashRef.current ? null : next
      })()

    if (!snapshot) return

    if (saveInFlightRef.current) {
      pendingLayoutRef.current = snapshot
      return
    }

    pendingLayoutRef.current = null
    saveInFlightRef.current = true

    if (saveTimeoutRef.current) {
      clearTimeout(saveTimeoutRef.current)
      saveTimeoutRef.current = null
    }

    try {
      const envelope = await adapter.saveLayout({
        layout: snapshot.payload,
        version: snapshot.payload.schemaVersion,
        revision: layoutRevisionRef.current,
      })

      layoutRevisionRef.current = envelope.revision
      lastSavedLayoutHashRef.current = JSON.stringify({
        schemaVersion: envelope.layout.schemaVersion,
        popups: envelope.layout.popups,
        inspectors: envelope.layout.inspectors,
        camera: envelope.layout.camera ?? defaultCamera,
      })
      console.log("[AnnotationApp] Saved overlay layout to database")
    } catch (error) {
      if (error instanceof OverlayLayoutConflictError) {
        const envelope = error.payload
        layoutRevisionRef.current = envelope.revision
        lastSavedLayoutHashRef.current = JSON.stringify({
          schemaVersion: envelope.layout.schemaVersion,
          popups: envelope.layout.popups,
          inspectors: envelope.layout.inspectors,
          camera: envelope.layout.camera ?? defaultCamera,
        })
        applyOverlayLayout(envelope.layout)
        console.log("[AnnotationApp] Resolved layout conflict from database")
      } else {
        if (isDebugEnabled()) {
          debugLog({
            component: "AnnotationApp",
            action: "overlay_layout_save_failed",
            metadata: { error: error instanceof Error ? error.message : "Unknown error" },
          })
        }
        pendingLayoutRef.current = snapshot
      }
    } finally {
      saveInFlightRef.current = false
      if (pendingLayoutRef.current) {
        void flushLayoutSave()
      }
    }
  }, [
    applyOverlayLayout,
    buildLayoutPayload,
    defaultCamera,
    debugLog,
    isDebugEnabled,
    lastSavedLayoutHashRef,
    layoutRevisionRef,
    overlayAdapterRef,
    overlayPersistenceActive,
    pendingLayoutRef,
    saveInFlightRef,
    saveTimeoutRef,
  ])

  const scheduleLayoutSave = useCallback(
    (immediate = false) => {
      if (!overlayPersistenceActive) return
      if (!overlayAdapterRef.current) return
      if (draggingPopup) {
        console.log("[AnnotationApp] Save skipped: popup dragging in progress")
        return
      }

      const snapshot = buildLayoutPayload()

      if (snapshot.hash === lastSavedLayoutHashRef.current) {
        pendingLayoutRef.current = null
        return
      }

      if (saveInFlightRef.current) {
        pendingLayoutRef.current = snapshot
        return
      }

      pendingLayoutRef.current = snapshot

      if (saveTimeoutRef.current) {
        clearTimeout(saveTimeoutRef.current)
      }

      if (immediate) {
        console.log("[AnnotationApp] Saving immediately (existence change)...")
        void flushLayoutSave()
      } else {
        saveTimeoutRef.current = setTimeout(() => {
          void flushLayoutSave()
        }, 2500)
      }
    },
    [
      buildLayoutPayload,
      draggingPopup,
      flushLayoutSave,
      lastSavedLayoutHashRef,
      overlayAdapterRef,
      overlayPersistenceActive,
      pendingLayoutRef,
      saveInFlightRef,
      saveTimeoutRef,
    ],
  )

  return {
    buildLayoutPayload,
    flushLayoutSave,
    scheduleLayoutSave,
  }
}
