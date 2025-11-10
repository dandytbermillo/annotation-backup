import { useCallback, useEffect, useRef } from "react"
import type { OverlayPopup } from "@/components/floating-toolbar"

type PopupPositionUpdate = {
  screenPosition?: { x: number; y: number }
  canvasPosition?: { x: number; y: number }
  size?: { width: number; height: number }
}

type UseOverlayPopupLayoutOptions = {
  setPopups: React.Dispatch<React.SetStateAction<OverlayPopup[]>>
  ensureOverlayHydrated: (reason: string) => void
  defaultWidth: number
  defaultHeight: number
  minWidth: number
  maxWidth: number
  minHeight: number
  maxHeight: number
}

export type OverlayPopupLayoutApi = {
  createOverlayPopup: (popup: OverlayPopup, shouldHighlight?: boolean) => void
  updatePopupPosition: (popupId: string, updates: PopupPositionUpdate) => void
  resizePopup: (
    popupId: string,
    size: { width: number; height: number },
    options?: { source?: "auto" | "user" },
  ) => void
}

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value))

export function useOverlayPopupLayout({
  setPopups,
  ensureOverlayHydrated,
  defaultWidth,
  defaultHeight,
  minWidth,
  maxWidth,
  minHeight,
  maxHeight,
}: UseOverlayPopupLayoutOptions): OverlayPopupLayoutApi {
  const highlightTimeouts = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map())

  useEffect(() => {
    return () => {
      highlightTimeouts.current.forEach((timeout) => clearTimeout(timeout))
      highlightTimeouts.current.clear()
    }
  }, [])

  const scheduleHighlightReset = useCallback(
    (popupId: string) => {
      const existing = highlightTimeouts.current.get(popupId)
      if (existing) clearTimeout(existing)
      const timeout = setTimeout(() => {
        highlightTimeouts.current.delete(popupId)
        setPopups((prev) =>
          prev.map((popup) => (popup.id === popupId ? { ...popup, isHighlighted: false } : popup)),
        )
      }, 2000)
      highlightTimeouts.current.set(popupId, timeout)
    },
    [setPopups],
  )

  const createOverlayPopup = useCallback(
    (popup: OverlayPopup, shouldHighlight = false) => {
      ensureOverlayHydrated("floating-toolbar")

      setPopups((prev) => {
        const existingIndex = prev.findIndex((p) => p.id === popup.id)
        if (existingIndex >= 0) {
          if (shouldHighlight) {
            const updated = [...prev]
            updated[existingIndex] = { ...updated[existingIndex], isHighlighted: true }
            return updated
          }

          const updated = [...prev]
          const incomingSizeMode =
            popup.sizeMode ?? (popup.isLoading ? updated[existingIndex].sizeMode ?? "default" : "default")
          const nextSizeMode = updated[existingIndex].sizeMode === "user" ? "user" : incomingSizeMode
          const shouldReleaseHeight = nextSizeMode === "default" && updated[existingIndex].sizeMode !== "user"
          const resolvedHeight = shouldReleaseHeight ? undefined : popup.height ?? updated[existingIndex].height
          const resolvedWidth = popup.width ?? updated[existingIndex].width

          updated[existingIndex] = {
            ...updated[existingIndex],
            ...popup,
            position: updated[existingIndex].position,
            canvasPosition: updated[existingIndex].canvasPosition,
            isHighlighted: updated[existingIndex].isHighlighted,
            width: resolvedWidth,
            height: resolvedHeight,
            sizeMode: nextSizeMode,
          }
          return updated
        }

        const folderExists = prev.some((p) => p.folderId === popup.folderId)
        if (folderExists) {
          return prev.map((p) => (p.folderId === popup.folderId ? { ...p, isHighlighted: true } : p))
        }

        return [...prev, popup]
      })

      if (shouldHighlight) {
        scheduleHighlightReset(popup.id)
      }
    },
    [ensureOverlayHydrated, scheduleHighlightReset, setPopups],
  )

  const updatePopupPosition = useCallback(
    (popupId: string, updates: PopupPositionUpdate) => {
      setPopups((prev) =>
        prev.map((popup) => {
          if (popup.id !== popupId) return popup

          let next = popup
          const ensureClone = () => {
            if (next === popup) {
              next = { ...popup }
            }
          }

          const { screenPosition, canvasPosition, size } = updates

          if (screenPosition) {
            const prevScreen = popup.position
            if (
              !prevScreen ||
              Math.abs(prevScreen.x - screenPosition.x) > 0.5 ||
              Math.abs(prevScreen.y - screenPosition.y) > 0.5
            ) {
              ensureClone()
              next.position = screenPosition
            }
          }

          if (canvasPosition) {
            const prevCanvas = popup.canvasPosition
            if (
              !prevCanvas ||
              Math.abs(prevCanvas.x - canvasPosition.x) > 0.1 ||
              Math.abs(prevCanvas.y - canvasPosition.y) > 0.1
            ) {
              ensureClone()
              next.canvasPosition = canvasPosition
            }
          }

          if (size) {
            const prevWidth = popup.width ?? defaultWidth
            const prevHeight = popup.height ?? defaultHeight
            const widthChanged = Math.abs(prevWidth - size.width) > 0.5
            const heightChanged = Math.abs(prevHeight - size.height) > 0.5

            if (widthChanged || heightChanged) {
              ensureClone()
              if (widthChanged) next.width = size.width
              if (heightChanged) next.height = size.height
            }
          }

          return next
        }),
      )
    },
    [defaultHeight, defaultWidth, setPopups],
  )

  const resizePopup = useCallback(
    (popupId: string, size: { width: number; height: number }, options?: { source?: "auto" | "user" }) => {
      const source = options?.source ?? "user"
      const clampedWidth = clamp(size.width, minWidth, maxWidth)
      const clampedHeight = clamp(size.height, minHeight, maxHeight)

      setPopups((prev) =>
        prev.map((popup) => {
          if (popup.id !== popupId) return popup

          if (source === "auto" && popup.sizeMode === "user") {
            return popup
          }

          const prevWidth = popup.width ?? defaultWidth
          const prevHeight = popup.height ?? defaultHeight

          if (Math.abs(prevWidth - clampedWidth) <= 0.5 && Math.abs(prevHeight - clampedHeight) <= 0.5) {
            if (source === "auto" && popup.sizeMode !== "auto") {
              return {
                ...popup,
                sizeMode: "auto",
              }
            }
            return popup
          }

          return {
            ...popup,
            width: clampedWidth,
            height: clampedHeight,
            sizeMode: source === "user" ? "user" : "auto",
          }
        }),
      )
    },
    [defaultHeight, defaultWidth, maxHeight, maxWidth, minHeight, minWidth, setPopups],
  )

  return {
    createOverlayPopup,
    updatePopupPosition,
    resizePopup,
  }
}
