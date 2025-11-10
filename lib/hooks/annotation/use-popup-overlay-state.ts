import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import type { OverlayPopup } from "@/components/floating-toolbar"
import { CoordinateBridge } from "@/lib/utils/coordinate-bridge"
import type { LayerContextValue } from "@/components/canvas/layer-provider"

type MoveCascadeState = {
  parentId: string | null
  childIds: string[]
}

type TimeoutHandle = NodeJS.Timeout

export type PopupOverlayState = {
  popups: OverlayPopup[]
  setPopups: React.Dispatch<React.SetStateAction<OverlayPopup[]>>
  draggingPopup: string | null
  setDraggingPopup: React.Dispatch<React.SetStateAction<string | null>>
  overlayPanning: boolean
  setOverlayPanning: (active: boolean) => void
  moveCascadeState: MoveCascadeState
  setMoveCascadeState: React.Dispatch<React.SetStateAction<MoveCascadeState>>
  hoverTimeouts: React.MutableRefObject<Map<string, TimeoutHandle>>
  closeTimeouts: React.MutableRefObject<Map<string, TimeoutHandle>>
  setHoverTimeout: (key: string, handle: TimeoutHandle) => void
  clearHoverTimeout: (key: string) => void
  setCloseTimeout: (key: string, handle: TimeoutHandle) => void
  clearCloseTimeout: (key: string) => void
  clearAllTimeouts: () => void
  handlePopupDragStart: (popupId: string, event: MouseEvent, layerContext: LayerContextValue | null) => void
  handlePopupDragMove: (event: MouseEvent, layerContext: LayerContextValue | null) => void
  handlePopupDragEnd: () => void
}

type UsePopupOverlayStateOptions = {
  initialPopups?: OverlayPopup[]
  initialMoveCascade?: MoveCascadeState
}

const DEFAULT_MOVE_CASCADE: MoveCascadeState = { parentId: null, childIds: [] }

export function usePopupOverlayState({
  initialPopups = [],
  initialMoveCascade = DEFAULT_MOVE_CASCADE,
}: UsePopupOverlayStateOptions = {}): PopupOverlayState {
  const [popups, setPopups] = useState<OverlayPopup[]>(initialPopups)
  const [draggingPopup, setDraggingPopup] = useState<string | null>(null)
  const [overlayPanning, setOverlayPanning] = useState(false)
  const [moveCascadeState, setMoveCascadeState] = useState<MoveCascadeState>(initialMoveCascade)
  const hoverTimeouts = useRef<Map<string, TimeoutHandle>>(new Map())
  const closeTimeouts = useRef<Map<string, TimeoutHandle>>(new Map())
  const dragOffsetRef = useRef<{ x: number; y: number }>({ x: 0, y: 0 })
  const dragScreenPosRef = useRef<{ x: number; y: number }>({ x: 0, y: 0 })
  const draggingPopupRef = useRef<string | null>(null)
  const cascadeRef = useRef<MoveCascadeState>(initialMoveCascade)

  useEffect(() => {
    cascadeRef.current = moveCascadeState
  }, [moveCascadeState])

  const clearHoverTimeout = useCallback((key: string) => {
    const timeout = hoverTimeouts.current.get(key)
    if (timeout) {
      clearTimeout(timeout)
      hoverTimeouts.current.delete(key)
    }
  }, [])

  const clearCloseTimeout = useCallback((key: string) => {
    const timeout = closeTimeouts.current.get(key)
    if (timeout) {
      clearTimeout(timeout)
      closeTimeouts.current.delete(key)
    }
  }, [])

  const setHoverTimeout = useCallback(
    (key: string, handle: TimeoutHandle) => {
      clearHoverTimeout(key)
      hoverTimeouts.current.set(key, handle)
    },
    [clearHoverTimeout],
  )

  const setCloseTimeout = useCallback(
    (key: string, handle: TimeoutHandle) => {
      clearCloseTimeout(key)
      closeTimeouts.current.set(key, handle)
    },
    [clearCloseTimeout],
  )

  const clearAllTimeouts = useCallback(() => {
    hoverTimeouts.current.forEach((timeout) => clearTimeout(timeout))
    hoverTimeouts.current.clear()
    closeTimeouts.current.forEach((timeout) => clearTimeout(timeout))
    closeTimeouts.current.clear()
  }, [])

  const handlePopupDragStart = useCallback(
    (popupId: string, event: MouseEvent, layerContext: LayerContextValue | null) => {
      const popup = popups.find((p) => p.id === popupId)
      if (!popup) return

      const sharedTransform = layerContext?.transforms.popups || { x: 0, y: 0, scale: 1 }
      const screenPosition = CoordinateBridge.canvasToScreen(popup.canvasPosition, sharedTransform)
      dragOffsetRef.current = {
        x: event.clientX - screenPosition.x,
        y: event.clientY - screenPosition.y,
      }
      dragScreenPosRef.current = screenPosition
      draggingPopupRef.current = popupId
      setDraggingPopup(popupId)
      setOverlayPanning(true)
      setPopups((prev) =>
        prev.map((p) => (p.id === popupId ? { ...p, isDragging: true } : p)),
      )
      document.body.style.cursor = "grabbing"
      document.body.style.userSelect = "none"
    },
    [popups],
  )

  const handlePopupDragMove = useCallback(
    (event: MouseEvent, layerContext: LayerContextValue | null) => {
      const activeId = draggingPopupRef.current
      if (!activeId) return

      const sharedTransform = layerContext?.transforms.popups || { x: 0, y: 0, scale: 1 }
      const newScreenPosition = {
        x: event.clientX - dragOffsetRef.current.x,
        y: event.clientY - dragOffsetRef.current.y,
      }
      const newCanvasPosition = CoordinateBridge.screenToCanvas(newScreenPosition, sharedTransform)

      const deltaScreen = {
        x: newScreenPosition.x - dragScreenPosRef.current.x,
        y: newScreenPosition.y - dragScreenPosRef.current.y,
      }
      const scale = sharedTransform.scale || 1
      const deltaCanvas = {
        x: deltaScreen.x / scale,
        y: deltaScreen.y / scale,
      }
      const cascadeActive = cascadeRef.current.parentId === activeId
      const cascadeChildSet = cascadeActive ? new Set(cascadeRef.current.childIds) : null

      setPopups((prev) =>
        prev.map((popup) => {
          if (popup.id === activeId) {
            return { ...popup, canvasPosition: newCanvasPosition, position: newScreenPosition, isDragging: true }
          }
          if (cascadeChildSet?.has(popup.id) && !popup.isPinned) {
            const prevCanvas = popup.canvasPosition || { x: 0, y: 0 }
            const newChildCanvas = { x: prevCanvas.x + deltaCanvas.x, y: prevCanvas.y + deltaCanvas.y }
            const prevScreen = popup.position || CoordinateBridge.canvasToScreen(prevCanvas, sharedTransform)
            const newChildScreen = { x: prevScreen.x + deltaScreen.x, y: prevScreen.y + deltaScreen.y }
            return { ...popup, canvasPosition: newChildCanvas, position: newChildScreen }
          }
          return popup
        }),
      )

      dragScreenPosRef.current = newScreenPosition
    },
    [setPopups],
  )

  const handlePopupDragEnd = useCallback(() => {
    const activeId = draggingPopupRef.current
    if (!activeId) return

    setPopups((prev) =>
      prev.map((p) => (p.id === activeId ? { ...p, isDragging: false } : p)),
    )
    draggingPopupRef.current = null
    setDraggingPopup(null)
    setOverlayPanning(false)
    document.body.style.cursor = ""
    document.body.style.userSelect = ""
  }, [setPopups])

  return useMemo(
    () => ({
      popups,
      setPopups,
      draggingPopup,
      setDraggingPopup,
      overlayPanning,
      setOverlayPanning,
      moveCascadeState,
      setMoveCascadeState,
      hoverTimeouts,
      closeTimeouts,
      setHoverTimeout,
      clearHoverTimeout,
      setCloseTimeout,
      clearCloseTimeout,
      clearAllTimeouts,
      handlePopupDragStart,
      handlePopupDragMove,
      handlePopupDragEnd,
    }),
    [
      popups,
      draggingPopup,
      overlayPanning,
      moveCascadeState,
      setMoveCascadeState,
      setHoverTimeout,
      clearHoverTimeout,
      setCloseTimeout,
      clearCloseTimeout,
      clearAllTimeouts,
      handlePopupDragStart,
      handlePopupDragMove,
      handlePopupDragEnd,
    ],
  )
}
